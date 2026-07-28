// app/api/admin/recover-flutterwave-order/route.ts
//
// WHY THIS EXISTS:
// One-off manual recovery for a Flutterwave payment that Flutterwave
// confirms as successful, but for which no order row was ever created —
// e.g. the buyer's browser retries exhausted before settlement, AND the
// webhook wasn't configured/working yet at the time of that specific
// transaction (so the server-side fallback never fired for it either).
//
// This re-verifies the tx_ref directly with Flutterwave (never trusts a
// client-supplied "it succeeded" claim), then creates the order the same
// way /api/orders/create-verified-flutterwave and the webhook fallback do.
// Works for both single-item (Buy Now) and cart checkouts — it looks for
// an orderDraft in the transaction's own meta first (set by BuyNowModal),
// falling back to a pending_payments row (set by cart checkout) if no
// orderDraft is present.
//
// Admin-only, and idempotent — safe to call twice for the same reference.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-server"
import { AdminService } from "@/src/services/admin"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

export async function POST(req: NextRequest, context: RouteContext) {
  const nativeDB = (context as any)?.env?.DB
  const auth = await requireAdmin(req, nativeDB)
  if (!auth.ok) return auth.error

  try {
    const { reference } = await req.json()
    if (!reference) {
      return NextResponse.json({ error: "Missing reference" }, { status: 400 })
    }

    // Idempotent — if an order already exists for this reference, just
    // report it instead of creating a duplicate.
    const existingOrders = await AdminService.getCollection("orders") as Record<string, unknown>[]
    const already = existingOrders.filter(o =>
      (o.paymentReference ?? (o as any).payment_reference) === reference ||
      (o.cartPaymentRef ?? (o as any).cart_payment_ref) === reference
    )
    if (already.length > 0) {
      return NextResponse.json({ success: true, orderIds: already.map(o => o.id), alreadyExisted: true })
    }

    const secretKey = process.env.FLW_SECRET_KEY
    if (!secretKey) return NextResponse.json({ error: "Flutterwave secret key not configured" }, { status: 500 })

    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )
    const verifyData = await verifyRes.json()
    if (verifyData.status !== "success" || verifyData.data?.status !== "successful") {
      return NextResponse.json({ error: "Flutterwave does not report this reference as a successful payment." }, { status: 402 })
    }

    const tx = verifyData.data
    const flwTransactionId = tx?.id ?? null

    // ── Path 1: cart checkout — draft lives in pending_payments ──────
    const pendingPayments = await AdminService.getCollection("pending_payments") as Record<string, unknown>[]
    const cartPayment = pendingPayments.find(p => String(p.reference) === reference)
    if (cartPayment) {
      const origin = req.nextUrl?.origin || new URL(req.url).origin
      const res = await fetch(`${origin}/api/cart/create-pending-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return NextResponse.json({ error: data.error || "Cart order creation failed" }, { status: res.status })
      }
      return NextResponse.json({ success: true, orderIds: data.orderIds, source: "cart" })
    }

    // ── Path 2: single-item (Buy Now) — draft lives in tx meta ───────
    const draft = (tx?.meta as Record<string, unknown> | undefined)?.orderDraft
      ?? (tx?.meta_data as any[])?.find?.((m: any) => m.metaname === "orderDraft")?.metavalue
    const orderDraft = typeof draft === "string" ? JSON.parse(draft) : draft

    if (!orderDraft || !orderDraft.buyerId || !orderDraft.sellerId || !orderDraft.listingId) {
      return NextResponse.json({
        error: "No orderDraft found in this transaction's metadata, and no matching pending_payments row. Cannot reconstruct the order automatically — check Flutterwave's transaction detail for buyer/listing info and create the order manually.",
      }, { status: 404 })
    }

    const orderId = crypto.randomUUID()
    await AdminService.setDoc("orders", orderId, {
      id: orderId, buyer_id: orderDraft.buyerId, buyer_name: orderDraft.buyerName ?? "",
      seller_id: orderDraft.sellerId, seller_name: orderDraft.sellerName ?? "",
      seller_store_name: orderDraft.sellerStoreName ?? "",
      listing_id: orderDraft.listingId, item_title: orderDraft.itemTitle ?? "Order",
      item_image: orderDraft.itemImage ?? "",
      total_amount: orderDraft.totalAmount ?? 0, platform_fee: orderDraft.platformFee ?? 0,
      seller_payout: orderDraft.sellerPayout ?? 0,
      delivery_street: orderDraft.deliveryStreet ?? "", delivery_city: orderDraft.deliveryCity ?? "",
      delivery_state: orderDraft.deliveryState ?? "", delivery_lga: orderDraft.deliveryLGA ?? "",
      delivery_method: orderDraft.deliveryMethod ?? "meetup",
      seller_state: orderDraft.sellerState ?? "", buyer_state: orderDraft.buyerState ?? "",
      item_price: orderDraft.itemPrice ?? 0,
      selected_color: orderDraft.selectedColor ?? null, selected_size: orderDraft.selectedSize ?? null,
      status: "escrow_held", escrow_status: "held", escrow_held_at: new Date().toISOString(),
      order_type: "purchase", payment_reference: reference, payment_provider: "flutterwave",
      flw_transaction_id: flwTransactionId,
      is_offer_order: !!orderDraft.isOfferOrder, offer_id: orderDraft.offerId ?? null,
      original_price: orderDraft.originalPrice ?? null,
    })

    try {
      await d1Query(
        `UPDATE listings SET stock_qty = stock_qty - 1 WHERE id = ? AND stock_qty IS NOT NULL AND stock_qty >= 1`,
        [orderDraft.listingId],
        nativeDB,
      )
    } catch (err) {
      console.error("recover-flutterwave-order: stock decrement failed:", err)
    }

    if (orderDraft.isOfferOrder && orderDraft.listingId && orderDraft.buyerId) {
      try {
        const { OffersService } = await import("@/src/services")
        await OffersService.markOfferUsed(orderDraft.listingId, orderDraft.buyerId)
      } catch (err) {
        console.error("recover-flutterwave-order: markOfferUsed failed:", err)
      }
    }

    try {
      const { ReferralsService } = await import("@/src/services/referrals")
      await ReferralsService.triggerFirstOrderBonus(orderDraft.buyerId)
    } catch (err) {
      console.error("recover-flutterwave-order: referral bonus failed:", err)
    }

    return NextResponse.json({ success: true, orderId, flwTransactionId, source: "buy_now" })
  } catch (err: any) {
    console.error("recover-flutterwave-order error:", err)
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 })
  }
}
