// app/api/orders/create-verified-flutterwave/route.ts
// Creates the order row for a single-item (Buy Now) Flutterwave purchase —
// but only AFTER verifying with Flutterwave that the payment actually
// succeeded. Mirrors /api/orders/create-verified-paystack exactly, just
// swapping the verification call. BuyNowModal stashes the order draft in
// sessionStorage before redirecting to Flutterwave (see
// pending_order_<reference> key) instead of creating the order up front,
// so an abandoned/failed checkout never leaves a fake order behind.
//
// Also captures the Flutterwave transaction id (flw_tx_id) on the order —
// this is required later to call /transactions/escrow/settle when the
// buyer confirms delivery, since that endpoint needs Flutterwave's own
// numeric transaction id, not our tx_ref.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { AdminService } from "@/src/services/admin"
import { d1Query } from "@/lib/d1"
import { ReferralsService } from "@/src/services/referrals"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { reference } = body
    let orderDraft = body.orderDraft
    if (!reference) return NextResponse.json({ error: "Missing reference" }, { status: 400 })

    // Idempotent — if an order already exists for this reference, return it
    // instead of creating a duplicate.
    const existing = await AdminService.getCollection("orders") as Record<string, unknown>[]
    const already = existing.find(o => (o.paymentReference ?? (o as any).payment_reference) === reference)
    if (already) {
      return NextResponse.json({ success: true, orderId: already.id, alreadyExisted: true })
    }

    const secretKey = process.env.FLW_SECRET_KEY
    if (!secretKey) return NextResponse.json({ error: "Flutterwave secret key not configured" }, { status: 500 })

    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )
    const verifyData = await verifyRes.json()
    if (verifyData.status !== "success" || verifyData.data?.status !== "successful") {
      return NextResponse.json({ error: "Payment not verified — no order was created." }, { status: 402 })
    }

    const flwTransactionId = verifyData.data?.id ?? null

    // FIX: don't rely solely on the client-supplied draft (sessionStorage
    // can be lost across the Flutterwave redirect on mobile/PWA contexts).
    // Fall back to the orderDraft embedded in the transaction's own `meta`
    // at initialize time — same source /api/admin/recover-flutterwave-order
    // uses — so this endpoint self-heals without needing manual recovery.
    if (!orderDraft || typeof orderDraft !== "object") {
      const tx = verifyData.data
      const metaDraft = (tx?.meta as Record<string, unknown> | undefined)?.orderDraft
        ?? (tx?.meta_data as any[])?.find?.((m: any) => m.metaname === "orderDraft")?.metavalue
      orderDraft = typeof metaDraft === "string" ? JSON.parse(metaDraft) : metaDraft
    }

    if (!orderDraft || typeof orderDraft !== "object") {
      return NextResponse.json({ error: "Missing order draft" }, { status: 400 })
    }

    const {
      buyerId, buyerName, sellerId, sellerName, sellerStoreName,
      listingId, itemTitle, itemImage, totalAmount, platformFee, sellerPayout,
      deliveryStreet, deliveryCity, deliveryState, deliveryLGA, deliveryMethod,
      sellerState, buyerState, itemPrice, isOfferOrder, offerId, originalPrice,
      lineItems, selectedColor, selectedSize,
    } = orderDraft

    // Quantity ordered — see create-verified-paystack for the same logic.
    const orderQty = Array.isArray(lineItems) && lineItems[0]?.qty > 0 ? Number(lineItems[0].qty) : 1

    if (!buyerId || !sellerId || !listingId) {
      return NextResponse.json({ error: "Order draft missing required fields" }, { status: 400 })
    }

    const orderId = crypto.randomUUID()
    await AdminService.setDoc("orders", orderId, {
      id: orderId, buyer_id: buyerId, buyer_name: buyerName ?? "",
      seller_id: sellerId, seller_name: sellerName ?? "", seller_store_name: sellerStoreName ?? "",
      listing_id: listingId, item_title: itemTitle ?? "Order", item_image: itemImage ?? "",
      total_amount: totalAmount ?? 0, platform_fee: platformFee ?? 0, seller_payout: sellerPayout ?? 0,
      delivery_street: deliveryStreet ?? "", delivery_city: deliveryCity ?? "",
      delivery_state: deliveryState ?? "", delivery_lga: deliveryLGA ?? "",
      delivery_method: deliveryMethod ?? "meetup",
      seller_state: sellerState ?? "", buyer_state: buyerState ?? "",
      item_price: itemPrice ?? 0,
      line_items: JSON.stringify(Array.isArray(lineItems) ? lineItems : []),
      selected_color: selectedColor ?? null, selected_size: selectedSize ?? null,
      // Payment is already verified above — go straight to escrow_held,
      // same as the Paystack flow.
      status: "escrow_held", escrow_status: "held", escrow_held_at: new Date().toISOString(),
      order_type: "purchase", payment_reference: reference, payment_provider: "flutterwave",
      // Flutterwave-specific — needed by the escrow/settle call this
      // order's release flow makes later (see /api/payment/transfer's
      // handleFlutterwaveEscrowRelease, keyed on escrowTxRef).
      flw_transaction_id: flwTransactionId,
      is_offer_order: !!isOfferOrder, offer_id: offerId ?? null, original_price: originalPrice ?? null,
    })

    if (isOfferOrder && listingId && buyerId) {
      try {
        const { OffersService } = await import("@/src/services")
        await OffersService.markOfferUsed(listingId, buyerId)
      } catch (err) {
        console.error("create-verified-flutterwave: markOfferUsed failed (non-fatal):", err)
      }
    }

    // Decrement stock — same reasoning as create-verified-paystack: this
    // order bypasses OrdersService.createOrder, so it never ran the atomic
    // stock decrement. Uses the actual quantity ordered instead of always
    // assuming 1.
    try {
      await d1Query(
        `UPDATE listings SET stock_qty = stock_qty - ? WHERE id = ? AND stock_qty IS NOT NULL AND stock_qty >= ?`,
        [orderQty, listingId, orderQty],
      )
    } catch (err) {
      console.error("create-verified-flutterwave: stock decrement failed:", err)
    }

    // Referral bonus — pays out the first time a referred buyer places
    // an order.
    try {
      await ReferralsService.triggerFirstOrderBonus(buyerId)
    } catch (err) {
      console.error("create-verified-flutterwave: referral bonus failed (non-fatal):", err)
    }

    return NextResponse.json({ success: true, orderId, flwTransactionId })
  } catch (err: any) {
    console.error("create-verified-flutterwave error:", err)
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 })
  }
}
