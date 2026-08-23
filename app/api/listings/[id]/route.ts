// app/api/listings/[id]/route.ts
// Public endpoint — returns a single listing by ID regardless of status.
// Used by the listing detail page server component and ListingsService.getListingById().
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<{ id: string }>; env?: { DB?: unknown } }

function rowToListing(row: Record<string, unknown>) {
  const parse = (v: unknown) => {
    if (!v) return undefined
    try { return JSON.parse(v as string) } catch { return v }
  }
  return {
    id:                 String(row.id),
    sellerId:           String(row.seller_id        ?? ""),
    categoryId:         String(row.category_id      ?? ""),
    categorySlug:       String(row.category         ?? row.category_slug ?? ""),
    title:              String(row.title            ?? ""),
    slug:               String(row.slug             ?? row.id ?? ""),
    description:        String(row.description      ?? ""),
    listingType:        String(row.listing_type     ?? "sale"),
    condition:          (["brand_new", "open_box", "grade_a", "grade_b"].includes(String(row.condition)) ? String(row.condition) : "grade_a"),
    priceSale:          Number(row.price            ?? row.price_sale ?? 0),
    priceRentDaily:     row.price_rent_day          ? Number(row.price_rent_day)   : undefined,
    priceRentWeekly:    row.price_rent_week         ? Number(row.price_rent_week)  : undefined,
    depositAmount:      row.deposit_amount          ? Number(row.deposit_amount)   : undefined,
    images:             parse(row.images)           ?? [],
    verificationVideo:  row.verification_video      ? String(row.verification_video) : undefined,
    attributes:         parse(row.attributes)       ?? {},
    isHubVerified:      !!row.is_hub_verified,
    isFBZ:              !!row.is_fbz,
    deliveryFeeOverrideKobo: row.delivery_fee_override_kobo != null ? Number(row.delivery_fee_override_kobo) : null,
    isActive:           row.status === "active",
    isBoosted:          !!row.is_boosted,
    isZamoraxPick:      !!row.is_zamorax_pick,
    // Live fulfillment source of truth for this listing — 'zamorax' if the
    // FBZ intake flow activated this listing (row.fulfilled_by, set by
    // admin/fbz on intake) OR the seller account/listing is official.
    // Used by SellerOrderCard to disable "Mark Shipped" on ANY order
    // (regardless of when it was created) when the listing is currently
    // FBZ or official, not just orders that were stamped at creation time.
    fulfilledBy:        row.fulfilled_by === "zamorax" || row.is_official_seller || row.is_zamorax_pick
                           ? "zamorax" : "seller",
    isOfficial:         !!row.is_official_seller || !!row.is_zamorax_pick,
    boostType:          String(row.boost_type       ?? "none"),
    boostExpiresAt:     row.boost_expires_at        ? String(row.boost_expires_at) : undefined,
    status:             String(row.status           ?? "pending"),
    rejectionReason:    row.rejection_reason        ? String(row.rejection_reason) : undefined,
    nigerianState:      String(row.nigerian_state   ?? row.seller_state ?? ""),
    city:               String(row.city             ?? ""),
    deliveryNationwide: !!row.delivery_nationwide,
    weightKg:           row.weight_kg               ? Number(row.weight_kg)        : undefined,
    isFragile:          row.is_fragile              ? !!row.is_fragile             : undefined,
    shippingMethods:    parse(row.delivery_options  ?? row.shipping_methods)       ?? undefined,
    estimatedDeliveryDays: row.estimated_delivery_days ? String(row.estimated_delivery_days) : undefined,
    stockQty:           row.stock_qty != null       ? Number(row.stock_qty)        : undefined,
    views:              Number(row.views            ?? 0),
    saves:              Number(row.saves            ?? 0),
    inquiries:          Number(row.inquiries        ?? 0),
    sellerName:         row.seller_name             ? String(row.seller_name)      : undefined,
    sellerPlan:         row.seller_plan             ? String(row.seller_plan)      : undefined,
    sellerRating:       row.seller_rating           ? Number(row.seller_rating)    : undefined,
    sellerVerified:     row.seller_verified         ? !!row.seller_verified        : undefined,
    flashDeal:          parse(row.flash_deal)       ?? null,
    bulkPricing:        parse(row.bulk_pricing)     ?? null,
    minOrderQty:        row.min_order_qty != null   ? Number(row.min_order_qty)    : null,
    unitOfSale:         row.unit_of_sale            ? String(row.unit_of_sale)     : null,
    offersEnabled:      row.offers_enabled == null  ? true : !!row.offers_enabled,
    coupon:             row.coupon_enabled && row.coupon_code
      ? { code: String(row.coupon_code), discountPercent: Number(row.coupon_discount_percent ?? 0) }
      : null,
    vacationMode:       row.vacation_mode           ? !!row.vacation_mode          : undefined,
    vacationReturnDate: row.vacation_return_date    ? String(row.vacation_return_date) : undefined,
    createdAt:          String(row.created_at       ?? new Date().toISOString()),
    updatedAt:          String(row.updated_at       ?? new Date().toISOString()),
  }
}

export async function GET(
  _req: NextRequest,
  context: RouteContext,
) {
  const nativeDB = (context as any)?.env?.DB

  try {
    const { id } = await context.params

    const result = await d1Query(
      `SELECT listings.*,
              (SELECT is_official FROM users WHERE users.uid = listings.seller_id) AS is_official_seller
       FROM listings
       WHERE listings.id = ?
       LIMIT 1`,
      [id],
      nativeDB,
    )
    const rows = (result as any)?.results ?? []
    const row  = rows[0]

    if (!row) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 })
    }

    return NextResponse.json(rowToListing(row))
  } catch (err: any) {
    console.error("[GET /api/listings/:id]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
