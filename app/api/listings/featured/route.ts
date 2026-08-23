// app/api/listings/featured/route.ts
// Public endpoint — no auth required. Returns boosted active listings.
// Used by:
//   - Homepage FeaturedListings section (no params — top 8 site-wide)
//   - SponsoredListings on the listing detail page ("Sponsored Products"),
//     which passes category + excludeId to bias results toward the same
//     category as the listing being viewed, falling back to any boosted
//     listing if the category doesn't have enough.
//
// Query params (all optional):
//   ?category=slug   prefer boosted listings in this category first
//   ?excludeId=id    exclude this listing (so a listing doesn't "sponsor" itself)
//   ?limit=N         cap results (default 8)
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

function rowToListing(row: Record<string, unknown>) {
  let images: string[] = []
  try { images = JSON.parse(row.images as string ?? "[]") } catch { images = [] }

  let flashDeal: Record<string, unknown> | null = null
  try { flashDeal = row.flash_deal ? JSON.parse(row.flash_deal as string) : null } catch { flashDeal = null }

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
    isFeatured:     !!row.is_boosted,
    boostEndsAt:    row.boost_expires_at,
    flashDeal,
    isFlashDeal:    !!row.is_flash_deal,
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
  const now = new Date().toISOString()

  const { searchParams } = new URL(req.url)
  const category  = searchParams.get("category")
  const excludeId = searchParams.get("excludeId")
  const limit     = Math.min(Math.max(Number(searchParams.get("limit")) || 8, 1), 20)

  try {
    const excludeClause = excludeId ? `AND id != ?` : ``

    let rows: any
    if (category) {
      // Same-category boosted listings first, then top up with any other
      // boosted listing so the row still fills even if the category is thin.
      const categoryRows = await d1Query(
        `SELECT * FROM listings
         WHERE status = 'active'
           AND is_boosted = 1
           AND category = ?
           AND (boost_expires_at IS NULL OR boost_expires_at > ?)
           ${excludeClause}
         ORDER BY boost_expires_at DESC
         LIMIT ?`,
        excludeId ? [category, now, excludeId, limit] : [category, now, limit],
        nativeDB,
      )
      const categoryResults = (categoryRows as any)?.results ?? []

      if (categoryResults.length < limit) {
        const remaining = limit - categoryResults.length
        const seenIds = categoryResults.map((r: any) => r.id)
        const excludeIds = excludeId ? [excludeId, ...seenIds] : seenIds
        const placeholders = excludeIds.map(() => "?").join(",")

        const fillerRows = await d1Query(
          `SELECT * FROM listings
           WHERE status = 'active'
             AND is_boosted = 1
             AND (boost_expires_at IS NULL OR boost_expires_at > ?)
             ${excludeIds.length ? `AND id NOT IN (${placeholders})` : ``}
           ORDER BY boost_expires_at DESC
           LIMIT ?`,
          excludeIds.length ? [now, ...excludeIds, remaining] : [now, remaining],
          nativeDB,
        )
        rows = { results: [...categoryResults, ...((fillerRows as any)?.results ?? [])] }
      } else {
        rows = { results: categoryResults }
      }
    } else {
      rows = await d1Query(
        `SELECT * FROM listings
         WHERE status = 'active'
           AND is_boosted = 1
           AND (boost_expires_at IS NULL OR boost_expires_at > ?)
           ${excludeClause}
         ORDER BY boost_expires_at DESC
         LIMIT ?`,
        excludeId ? [now, excludeId, limit] : [now, limit],
        nativeDB,
      )
    }

    const listings = ((rows as any)?.results ?? []).map((r: any) => rowToListing(r))
    return NextResponse.json({ listings })
  } catch (err: any) {
    console.error("[listings/featured]", err)
    return NextResponse.json({ listings: [] })
  }
}
