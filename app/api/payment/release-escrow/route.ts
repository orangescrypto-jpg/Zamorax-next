// app/api/payment/release-escrow/route.ts
// Admin-only: manually release a Flutterwave-held escrow order that's
// stuck past its normal delivery-confirmation flow (buyer never confirmed
// delivery, so initiatePayout/handleFlutterwaveEscrowRelease in
// /api/payment/transfer was never triggered).
//
// Looks the order up by id, requires it to be in escrow_held with a
// flw_transaction_id on file (see migration 0004 — orders paid before that
// migration won't have one; those still need a manual Flutterwave-side fix
// using the transaction id from the Flutterwave dashboard directly), calls
// Flutterwave's escrow/settle endpoint, then marks the order completed.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-server"
import { AdminService } from "@/src/services"

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.error

  try {
    const { orderId, adminId } = await req.json()
    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 })
    }

    const order = await AdminService.getDoc("orders", orderId) as Record<string, any> | null
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    if (order.paymentProvider !== "flutterwave" && order.payment_provider !== "flutterwave") {
      return NextResponse.json(
        { error: "Only Flutterwave escrow orders can be released here" },
        { status: 400 },
      )
    }

    if (order.status !== "escrow_held" && order.status !== "completed") {
      return NextResponse.json(
        { error: `Order is not releasable (status: ${order.status})` },
        { status: 400 },
      )
    }

    const escrowStatus = order.escrowStatus ?? order.escrow_status
    if (order.status === "completed" && escrowStatus !== "release_pending") {
      // Already fully released (or a non-escrow completed order) — nothing to do.
      return NextResponse.json(
        { error: "This order's escrow is already released" },
        { status: 400 },
      )
    }

    const flwTransactionId = order.flwTransactionId ?? order.flw_transaction_id
    if (!flwTransactionId) {
      return NextResponse.json(
        {
          error:
            "No Flutterwave transaction id on file for this order — it was paid before this was tracked. " +
            "Find the transaction id in the Flutterwave dashboard and settle it directly via " +
            "POST https://api.ravepay.co/v2/gpx/transactions/escrow/settle.",
        },
        { status: 422 },
      )
    }

    const secretKey = process.env.FLW_SECRET_KEY
    if (!secretKey) {
      return NextResponse.json({ error: "FLW_SECRET_KEY not configured" }, { status: 500 })
    }

    const res = await fetch("https://api.ravepay.co/v2/gpx/transactions/escrow/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: String(flwTransactionId), secret_key: secretKey }),
    })
    const data = await res.json()

    if (!res.ok || data.status !== "success") {
      return NextResponse.json(
        { success: false, error: data.message || "Flutterwave escrow release failed" },
        { status: 400 },
      )
    }

    const now = new Date().toISOString()
    await AdminService.updateDoc("orders", orderId, {
      status: "completed",
      escrow_status: "released_to_seller",
      released_to_seller: 1,
      completed_at: now,
      escrow_release_at: now,
    })

    // FIX: same missing total_sales increment as the other two completion
    // paths (confirm-delivery, cron auto-release) — this admin-triggered
    // path was the third place an order gets marked completed, and it had
    // the same gap.
    const sellerId = order.seller_id ?? order.sellerId
    if (sellerId) {
      const sellerUser = await AdminService.getDoc("users", String(sellerId)) as Record<string, unknown> | null
      await AdminService.updateDoc("users", String(sellerId), {
        total_sales: Number(sellerUser?.total_sales ?? sellerUser?.totalSales ?? 0) + 1,
        updated_at:  now,
      })
    }

    return NextResponse.json({ success: true, orderId, releasedBy: adminId ?? null })
  } catch (err: any) {
    console.error("[payment/release-escrow] Unexpected error:", err)
    return NextResponse.json({ success: false, error: err.message || "Escrow release failed" }, { status: 500 })
  }
}
