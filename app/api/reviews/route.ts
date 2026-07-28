// app/api/reviews/route.ts
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { d1Query } from "@/lib/d1"
import { requireAuth } from "@/lib/auth-server"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

// GET /api/reviews?sellerId=xxx  — fetch all reviews for a seller
export async function GET(req: NextRequest, context: RouteContext) {
  const sellerId = req.nextUrl.searchParams.get("sellerId")
  if (!sellerId) {
    return NextResponse.json({ error: "sellerId required" }, { status: 400 })
  }

  const nativeDB = (context as any)?.env?.DB

  try {
    const result = await d1Query(
      "SELECT * FROM reviews WHERE seller_id = ? ORDER BY created_at DESC",
      [sellerId],
      nativeDB,
    )
    // Normalise snake_case columns to camelCase for the frontend
    const reviews = (result?.results ?? []).map((r: any) => ({
      id:              r.id,
      orderId:         r.order_id,
      sellerId:        r.seller_id,
      buyerId:         r.buyer_id,
      buyerName:       r.buyer_name,
      rating:          r.rating,
      comment:         r.comment,
      verifiedPurchase: r.verified_purchase === 1,
      createdAt:       r.created_at,
    }))
    return NextResponse.json({ reviews })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/reviews  — submit a review (buyer only, one per order)
export async function POST(req: NextRequest, context: RouteContext) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.error

  const body = await req.json()
  const { orderId, sellerId, buyerName, rating, comment } = body

  if (!orderId || !sellerId || !rating) {
    return NextResponse.json({ error: "orderId, sellerId, and rating are required" }, { status: 400 })
  }

  const nativeDB = (context as any)?.env?.DB
  const buyerId  = auth.uid
  const id       = `${orderId}_${buyerId}` // deterministic — prevents duplicate reviews

  try {
    // Verify the order belongs to this buyer and is completed
    const orderRows = await d1Query(
      "SELECT buyer_id, status FROM orders WHERE id = ?",
      [orderId],
      nativeDB,
    )
    const order = (orderRows?.results ?? [])[0] as any
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 })
    if (order.buyer_id !== buyerId) return NextResponse.json({ error: "Not your order" }, { status: 403 })
    const verifiedPurchase = order.status === "completed" ? 1 : 0

    // Prevent duplicate
    const existing = await d1Query("SELECT id FROM reviews WHERE id = ?", [id], nativeDB)
    if ((existing?.results ?? []).length > 0) {
      return NextResponse.json({ error: "You have already reviewed this order" }, { status: 409 })
    }

    await d1Query(
      `INSERT INTO reviews (id, order_id, seller_id, buyer_id, buyer_name, rating, comment, verified_purchase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, orderId, sellerId, buyerId, buyerName ?? "Buyer", rating, comment?.trim() ?? "", verifiedPurchase],
      nativeDB,
    )

    // Mark order as reviewed so the review prompt disappears
    await d1Query(
      "UPDATE orders SET buyer_reviewed = 1 WHERE id = ?",
      [orderId],
      nativeDB,
    )

    // FIX: users.seller_rating was never written anywhere — reviews
    // accumulated correctly in this table, but the star average shown on
    // the listing page and fed into SellerTrustScore stayed frozen at
    // whatever it started as (0) forever, no matter how many reviews came
    // in. Recompute the true average across all of this seller's reviews
    // and write it back, so it always reflects reality rather than
    // incrementally drifting from rounding.
    const avgRows = await d1Query(
      "SELECT AVG(rating) as avg_rating FROM reviews WHERE seller_id = ?",
      [sellerId],
      nativeDB,
    )
    const avgRating = Number((avgRows?.results?.[0] as { avg_rating?: number } | undefined)?.avg_rating ?? rating)
    await d1Query(
      "UPDATE users SET seller_rating = ?, updated_at = ? WHERE uid = ?",
      [avgRating, new Date().toISOString(), sellerId],
      nativeDB,
    )

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
