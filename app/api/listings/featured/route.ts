// app/api/listings/featured/route.ts
// Public endpoint — no auth required. Returns listings shown in the
// homepage "Featured Listings" section: paid boosts (listings.is_boosted,
// set by /api/boosts/activate after Paystack payment) PLUS listings admin
// manually picked to feature (listings.is_zamorax_pick), regardless of
// payment. This is NOT the same as "official seller" — being sold by an
// official/Zamorax-owned seller (users.is_official) does not by itself
// earn a spot here.
//
// FIX: this route previously included `u.is_official = 1` in the WHERE
// clause, so every listing from an official seller showed up in Featured
// for free, whether or not it was boosted or admin-picked. Featured is
// meant to be paid-placement-or-admin-curated only; official-seller
// listings belong to the separate "Zamorax Direct" section
// (see app/api/listings/official) unless they're also boosted/picked.
//
// Supports optional query params:
//   ?limit=N        cap results
//   ?category=slug  filter to one category
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
    ? { discountPercent: Number(row.standing_discount_percent ?? 0), applyToBulk: !!row.standing_discount_apply_to_bulk }
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
    isFBZ:          !!row.is_fbz,
    isHubVerified:  !!row.is_hub_verified,
    deliveryFeeOverrideKobo: row.delivery_fee_override_kobo != null ? Number(row.delivery_fee_override_kobo) : null,
    estimatedDeliveryDays: row.estimated_delivery_days ? String(row.estimated_delivery_days) : undefined,
    weightKg:       row.weight_kg != null ? Number(row.weight_kg) : undefined,
    isFragile:      row.is_fragile ? !!row.is_fragile : undefined,
    shippingMethods: (() => {
      try { return row.delivery_options ? JSON.parse(row.delivery_options as string) : (row.shipping_methods ? JSON.parse(row.shipping_methods as string) : undefined) }
      catch { return undefined }
    })(),
    // Official/Zamorax-pick badges can still show on a featured card if the
    // seller happens to also be official — that's just informational styling,
    // not what determined inclusion in this list (is_boosted did).
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
      "(l.is_boosted = 1 OR l.is_zamorax_pick = 1)",
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
       ORDER BY l.created_at DESC
       LIMIT ?`,
      params,
      nativeDB,
    )

    const listings = ((rows as any)?.results ?? []).map((r: any) => rowToListing(r))
    return NextResponse.json({ listings })
  } catch (err: any) {
    console.error("[listings/featured]", err)
    return NextResponse.json({ listings: [], _debugError: err?.message ?? String(err) })
  }
}
