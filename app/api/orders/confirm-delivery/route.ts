// app/api/orders/confirm-delivery/route.ts
// Server-side confirm-delivery + escrow release.
//
// WHY THIS EXISTS:
// The buyer's confirm page used to do this whole flow client-side via
// AdminService -> /api/d1/query. That proxy scopes "seller_wallets" writes
// to `WHERE id = <session uid>` (see OWNED_TABLES in app/api/d1/query/route.ts).
// When a BUYER's session calls setDoc("seller_wallets", sellerId, ...), the
// proxy silently rewrites the UPDATE/UPSERT to require id = buyerId, which
// never matches the seller's wallet row (id = sellerId) — so the write
// affects 0 rows. No error is thrown (setDoc/merge treats this as a no-op),
// the order still gets marked "completed", and the seller's wallet is never
// credited. This is exactly the "wallet still shows ₦0.00 after a
// transaction" bug.
//
// Fix: do the whole release server-side, authenticated as the buyer but
// using the server's own D1 access (which isn't subject to the proxy's
// row-scoping), after verifying the caller really is the buyer on the order.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-server"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

export async function POST(req: NextRequest, context: RouteContext) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.error

  const nativeDB = (context as any)?.env?.DB

  try {
    const { orderId } = await req.json()
    if (!orderId) {
      return NextResponse.json({ error: "orderId required" }, { status: 400 })
    }

    const orderRows = await d1Query("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId], nativeDB)
    const order = (orderRows?.results?.[0] ?? null) as Record<string, unknown> | null
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 })

    // Only the buyer on this order can confirm delivery for it.
    const buyerId = String(order.buyer_id ?? order.buyerId ?? "")
    if (buyerId !== auth.uid) {
      return NextResponse.json({ error: "Not authorised" }, { status: 403 })
    }

    // Prevent double-crediting if confirm is called twice (double-tap,
    // retry after a flaky network response, etc).
    const currentStatus = String(order.status ?? "")
    if (currentStatus === "completed") {
      return NextResponse.json({ success: true, alreadyCompleted: true })
    }

    const now = new Date().toISOString()
    const sellerId = String(order.seller_id ?? order.sellerId ?? "")

    // ── Release real funds from Flutterwave escrow (if applicable) ─────
    // Marking the order "completed" below only updates Zamorax's own
    // ledger (seller_wallets) — it does not move any actual money. For
    // orders paid through Flutterwave with the escrow flag on, the real
    // cash is still sitting held at Flutterwave until we explicitly call
    // their /transactions/escrow/settle endpoint (same call the admin
    // "Release Escrow" button on /admin/payments makes — see
    // app/api/payment/release-escrow/route.ts). Doing it here means a
    // normal buyer confirmation releases the real funds immediately
    // instead of leaving them stuck until someone notices and releases
    // manually days later.
    //
    // Non-fatal by design: if this call fails (network blip, Flutterwave
    // downtime, secret key misconfigured), we still complete the order
    // and credit the seller's wallet as before — the admin panel's stuck
    // -escrow button (orders where status stays escrow_held past 7 days)
    // is the fallback net for exactly this case. We log the failure and
    // note it in the wallet_transactions description so it's visible.
    let escrowReleaseFailed = false
    const paymentProvider = String(order.payment_provider ?? order.paymentProvider ?? "")
    const flwTransactionId = order.flw_transaction_id ?? order.flwTransactionId

    if (paymentProvider === "flutterwave" && flwTransactionId) {
      const secretKey = process.env.FLW_SECRET_KEY
      if (!secretKey) {
        console.error("[confirm-delivery] FLW_SECRET_KEY not configured — skipping escrow settle, order will complete anyway")
        escrowReleaseFailed = true
      } else {
        try {
          const flwRes = await fetch("https://api.ravepay.co/v2/gpx/transactions/escrow/settle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: String(flwTransactionId), secret_key: secretKey }),
          })
          const flwData = await flwRes.json()
          if (!flwRes.ok || flwData.status !== "success") {
            console.error("[confirm-delivery] Flutterwave escrow settle failed:", flwData.message || flwData)
            escrowReleaseFailed = true
          }
        } catch (err) {
          console.error("[confirm-delivery] Flutterwave escrow settle request failed:", err)
          escrowReleaseFailed = true
        }
      }
    } else if (paymentProvider === "flutterwave" && !flwTransactionId) {
      // Order predates migration 0004 (flw_transaction_id wasn't being
      // saved yet) — nothing to settle against. Falls back to the admin
      // panel's manual release-via-Flutterwave-dashboard path.
      console.error(`[confirm-delivery] Order ${orderId} is a Flutterwave order with no flw_transaction_id on file — cannot auto-settle`)
      escrowReleaseFailed = true
    }

    // FIX: this previously wrote buyer_confirmed_at, buyer_rating, and
    // buyer_review — none of which exist on the orders table (see
    // migrations/0001_baseline_schema.sql). Ratings/reviews already have
    // their own dedicated flow via ReviewForm -> POST /api/reviews, which
    // writes to the separate `reviews` table — they were never meant to be
    // inline columns here. The only real completion timestamp column is
    // `completed_at`, which this now uses instead of the nonexistent one.
    await d1Query(
      `UPDATE orders SET status = ?, escrow_status = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      [
        "completed",
        escrowReleaseFailed ? "release_pending" : "released_to_seller",
        now, now, orderId,
      ],
      nativeDB,
    )

    // ── Compute payout the same way the old client-side logic did ──────
    const grossKobo = Number(order.total_amount ?? order.totalAmount ?? 0)
    const commKobo  = Number(order.platform_fee ?? order.platformFee ?? 0)
    const arbKobo   = Number(order.arbitration_fee ?? order.arbitrationFee ?? Math.round(grossKobo * 0.005))
    const wdKobo    = Number(order.withdrawal_fee ?? order.withdrawalFee ?? 0)
    let payout = Number(order.seller_payout ?? order.sellerPayout ?? 0)
    if (!payout || payout <= 0) payout = grossKobo - commKobo - arbKobo - wdKobo
    if (!payout || payout <= 0) payout = grossKobo

    if (sellerId && payout > 0) {
      // FIX: seller_wallets' real PK column is `user_id` (see
      // migrations/0001_baseline_schema.sql — "user_id TEXT PRIMARY KEY").
      // This was querying/updating/inserting on a column called `id`,
      // which doesn't exist on this table, so the SELECT always came back
      // empty and the INSERT branch ran every time — meaning any seller
      // with an existing wallet row got a duplicate/failed insert instead
      // of an update, and the seller's real balance was never read or
      // accumulated correctly.
      const walletRows = await d1Query("SELECT * FROM seller_wallets WHERE user_id = ? LIMIT 1", [sellerId], nativeDB)
      const wallet = (walletRows?.results?.[0] ?? null) as Record<string, unknown> | null
      const bal     = Number(wallet?.balance ?? 0)
      const earned  = Number(wallet?.total_earned ?? wallet?.totalEarned ?? 0)
      const pending = Number(wallet?.pending_balance ?? wallet?.pendingBalance ?? 0)
      const newPending = Math.max(0, pending - payout)

      if (wallet) {
        await d1Query(
          `UPDATE seller_wallets SET balance = ?, total_earned = ?, pending_balance = ?, updated_at = ? WHERE user_id = ?`,
          [bal + payout, earned + payout, newPending, now, sellerId],
          nativeDB,
        )
      } else {
        await d1Query(
          `INSERT INTO seller_wallets (user_id, balance, total_earned, pending_balance, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [sellerId, payout, payout, 0, now],
          nativeDB,
        )
      }

      // FIX: this previously inserted into gross_amount, platform_fee, and
      // arbitration_fee — columns that didn't exist yet on
      // wallet_transactions. The seller wallet page's transaction breakdown
      // (app/(seller)/dashboard/seller/wallet/page.tsx) genuinely depends on
      // these as separate fields to show "gross / platform fee / arbitration
      // fee" per transaction, so the right fix is adding the columns (see
      // migrations/0003_wallet_transactions_breakdown.sql) rather than
      // folding them into the description text, which would silently break
      // that breakdown UI instead of erroring.
      await d1Query(
        `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, gross_amount, platform_fee, arbitration_fee, description, order_id, reference, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          sellerId,
          "credit",
          payout,
          bal + payout,
          grossKobo,
          commKobo,
          arbKobo,
          `Escrow released — order #${String(orderId).slice(0, 8).toUpperCase()}`
            + (escrowReleaseFailed ? " (wallet credited; Flutterwave payout pending admin release)" : ""),
          orderId,
          String(order.payment_reference ?? order.paymentReference ?? ""),
          "completed",
          now,
        ],
        nativeDB,
      )

      await d1Query(
        `INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          sellerId,
          "system",
          "💰 Escrow Released!",
          `₦${(payout / 100).toLocaleString("en-NG")} has been credited to your wallet.`,
          "/dashboard/seller/wallet",
          0,
          now,
        ],
        nativeDB,
      )

      // FIX: total_sales on the seller's own user row was never incremented
      // on order completion anywhere in the codebase — the wallet got
      // credited correctly, but "0 sales" kept showing on the listing page
      // and the trust score's order-count points never accrued, for every
      // seller regardless of how many orders they'd actually completed.
      // NOTE: users' primary key column is `uid`, not `id` (see
      // migrations/0001_baseline_schema.sql) — this must match or the
      // UPDATE silently affects 0 rows, same class of bug flagged above
      // for seller_wallets' `user_id` PK.
      await d1Query(
        `UPDATE users SET total_sales = COALESCE(total_sales, 0) + 1, updated_at = ? WHERE uid = ?`,
        [now, sellerId],
        nativeDB,
      )
    }

    // Referral bonus — pays out the first time a referred seller's first
    // order reaches a completed sale. No-op if this seller wasn't
    // referred, isn't a seller referral, or already paid.
    if (sellerId) {
      try {
        const { ReferralsService } = await import("@/src/services/referrals")
        await ReferralsService.triggerSellerFirstSaleBonus(sellerId)
      } catch (err) {
        console.error("confirm-delivery: seller referral bonus failed (non-fatal):", err)
      }
    }

    return NextResponse.json({ success: true, payout, sellerId, escrowReleaseFailed })
  } catch (err: any) {
    console.error("[POST /api/orders/confirm-delivery]", err)
    return NextResponse.json({ error: err.message ?? "Server error" }, { status: 500 })
  }
}

