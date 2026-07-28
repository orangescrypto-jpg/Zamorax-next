// app/api/orders/create-verified-paystack/route.ts
// Creates the order row for a single-item (Buy Now) Paystack purchase —
// but only AFTER verifying with Paystack that the payment actually
// succeeded. BuyNowModal stashes the order draft in sessionStorage before
// redirecting to Paystack (see pending_order_<reference> key) instead of
// creating the order up front, so an abandoned/failed checkout never
// leaves a fake order behind. This route is what turns that draft into a
// real order once the buyer lands back from Paystack with a reference.
// Mirrors /api/cart/create-pending-orders, just for single-item orders.
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
    // instead of creating a duplicate (buyer refreshing the orders page, or
    // this effect firing twice, shouldn't create two orders for one payment).
    const existing = await AdminService.getCollection("orders") as Record<string, unknown>[]
    const already = existing.find(o => (o.paymentReference ?? (o as any).payment_reference) === reference)
    if (already) {
      return NextResponse.json({ success: true, orderId: already.id, alreadyExisted: true })
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY
    if (!secretKey) return NextResponse.json({ error: "Paystack secret key not configured" }, { status: 500 })

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    const verifyData = await verifyRes.json()
    if (!verifyData.status || verifyData.data?.status !== "success") {
      return NextResponse.json({ error: "Payment not verified — no order was created." }, { status: 402 })
    }

    // FIX: fall back to Paystack's own stored metadata.orderDraft if the
    // client didn't send one (sessionStorage lost across redirect).
    if (!orderDraft || typeof orderDraft !== "object") {
      const metaDraft = verifyData.data?.metadata?.orderDraft
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

    // Quantity ordered — from lineItems[0].qty (set by BuyNowModal from the
    // buyer's selected bulk-pricing tier). Falls back to 1 for older drafts
    // that predate this field, or if it's missing/invalid for any reason.
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
      // same as the cart flow, instead of landing at "pending" and relying
      // on a separate activation step.
      status: "escrow_held", escrow_status: "held", escrow_held_at: new Date().toISOString(),
      order_type: "purchase", payment_reference: reference, payment_provider: "paystack",
      is_offer_order: !!isOfferOrder, offer_id: offerId ?? null, original_price: originalPrice ?? null,
    })

    if (isOfferOrder && listingId && buyerId) {
      try {
        const { OffersService } = await import("@/src/services")
        await OffersService.markOfferUsed(listingId, buyerId)
      } catch (err) {
        console.error("create-verified-paystack: markOfferUsed failed (non-fatal):", err)
      }
    }

    // Decrement stock — this order bypasses OrdersService.createOrder (it's
    // written directly via setDoc above since the order can't exist until
    // Paystack payment is verified), so unlike the manual/cart flows it
    // never ran the atomic stock decrement. Uses the actual quantity
    // ordered (from lineItems, set by BuyNowModal for the bulk-pricing
    // tier the buyer picked) instead of always assuming 1.
    try {
      await d1Query(
        `UPDATE listings SET stock_qty = stock_qty - ? WHERE id = ? AND stock_qty IS NOT NULL AND stock_qty >= ?`,
        [orderQty, listingId, orderQty],
      )
    } catch (err) {
      console.error("create-verified-paystack: stock decrement failed:", err)
    }

    // Referral bonus — pays out the first time a referred buyer places
    // an order. No-op if this buyer wasn't referred, isn't a buyer
    // referral, or the bonus was already paid.
    try {
      await ReferralsService.triggerFirstOrderBonus(buyerId)
    } catch (err) {
      console.error("create-verified-paystack: referral bonus failed (non-fatal):", err)
    }

    return NextResponse.json({ success: true, orderId })
  } catch (err: any) {
    console.error("create-verified-paystack error:", err)
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 })
  }
}
