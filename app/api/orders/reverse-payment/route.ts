// app/api/orders/reverse-payment/route.ts
// ─────────────────────────────────────────────────────────────────
// Admin reverses a payment on an order that has ALREADY moved money —
// i.e. status is escrow_held / shipped / delivered / completed (anything
// past "pending"). This is distinct from /api/orders/cancel-admin, which
// only handles orders that never got paid yet and just deletes the row.
//
// What this does, in order:
//   1. Loads the order, refuses if it was never actually paid (pending /
//      payment_rejected / already refunded / already cancelled).
//   2. If the seller was already credited (status was "completed" and
//      escrow released), debits the seller's wallet back by the payout
//      amount and logs a "debit" wallet_transactions row. If the seller's
//      balance can't cover it, the wallet goes negative rather than
//      silently under-reversing — admin needs to see that on the wallet.
//   3. If the order was paid via Paystack or Flutterwave and has a
//      payment_reference, attempts a real refund through that provider's
//      API so the buyer's money actually goes back to their card/bank.
//      This is best-effort: if the provider refuses (e.g. already
//      refunded, reference too old), the order status is still flipped to
//      "refunded" so admin bookkeeping stays correct, and the provider's
//      error is surfaced in the response for the admin to see/act on
//      manually.
//   4. Sets order.status = "refunded", escrow_status = "refunded".
//   5. Notifies + emails both buyer and seller with the reason.
//
// This route does NOT delete the order — unlike cancel-admin, reversed
// orders keep their row for audit/records since real money moved.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-server"
import { d1Query } from "@/lib/d1"
import { AdminService } from "@/src/services/admin"
import { Emails } from "@/src/services/email"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

function ngn(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG")}`
}

function row1(result: any): Record<string, unknown> | null {
  return (result?.results?.[0] ?? null) as Record<string, unknown> | null
}

// Orders that never actually had money move, or that were already
// reversed/cancelled, aren't valid targets for this route.
const NOT_YET_PAID = new Set(["pending", "payment_rejected"])
const ALREADY_TERMINAL = new Set(["refunded", "cancelled"])

async function refundPaystack(reference: string, amountKobo?: number) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return { ok: false, error: "PAYSTACK_SECRET_KEY not configured" }

  try {
    const res = await fetch("https://api.paystack.co/refund", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction: reference,
        // Paystack refund amount is in kobo, same unit we store amounts in.
        // Omit to let Paystack refund the full original amount.
        ...(amountKobo ? { amount: amountKobo } : {}),
      }),
    })
    const data = await res.json()
    if (!res.ok || !data.status) {
      return { ok: false, error: data.message || "Paystack refund failed" }
    }
    return { ok: true, data: data.data }
  } catch (err: any) {
    return { ok: false, error: err.message || "Paystack refund request failed" }
  }
}

