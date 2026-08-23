// app/api/admin/orders/route.ts
// Lists ALL orders regardless of status, for the admin Orders page. Unlike
// /admin/payments (which only shows pending_payments rows awaiting manual
// confirmation), this covers escrow_held/shipped/delivered/completed/
// refunded/cancelled orders too — anything an admin might need to force-
// delete or reverse a payment on, no matter what stage it's at.
//
// NOTE on auth: this mirrors every other admin data-read in the codebase
// (AdminService.getCollection hits D1 directly with no requireAdmin check)
// — access control for admin pages is enforced by <RoleGuard
// allowedRoles={["admin"]}> wrapping the whole (admin) route group
// client-side, not per-request here. requireAdmin/requireModerator IS
// still enforced on the routes that actually mutate data (reverse-payment,
// cancel-admin) — this route only reads.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { d1Query } from "@/lib/d1"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(Number(searchParams.get("limit") ?? 100), 200)

    // LEFT JOIN listings + users so the admin page can tell which orders are
    // eligible for the "mark shipped on seller's behalf" action — that
    // action is restricted to orders whose listing was admin-picked
    // (is_zamorax_pick) or whose seller account is official (is_official).
    // See app/api/admin/orders/[id]/ship for the actual gating/mutation.
    const result = await d1Query(
      `SELECT o.*,
              l.is_zamorax_pick AS listing_is_pick,
              u.is_official     AS seller_is_official
       FROM orders o
       LEFT JOIN listings l ON l.id = o.listing_id
       LEFT JOIN users    u ON u.uid = o.seller_id
       ORDER BY o.created_at DESC LIMIT ?`,
      [limit],
    )
    const rows = (result?.results ?? []) as Record<string, unknown>[]

    const orders = rows.map((r) => ({
      id:               String(r.id ?? ""),
      buyerId:          String(r.buyer_id ?? ""),
      buyerName:        String(r.buyer_name ?? ""),
      sellerId:         String(r.seller_id ?? ""),
      sellerName:       String(r.seller_name ?? ""),
      itemTitle:        String(r.item_title ?? "Order"),
      totalAmount:      Number(r.total_amount ?? 0),
      sellerPayout:     Number(r.seller_payout ?? 0),
      status:           String(r.status ?? ""),
      escrowStatus:     String(r.escrow_status ?? ""),
      paymentProvider:  String(r.payment_provider ?? ""),
      paymentReference: String(r.payment_reference ?? ""),
      orderType:        String(r.order_type ?? ""),
      createdAt:        r.created_at ?? null,
      fulfilledBy:      String(r.fulfilled_by ?? "seller"),
      isOfficial:       !!r.listing_is_pick || !!r.seller_is_official,
      deliveryStreet:   String(r.delivery_street ?? ""),
      deliveryCity:     String(r.delivery_city ?? ""),
      deliveryState:    String(r.delivery_state ?? ""),
      deliveryLGA:      String(r.delivery_lga ?? ""),
      deliveryMethod:   String(r.delivery_method ?? ""),
    }))

    return NextResponse.json({ orders })
  } catch (err: any) {
    console.error("[GET /api/admin/orders]", err)
    return NextResponse.json({ error: err.message ?? "Server error" }, { status: 500 })
  }
}
