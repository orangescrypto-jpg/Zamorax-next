// app/api/admin/backfill-total-sales/route.ts
// One-time backfill: recomputes every seller's users.total_sales from the
// actual count of their completed orders.
//
// WHY THIS EXISTS:
// None of the three order-completion paths (confirm-delivery,
// cron/escrow-release, payment/release-escrow) ever incremented
// users.total_sales — they credited the seller's wallet correctly, but the
// sales counter itself (shown on the listing page as "X sales", and fed
// into SellerTrustScore's order-count points) stayed frozen at 0 forever,
// regardless of how many orders a seller had actually completed.
//
// That gap is now fixed going forward (all three routes increment
// total_sales on completion), but it does nothing for orders that
// completed BEFORE the fix shipped. This route is the one-time catch-up:
// it recounts real completed orders per seller and overwrites total_sales
// to match, rather than incrementing — so it's safe to run more than once
// (idempotent) and safe even if some sellers' counts had already drifted
// for other reasons.
//
// Call POST /api/admin/backfill-total-sales (admin only) once after deploy.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-server"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

export async function POST(req: NextRequest, context: RouteContext) {
  const nativeDB = (context as any)?.env?.DB
  const auth = await requireAdmin(req, nativeDB)
  if (!auth.ok) return auth.error

  try {
    // One row per seller with their real completed-order count, computed
    // directly from orders — this is the source of truth, not whatever
    // total_sales currently holds.
    const counts = await d1Query(
      `SELECT seller_id, COUNT(*) as real_count
       FROM orders
       WHERE status = 'completed' AND seller_id IS NOT NULL AND seller_id != ''
       GROUP BY seller_id`,
      [],
      nativeDB,
    )
    const rows = (counts?.results ?? []) as { seller_id: string; real_count: number }[]

    if (rows.length === 0) {
      return NextResponse.json({ success: true, updated: 0, message: "No completed orders found" })
    }

    const now = new Date().toISOString()
    const results: { sellerId: string; before: number | null; after: number }[] = []

    for (const row of rows) {
      const sellerId   = String(row.seller_id)
      const realCount  = Number(row.real_count) || 0

      const userRows = await d1Query("SELECT total_sales FROM users WHERE id = ? LIMIT 1", [sellerId], nativeDB)
      const before   = (userRows?.results?.[0] as { total_sales?: number } | undefined)?.total_sales ?? null

      // Overwrite rather than increment — this is a resync to the real
      // count, not an additive credit, so running it twice (or after
      // manually correcting a seller's count) can't double-count anything.
      await d1Query(
        `UPDATE users SET total_sales = ?, updated_at = ? WHERE id = ?`,
        [realCount, now, sellerId],
        nativeDB,
      )

      results.push({ sellerId, before, after: realCount })
    }

    return NextResponse.json({
      success: true,
      updated: results.length,
      results,
    })
  } catch (err: any) {
    console.error("[admin/backfill-total-sales]", err)
    return NextResponse.json({ error: err.message ?? "Backfill failed" }, { status: 500 })
  }
}