// Flutterwave refunds are two calls: first resolve the numeric transaction
// id from our stored `payment_reference` (tx_ref) via the verify endpoint,
// then POST /transactions/{id}/refund with that id. Unlike Paystack, which
// accepts the string reference directly, Flutterwave requires the
// integer id — so a lookup step is unavoidable here.
async function refundFlutterwave(reference: string, amountKobo?: number) {
  const secretKey = process.env.FLW_SECRET_KEY
  if (!secretKey) return { ok: false, error: "FLW_SECRET_KEY not configured" }

  try {
    // 1. Resolve tx_ref -> Flutterwave's numeric transaction id.
    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )
    const verifyData = await verifyRes.json()
    const txId = verifyData?.data?.id
    if (!verifyRes.ok || !verifyData?.status || !txId) {
      return { ok: false, error: verifyData?.message || "Could not resolve Flutterwave transaction id" }
    }

    // 2. Issue the refund against that transaction id. Flutterwave amount
    // is in naira, not kobo, so convert down from our kobo storage unit.
    const res = await fetch(`https://api.flutterwave.com/v3/transactions/${txId}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Omit amount to let Flutterwave refund the full original charge.
        ...(amountKobo ? { amount: amountKobo / 100 } : {}),
      }),
    })
    const data = await res.json()
    if (!res.ok || data?.status !== "success") {
      return { ok: false, error: data?.message || "Flutterwave refund failed" }
    }
    return { ok: true, data: data.data }
  } catch (err: any) {
    return { ok: false, error: err.message || "Flutterwave refund request failed" }
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  const nativeDB = (context as any)?.env?.DB
  const auth = await requireAdmin(req, nativeDB)
  if (!auth.ok) return auth.error

  try {
    const { orderId, reason } = await req.json()
    if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 })
    if (!reason || !String(reason).trim()) {
      return NextResponse.json({ error: "A reason is required to reverse a payment" }, { status: 400 })
    }
    const trimmedReason = String(reason).trim()

    const order = row1(await d1Query("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId], nativeDB))
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 })

    const status = String(order.status ?? "")
    if (NOT_YET_PAID.has(status)) {
      return NextResponse.json(
        { error: `This order hasn't been paid (status "${status}") — use Cancel Order instead.` },
        { status: 409 },
      )
    }
    if (ALREADY_TERMINAL.has(status)) {
      return NextResponse.json({ error: `This order is already "${status}".` }, { status: 409 })
    }

    const buyerId       = String(order.buyer_id ?? "")
    const sellerId       = String(order.seller_id ?? "")
    const itemTitle      = String(order.item_title ?? "your order")
    const amount         = Number(order.total_amount ?? 0)
    const payoutAmount   = Number(order.seller_payout ?? 0)
    const provider       = String(order.payment_provider ?? "")
    const reference      = String(order.payment_reference ?? "")
    const wasCompleted   = status === "completed" || String(order.escrow_status ?? "") === "released_to_seller"
    const now = new Date().toISOString()

    // ── 1. Claw back the seller payout if it was already released ──────
    let walletReversed = false
    if (wasCompleted && sellerId && payoutAmount > 0) {
      const wallet = row1(await d1Query("SELECT * FROM seller_wallets WHERE user_id = ? LIMIT 1", [sellerId], nativeDB))
      const bal    = Number(wallet?.balance ?? 0)
      const earned = Number(wallet?.total_earned ?? 0)
      const newBal = bal - payoutAmount

      if (wallet) {
        await d1Query(
          `UPDATE seller_wallets SET balance = ?, updated_at = ? WHERE user_id = ?`,
          [newBal, now, sellerId],
          nativeDB,
        )
      } else {
        // No wallet row somehow — create one, going negative, so the debit
        // is still visible rather than silently dropped.
        await d1Query(
          `INSERT INTO seller_wallets (id, user_id, balance, total_earned, pending_balance, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), sellerId, newBal, 0, 0, now],
          nativeDB,
        )
      }

      await d1Query(
        `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, gross_amount, description, order_id, reference, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(), sellerId, "debit", -payoutAmount, newBal,
          amount, `Payment reversed by admin — order #${String(orderId).slice(0, 8).toUpperCase()}: ${trimmedReason}`,
          orderId, reference, "completed", now,
        ],
        nativeDB,
      )
      walletReversed = true
    }

    // ── 2. Attempt a real refund via whichever provider was used, so the ──
    // buyer's money actually goes back to their card/bank.
    let paystackRefund: { attempted: boolean; ok: boolean; error?: string } = { attempted: false, ok: false }
    let flutterwaveRefund: { attempted: boolean; ok: boolean; error?: string } = { attempted: false, ok: false }
    if (provider === "paystack" && reference) {
      paystackRefund.attempted = true
      const result = await refundPaystack(reference, amount || undefined)
      paystackRefund.ok = result.ok
      if (!result.ok) paystackRefund.error = result.error
    } else if (provider === "flutterwave" && reference) {
      flutterwaveRefund.attempted = true
      const result = await refundFlutterwave(reference, amount || undefined)
      flutterwaveRefund.ok = result.ok
      if (!result.ok) flutterwaveRefund.error = result.error
    }

    // ── 3. Flip the order to refunded regardless — this is the admin's ──
    // record of what happened, independent of whether the upstream
    // Paystack refund call itself succeeded (that failure is surfaced
    // below for the admin to chase manually, e.g. via Paystack dashboard).
    await d1Query(
      `UPDATE orders SET status = ?, escrow_status = ?, updated_at = ? WHERE id = ?`,
      ["refunded", "refunded", now, orderId],
      nativeDB,
    )

    // ── 4. Notify + email both sides ────────────────────────────────────
    if (buyerId) {
      await AdminService.addDoc("notifications", {
        user_id: buyerId, type: "system", title: "💸 Payment Reversed",
        body: `Your payment for "${itemTitle}" has been reversed by Zamorax. Reason: ${trimmedReason}.`,
        link: `/dashboard/buyer/orders/${orderId}`, is_read: false,
      }).catch(() => {})
    }
    if (sellerId) {
      await AdminService.addDoc("notifications", {
        user_id: sellerId, type: "system", title: "⚠️ Order Payment Reversed",
        body: walletReversed
          ? `The payment for "${itemTitle}" was reversed by Zamorax and ${ngn(payoutAmount)} has been deducted from your wallet. Reason: ${trimmedReason}.`
          : `The payment for "${itemTitle}" has been reversed by Zamorax. Reason: ${trimmedReason}.`,
        link: `/dashboard/seller/orders/${orderId}`, is_read: false,
      }).catch(() => {})
    }

    const buyer  = buyerId  ? row1(await d1Query("SELECT * FROM users WHERE uid = ? LIMIT 1", [buyerId], nativeDB))  : null
    const seller = sellerId ? row1(await d1Query("SELECT * FROM users WHERE uid = ? LIMIT 1", [sellerId], nativeDB)) : null

    const buyerEmail = String(buyer?.email ?? "")
    if (buyerEmail) {
      Emails.orderCancelledAdmin(buyerEmail, {
        recipientName: String(buyer?.full_name ?? buyer?.fullName ?? "there"),
        role: "buyer", itemTitle, orderId, amount: ngn(amount), reason: trimmedReason,
      }).catch(() => {})
    }
    const sellerEmail = String(seller?.email ?? "")
    if (sellerEmail) {
      Emails.orderCancelledAdmin(sellerEmail, {
        recipientName: String(seller?.full_name ?? seller?.fullName ?? "there"),
        role: "seller", itemTitle, orderId, amount: ngn(amount), reason: trimmedReason,
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      walletReversed,
      paystackRefund,
      flutterwaveRefund,
    })
  } catch (err: any) {
    console.error("[POST /api/orders/reverse-payment]", err)
    return NextResponse.json({ error: err.message ?? "Server error" }, { status: 500 })
  }
}
