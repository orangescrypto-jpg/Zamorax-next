// app/api/listings/official/route.ts
// Public endpoint — no auth required. Returns active listings belonging to
// official Zamorax-owned sellers (e.g. "Zamorax Enterprises Ltd" — bulk-
// sourced, locally warehoused stock). "Official" is a flag on the seller
// (users.is_official), not on the listing — see migration 0002 — so this
// route joins listings to users rather than reading a per-listing column.
//
// Supports optional query params:
//   ?limit=N        cap results (homepage section uses the admin-configured
//                    homepageZamoraxDirectCount; the dedicated /zamorax-direct
//                    page can omit this or pass a larger page size)
//   ?category=slug  filter to one category (used by the per-category
//                    "Zamorax Direct only" toggle)
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

function rowToListing(row: Record<string, unknown>) {
  let images: string[] = []
  try { images = JSON.parse(row.images as string ?? "[]") } catch { images = [] }

  let flashDeal: Record<string, unknown> | null = null
  try { flashDeal = row.flash_deal ? JSON.parse(row.flash_deal as string) : null } catch { flashDeal = null }

  let bulkPricing: { minQty: number; price: number }[] | null = null
  try { bulkPricing = row.bulk_pricing ? JSON.parse(row.bulk_pricing as string) : null } catch { bulkPricing = null }

  const coupon = row.coupon_enabled && row.coupon_code
    ? { code: String(row.coupon_code), discountPercent: Number(row.coupon_discount_percent ?? 0) }
    : null

  const standingDiscount = row.standing_discount_enabled && row.standing_discount_percent
    ? { discountPercent: Number(row.standing_discount_percent ?? 0) }
    : null

  return {
    id:             row.id,
    sellerId:       row.seller_id,
    sellerName:     row.seller_name,
    title:          row.title,
    description:    row.description,
    priceSale:      Number(row.price) || 0,
    categorySlug:   row.category,
    condition:      row.condition,
    listingType:    row.listing_type || "sale",
    priceRentDaily: row.price_rent_day != null ? Number(row.price_rent_day) : undefined,
    images,
    status:         row.status,
    isBoosted:      !!row.is_boosted,
    // True either because the seller itself is official (Zamorax
    // Enterprises), or because admin picked this specific listing to
    // showcase here — both cases render identically in Zamorax Direct.
    isOfficial:     !!row.is_official_seller || !!row.is_zamorax_pick,
    isZamoraxPick:  !!row.is_zamorax_pick,
    flashDeal,
    isFlashDeal:    !!row.is_flash_deal,
    bulkPricing,
    minOrderQty:    row.min_order_qty != null ? Number(row.min_order_qty) : null,
    unitOfSale:     row.unit_of_sale ? String(row.unit_of_sale) : null,
    offersEnabled:  row.offers_enabled == null ? true : !!row.offers_enabled,
    coupon,
    standingDiscount,
    nigerianState:  row.nigerian_state,
    city:           row.city,
    views:          Number(row.views) || 0,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  const nativeDB = (context as any)?.env?.DB

  const { searchParams } = new URL(req.url)
  const limitParam    = Number(searchParams.get("limit"))
  const limit          = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 24
  const category       = searchParams.get("category")

  try {
    const conditions: string[] = [
      "l.status = 'active'",
      "(u.is_official = 1 OR l.is_zamorax_pick = 1)",
    ]
    const params: unknown[] = []

    if (category) {
      conditions.push("l.category = ?")
      params.push(category)
    }

    params.push(limit)

    const rows = await d1Query(
      `SELECT l.*, u.is_official AS is_official_seller FROM listings l
       JOIN users u ON u.uid = l.seller_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY l.is_boosted DESC, l.created_at DESC
       LIMIT ?`,
      params,
      nativeDB,
    )

    const listings = ((rows as any)?.results ?? []).map((r: any) => rowToListing(r))
    return NextResponse.json({ listings })
  } catch (err: any) {
    console.error("[listings/official]", err)
    return NextResponse.json({ listings: [], _debugError: err?.message ?? String(err) })
  }
}
