// app/api/admin/orders/[id]/ship/route.ts
// Admin/moderator-only: mark an order as shipped by Zamorax (goods are
// already physically with Zamorax, so Zamorax staff — not the seller — will
// handle it from here).
//
// GATED to orders Zamorax actually fulfills:
//   - the listing was admin-picked for "Zamorax Direct" (listings.is_zamorax_pick), OR
//   - the seller's account itself is official (users.is_official), OR
//   - the listing was activated for FBZ (listings.is_fbz), regardless of seller status
// Any other order is rejected with 403 — for a regular (non-official,
// non-FBZ) order, only the seller can mark it shipped, same as today.
//
// This route ONLY changes fulfillment tracking (fulfilled_by /
// marked_shipped_by / marked_shipped_at) and the order status. It never
// touches seller_payout, escrow_status, or wallet balances — money still
// reaches the seller's wallet exactly the way it always has, via the normal
// escrow-release flow once the buyer confirms delivery (or auto-release).
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { requireModerator } from "@/lib/auth-server"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<{ id: string }>; env?: { DB?: unknown } }

export async function POST(req: NextRequest, context: RouteContext) {
  // requireModerator allows role "admin" OR "moderator" — both can use this action.
  const auth = await requireModerator(req)
  if (!auth.ok) return auth.error

  const { id: orderId } = await context.params
  const nativeDB = (context as any)?.env?.DB

  const orderRes = await d1Query(
    `SELECT o.id, o.status, o.listing_id, o.seller_id, o.buyer_id, o.fulfilled_by,
            l.is_zamorax_pick AS listing_is_pick,
            l.is_fbz          AS listing_is_fbz,
            u.is_official     AS seller_is_official
     FROM orders o
     LEFT JOIN listings l ON l.id = o.listing_id
     LEFT JOIN users    u ON u.uid = o.seller_id
     WHERE o.id = ?
     LIMIT 1`,
    [orderId],
    nativeDB,
  )
  const order = (orderRes as any)?.results?.[0]
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 })
  }

  const isZamoraxFulfilled = !!order.listing_is_pick || !!order.seller_is_official || !!order.listing_is_fbz
  if (!isZamoraxFulfilled) {
    return NextResponse.json(
      { error: "This order isn't eligible. Only orders for official listings, official-seller accounts, or FBZ-activated listings can be marked shipped by an admin/moderator." },
      { status: 403 },
    )
  }

  // Only makes sense once escrow is active — same guard the seller-side
  // "Mark Shipped" button already enforces, kept consistent here.
  if (order.status !== "escrow_held") {
    return NextResponse.json(
      { error: "Payment isn't confirmed yet for this order — escrow must be active before it can be marked shipped." },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  await d1Query(
    `UPDATE orders
     SET status = 'shipped',
         fulfilled_by = 'zamorax',
         marked_shipped_by = ?,
         marked_shipped_at = ?,
         updated_at = ?
     WHERE id = ?`,
    [auth.uid, now, now, orderId],
    nativeDB,
  )

  // Notify both sides — buyer that it shipped, seller that Zamorax is
  // handling fulfillment on their behalf (their flow/timeline is unaffected;
  // they still get paid out the normal way once delivery is confirmed).
  await d1Query(
    `INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at)
     VALUES (?, ?, 'system', ?, ?, ?, 0, ?)`,
    [
      `notif_${Date.now()}_buyer`,
      order.buyer_id,
      "📦 Your item has shipped!",
      "Zamorax is handling fulfillment for this order.",
      `/dashboard/buyer/orders/${orderId}`,
      now,
    ],
    nativeDB,
  )
  await d1Query(
    `INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at)
     VALUES (?, ?, 'system', ?, ?, ?, 0, ?)`,
    [
      `notif_${Date.now()}_seller`,
      order.seller_id,
      "Zamorax is handling this order's fulfillment",
      "An admin marked this order as shipped since the goods are with Zamorax. You'll still be paid out as normal once delivery is confirmed.",
      `/dashboard/seller/orders/${orderId}`,
      now,
    ],
    nativeDB,
  )

  return NextResponse.json({ success: true, orderId, fulfilledBy: "zamorax" })
}
