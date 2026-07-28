// app/api/cron/escrow-release/route.ts
// Vercel cron job — runs every hour to auto-release expired escrow.
// Secured by CRON_SECRET environment variable.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { AdminService } from "@/src/services/admin"
import { notifyEscrowReleased } from "@/src/services/notifyEscrowReleased"
import { ReferralsService } from "@/src/services/referrals"

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const now = new Date().toISOString()
    const allOrders = await AdminService.getCollection("orders") as Record<string, unknown>[]
    const expired = allOrders.filter(o => {
      const releaseAt = String(o.escrow_release_at ?? o.escrowReleaseAt ?? "")
      const status    = String(o.status ?? "")
      return (
        ["delivered", "inspecting"].includes(status) &&
        releaseAt &&
        releaseAt < now
      )
    })

    if (expired.length === 0) {
      return NextResponse.json({ success: true, released: 0, message: "No expired escrows" })
    }

    const results: { orderId: string; status: string }[] = []

    for (const order of expired) {
      const orderId   = String(order.id ?? "")
      const sellerId  = String(order.seller_id  ?? order.sellerId  ?? "")
      const buyerId   = String(order.buyer_id   ?? order.buyerId   ?? "")
      // FIX: fall back to total_amount if seller_payout was never stored —
      // matches the same defensive fallback in releaseEscrow().
      let payout = Number(order.seller_payout ?? order.sellerPayout ?? 0)
      if (!payout || payout <= 0) {
        payout = Number(order.total_amount ?? order.totalAmount ?? 0)
      }
      const itemTitle = String(order.item_title  ?? order.itemTitle  ?? "your item")

      try {
        await AdminService.updateDoc("orders", orderId, {
          status:        "completed",
          escrow_status: "released_to_seller",
          auto_released: true,
          completed_at:  now,
        })

        if (sellerId && payout > 0) {
          const wallet  = await AdminService.getDoc("seller_wallets", sellerId) as Record<string, unknown> | null
          const bal     = Number(wallet?.balance ?? 0)
          const earned  = Number(wallet?.total_earned ?? wallet?.totalEarned ?? 0)
          const pending = Number(wallet?.pending_balance ?? wallet?.pendingBalance ?? 0)
          await AdminService.setDoc("seller_wallets", sellerId, {
            balance:         bal + payout,
            total_earned:    earned + payout,
            pending_balance: Math.max(0, pending - payout),
            updated_at:      now,
          }, { merge: true })
          await AdminService.addDoc("wallet_transactions", {
            user_id:     sellerId,
            type:        "credit",
            amount:      payout,
            description: `Auto-released escrow — order #${orderId.slice(0, 8).toUpperCase()}`,
            order_id:    orderId,
            status:      "completed",
          })
          // FIX: same missing total_sales increment as confirm-delivery —
          // without this, sellers whose escrow only ever auto-releases
          // (buyer never manually confirms) permanently show 0 sales.
          const sellerUser = await AdminService.getDoc("users", sellerId) as Record<string, unknown> | null
          await AdminService.setDoc("users", sellerId, {
            total_sales: Number(sellerUser?.total_sales ?? sellerUser?.totalSales ?? 0) + 1,
            updated_at:  now,
          }, { merge: true })
        }

        if (buyerId) {
          await AdminService.addDoc("notifications", {
            user_id: buyerId, type: "system",
            title:   "⏱️ Escrow Auto-Released",
            body:    `Your inspection window for "${itemTitle}" has closed. Payment released to seller.`,
            link:    `/dashboard/buyer/orders/${orderId}`,
            is_read: false,
          })
        }

        if (sellerId) {
          await AdminService.addDoc("notifications", {
            user_id: sellerId, type: "system",
            title:   "💰 Escrow Released!",
            body:    `₦${(payout / 100).toLocaleString("en-NG")} from "${itemTitle}" credited to your wallet.`,
            link:    "/dashboard/seller/wallet",
            is_read: false,
          })
        }

        // FIX: email was never sent on escrow release — seller only got the
        // in-app notification below. Awaited (not fire-and-forget) so the
        // request doesn't complete before the send finishes in this
        // serverless environment; internally it never throws.
        await notifyEscrowReleased({ ...order, seller_payout: payout, status: "completed" })

        // Referral bonus — pays out the first time a referred seller's
        // first order reaches a completed sale. No-op if this seller
        // wasn't referred, isn't a seller referral, or already paid.
        if (sellerId) {
          try {
            await ReferralsService.triggerSellerFirstSaleBonus(sellerId)
          } catch (err) {
            console.error("cron/escrow-release: seller referral bonus failed (non-fatal):", err)
          }
        }

        results.push({ orderId, status: "released" })
      } catch (err: any) {
        results.push({ orderId, status: `error: ${err.message}` })
      }
    }

    return NextResponse.json({
      success:  true,
      released: results.filter(r => r.status === "released").length,
      errors:   results.filter(r => r.status.startsWith("error")).length,
      results,
    })
  } catch (err: any) {
    console.error("[cron/escrow-release]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
