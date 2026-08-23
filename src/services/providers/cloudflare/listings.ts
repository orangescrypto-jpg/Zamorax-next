// src/services/providers/cloudflare/listings.ts
// getListings → calls /api/listings (server-side D1, no is_active column)
// All mutations: status only, no is_active references
import { AdminService } from "@/src/services/admin"
import type { IListingsService } from "@/src/services/listings"
import type { Listing, ListingFilters, PaginatedResult, Category } from "@/src/types"

const PAGE_SIZE = 20

// Columns needed for listing cards — excludes heavy fields like description/attributes
// that are only needed on the detail page. Reduces read payload significantly.
const LISTING_CARD_COLS = `
  id, seller_id, category_id, category, slug, title, listing_type, condition,
  price, price_rent_day, price_rent_week, deposit_amount,
  images, is_hub_verified, is_fbz, delivery_fee_override_kobo, fulfilled_by, is_boosted, boost_type, boost_expires_at, status,
  nigerian_state, seller_state, city, delivery_nationwide,
  stock_qty, views, saves, inquiries, estimated_delivery_days,
  seller_name, seller_plan, seller_rating, seller_verified,
  flash_deal, bulk_pricing, min_order_qty, unit_of_sale, offers_enabled, low_stock_threshold,
  vacation_mode, vacation_return_date, created_at, updated_at
`.trim()

function mapRow(row: Record<string, unknown>): Listing {
  const parse = (v: unknown) => {
    if (!v) return undefined
    try { return JSON.parse(v as string) } catch { return v }
  }
  return {
    id:                  String(row.id),
    sellerId:            String(row.seller_id        ?? row.sellerId        ?? ""),
    categoryId:          String(row.category_id      ?? row.categoryId      ?? ""),
    categorySlug:        String(row.category         ?? row.category_slug   ?? row.categorySlug ?? ""),
    title:               String(row.title            ?? ""),
    slug:                String(row.slug             ?? row.id              ?? ""),
    description:         String(row.description      ?? ""),
    listingType:         String(row.listing_type     ?? row.listingType     ?? "sale") as Listing["listingType"],
    condition:           String(row.condition        ?? "grade_a") as Listing["condition"],
    priceSale:           Number(row.price            ?? row.price_sale      ?? row.priceSale ?? 0),
    priceRentDaily:      row.price_rent_day          ? Number(row.price_rent_day)          : undefined,
    priceRentWeekly:     row.price_rent_week         ? Number(row.price_rent_week)         : undefined,
    depositAmount:       row.deposit_amount          ? Number(row.deposit_amount)          : undefined,
    images:              parse(row.images)           ?? [],
    verificationVideo:   row.verification_video      ? String(row.verification_video)      : undefined,
    attributes:          parse(row.attributes)       ?? {},
    isHubVerified:       !!row.is_hub_verified,
    isFBZ:               !!row.is_fbz,
    deliveryFeeOverrideKobo: row.delivery_fee_override_kobo != null ? Number(row.delivery_fee_override_kobo) : null,
    isActive:            row.status === "active",
    isBoosted:           !!row.is_boosted,
    boostType:           String(row.boost_type       ?? "none") as Listing["boostType"],
    boostExpiresAt:      row.boost_expires_at        ? String(row.boost_expires_at)        : undefined,
    status:              String(row.status           ?? "pending") as Listing["status"],
    rejectionReason:     row.rejection_reason        ? String(row.rejection_reason)        : undefined,
    nigerianState:       String(row.nigerian_state   ?? row.seller_state    ?? row.nigerianState ?? ""),
    city:                String(row.city             ?? ""),
    deliveryNationwide:  !!row.delivery_nationwide,
    weightKg:            row.weight_kg               ? Number(row.weight_kg)               : undefined,
    isFragile:           row.is_fragile              ? !!row.is_fragile                    : undefined,
    shippingMethods:     (() => {
                            const v = parse(row.delivery_options ?? row.shipping_methods)
                            if (Array.isArray(v)) return v
                            if (typeof v === "string" && v) return [v]
                            return undefined
                          })(),
    estimatedDeliveryDays: row.estimated_delivery_days ? String(row.estimated_delivery_days) : undefined,
    stockQty:            row.stock_qty != null       ? Number(row.stock_qty)               : undefined,
    views:               Number(row.views            ?? 0),
    saves:               Number(row.saves            ?? 0),
    inquiries:           Number(row.inquiries        ?? 0),
    sellerName:          row.seller_name             ? String(row.seller_name)             : undefined,
    sellerPlan:          row.seller_plan             ? String(row.seller_plan) as Listing["sellerPlan"] : undefined,
    sellerRating:        row.seller_rating           ? Number(row.seller_rating)           : undefined,
    sellerVerified:      row.seller_verified         ? !!row.seller_verified               : undefined,
    flashDeal:           parse(row.flash_deal)       ?? null,
    bulkPricing:         parse(row.bulk_pricing)     ?? null,
    minOrderQty:         row.min_order_qty != null    ? Number(row.min_order_qty)          : null,
    unitOfSale:          row.unit_of_sale             ? String(row.unit_of_sale)            : null,
    offersEnabled:       row.offers_enabled == null   ? true : !!row.offers_enabled,
    lowStockThreshold:   row.low_stock_threshold != null ? Number(row.low_stock_threshold) : null,
    vacationMode:        row.vacation_mode           ? !!row.vacation_mode                 : undefined,
    vacationReturnDate:  row.vacation_return_date    ? String(row.vacation_return_date)    : undefined,
    createdAt:           String(row.created_at       ?? new Date().toISOString()),
    updatedAt:           String(row.updated_at       ?? new Date().toISOString()),
  }
}

function mapCategoryRow(row: Record<string, unknown>): Category {
  return {
    id:          String(row.id),
    name:        String(row.name ?? ""),
    slug:        String(row.slug ?? ""),
    icon:        row.icon ? String(row.icon) : undefined,
    imageUrl:    row.image_url ? String(row.image_url) : undefined,
    description: row.description ? String(row.description) : undefined,
    parentId:    row.parent_id ? String(row.parent_id) : undefined,
    phase:       Number(row.phase ?? 1),
    order:       Number(row.order ?? 0),
    isActive:    row.status === "active" || !row.status,
  } as Category
}

export const ListingsService: IListingsService = {

  async getListings(filters: ListingFilters = {}, cursor?: unknown): Promise<PaginatedResult<Listing>> {
    const qs = new URLSearchParams()
    if (filters.category)                   qs.set("category",      filters.category)
    if (filters.listingType)                qs.set("listingType",   filters.listingType)
    if (filters.condition)                  qs.set("condition",     filters.condition)
    if (filters.nigerianState)              qs.set("nigerianState", filters.nigerianState)
    if (filters.verified)                   qs.set("verified",      "true")
    if (filters.minPrice !== undefined)     qs.set("minPrice",      String(filters.minPrice))
    if (filters.maxPrice !== undefined)     qs.set("maxPrice",      String(filters.maxPrice))
    if (filters.q)                          qs.set("q",             filters.q)
    if (filters.sellerId)                   qs.set("sellerId",      filters.sellerId)
    if (filters.official)                   qs.set("official",      "true")
    if (filters.sort)                       qs.set("sort",          filters.sort)
    if (cursor && typeof cursor === "string") qs.set("cursor",      cursor)

    const res = await fetch(`/api/listings?${qs.toString()}`)
    if (!res.ok) throw new Error(`Listings fetch failed: ${res.status}`)
    return res.json() as Promise<PaginatedResult<Listing>>
  },

  async getListingById(id) {
    try {
      const base = typeof window === "undefined"
        ? (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
        : ""
      const res = await fetch(`${base}/api/listings/${encodeURIComponent(id)}`, {
        cache: "no-store",
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  },

  // FIX: Was fetching ALL listings then filtering in JS.
  // Now uses WHERE id IN (...) — only fetches the rows we need.
  async getListingsByIds(ids) {
    if (!ids.length) return []
    const placeholders = ids.map(() => "?").join(",")
    const rows = await AdminService.getCollection("listings", [
      { field: "id", op: "in", value: ids } as any,
    ]) as Record<string, unknown>[]
    return rows.map(mapRow)
  },

  // FIX: Was fetching ALL categories then filtering in JS.
  // Now passes phase as a WHERE constraint directly to D1.
  async getCategories(phase) {
    const constraints: any[] = [{ field: "order", dir: "ASC" }]
    if (phase !== undefined) constraints.unshift({ field: "phase", op: "==", value: phase })
    const all = await AdminService.getCollection("categories", constraints) as Record<string, unknown>[]
    return all.map(mapCategoryRow)
  },

  // FIX: Was fetching ALL categories then finding by slug in JS.
  // Now uses WHERE slug = ? LIMIT 1 — single targeted read.
  async getCategoryBySlug(slug) {
    const rows = await AdminService.getCollection("categories", [
      { field: "slug", op: "==", value: slug } as any,
    ]) as Record<string, unknown>[]
    return rows[0] ? mapCategoryRow(rows[0]) : null
  },

  async createListing(data, sellerId) {
    return AdminService.addDoc("listings", {
      seller_id:        sellerId,
      seller_name:      data.sellerName      ?? null,
      seller_state:     data.nigerianState   ?? null,
      title:            data.title,
      description:      data.description     ?? null,
      price:            data.priceSale       ?? 0,
      category:         data.categorySlug    ?? null,
      condition:        data.condition       ?? "brand_new",
      images:           JSON.stringify(data.images ?? []),
      status:           "pending",
      is_boosted:       0,
      boost_expires_at: data.boostExpiresAt  ?? null,
      ad_boost_status:  null,
      stock_qty:        data.stockQty        ?? 1,
      weight_kg:        data.weightKg        ?? null,
      is_fragile:       data.isFragile        ? 1 : 0,
      delivery_options: data.shippingMethods
                          ? JSON.stringify(data.shippingMethods)
                          : null,
      estimated_delivery_days: data.estimatedDeliveryDays ?? null,
      bulk_pricing:     data.bulkPricing ? JSON.stringify(data.bulkPricing) : null,
      min_order_qty:    data.minOrderQty     ?? null,
      unit_of_sale:     data.unitOfSale      ?? "piece",
      offers_enabled:   data.offersEnabled === false ? 0 : 1,
      low_stock_threshold: data.lowStockThreshold ?? null,
      views:            0,
    })
  },

  async updateListing(id, data) {
    const patch: Record<string, unknown> = {}
    if (data.title        !== undefined) { patch.title        = data.title; patch.searchable_title = data.title.toLowerCase() }
    if (data.description  !== undefined)   patch.description  = data.description
    if (data.priceSale    !== undefined)   patch.price        = data.priceSale
    if (data.priceRentDaily !== undefined) patch.price_rent_day = data.priceRentDaily
    if (data.categorySlug !== undefined)   patch.category     = data.categorySlug
    if (data.condition    !== undefined)   patch.condition    = data.condition
    if (data.images       !== undefined)   patch.images       = JSON.stringify(data.images)
    if (data.nigerianState!== undefined)   patch.nigerian_state = data.nigerianState
    if (data.city         !== undefined)   patch.city         = data.city
    if (data.deliveryNationwide !== undefined) patch.delivery_nationwide = data.deliveryNationwide ? 1 : 0
    if (data.sellerName   !== undefined)   patch.seller_name  = data.sellerName
    if (data.stockQty     !== undefined)   patch.stock_qty    = data.stockQty
    if (data.weightKg     !== undefined)   patch.weight_kg    = data.weightKg
    if (data.isFragile    !== undefined)   patch.is_fragile   = data.isFragile ? 1 : 0
    if (data.shippingMethods !== undefined) patch.delivery_options = JSON.stringify(data.shippingMethods)
    if (data.estimatedDeliveryDays !== undefined) patch.estimated_delivery_days = data.estimatedDeliveryDays
    if (data.bulkPricing  !== undefined)   patch.bulk_pricing = data.bulkPricing ? JSON.stringify(data.bulkPricing) : null
    if (data.minOrderQty  !== undefined)   patch.min_order_qty = data.minOrderQty
    if (data.unitOfSale   !== undefined)   patch.unit_of_sale = data.unitOfSale
    if (data.offersEnabled !== undefined)  patch.offers_enabled = data.offersEnabled === false ? 0 : 1
    if (data.lowStockThreshold !== undefined) patch.low_stock_threshold = data.lowStockThreshold
    if (data.isBoosted    !== undefined)   patch.is_boosted   = data.isBoosted ? 1 : 0
    if (data.boostExpiresAt !== undefined) patch.boost_expires_at = data.boostExpiresAt
    if (data.status       !== undefined)   patch.status       = data.status
    // Standing discount — plain permanent discount, settable on create OR
    // edit (unlike flashDeal which only sets post-creation from the
    // dashboard). Passing standingDiscount: null clears it.
    if (data.standingDiscount !== undefined) {
      patch.standing_discount_enabled = data.standingDiscount ? 1 : 0
      patch.standing_discount_percent = data.standingDiscount?.discountPercent ?? null
    }
    await AdminService.updateDoc("listings", id, patch)
  },

  async deleteListing(id) {
    await AdminService.deleteDoc("listings", id)
  },

  async pauseListing(id) {
    await AdminService.updateDoc("listings", id, { status: "paused" })
  },

  async resumeListing(id) {
    await AdminService.updateDoc("listings", id, { status: "active" })
  },

  async saveListing(listingId, userId) {
    await AdminService.addDoc("saved_listings", {
      user_id: userId,
      listing_id: listingId,
      created_at: new Date().toISOString(),
    })
  },

  // FIX: Was fetching ALL saved_listings then filtering in JS.
  // Now uses WHERE user_id = ? AND listing_id = ? — targeted single row.
  async unsaveListing(listingId, userId) {
    const rows = await AdminService.getCollection("saved_listings", [
      { field: "user_id",    op: "==", value: userId    } as any,
      { field: "listing_id", op: "==", value: listingId } as any,
    ]) as Record<string, unknown>[]
    if (rows[0]) await AdminService.deleteDoc("saved_listings", String(rows[0].id))
  },

  // FIX: Was doing two full table scans (saved_listings then listings).
  // Now fetches only the user's saved rows, then uses WHERE id IN (...).
  async getSavedListings(userId) {
    const saved = await AdminService.getCollection("saved_listings", [
      { field: "user_id", op: "==", value: userId } as any,
    ]) as Record<string, unknown>[]
    const ids = saved.map(r => String(r.listing_id))
    if (!ids.length) return []
    return this.getListingsByIds(ids)
  },

  async createFlashDeal(listingId, discountPercent, hours) {
    const expiresAt = new Date(Date.now() + hours * 3600000).toISOString()
    await AdminService.updateDoc("listings", listingId, {
      flash_deal:    JSON.stringify({ discountPercent, expiresAt, createdAt: new Date().toISOString() }),
      is_flash_deal: 1,
    })
  },

  async cancelFlashDeal(listingId) {
    await AdminService.updateDoc("listings", listingId, { flash_deal: null, is_flash_deal: 0 })
  },

  async approveListing(listingId, adminUid) {
    await AdminService.updateDoc("listings", listingId, {
      status:           "active",
      approved_by:      adminUid,
      approved_at:      new Date().toISOString(),
      rejection_reason: null,
    })
  },

  async rejectListing(listingId, adminUid, reason) {
    if (!reason.trim()) throw new Error("Rejection reason is required")
    await AdminService.updateDoc("listings", listingId, {
      status:           "rejected",
      rejected_by:      adminUid,
      rejected_at:      new Date().toISOString(),
      rejection_reason: reason.trim(),
    })
  },

  isFlashDealActive(listing: Listing): boolean {
    if (!listing?.flashDeal?.expiresAt) return false
    const discountPercent = listing.flashDeal.discountPercent
    // Guard against a flash deal with no real discount (0, null, undefined, NaN)
    if (!discountPercent || discountPercent <= 0) return false
    const exp = listing.flashDeal.expiresAt
    const expDate = typeof exp === "string" ? new Date(exp) : exp.toDate()
    return expDate > new Date()
  },

  getFlashPrice(originalKobo: number, discountPercent: number): number {
    if (!discountPercent || discountPercent <= 0 || discountPercent > 100) return originalKobo
    return Math.round(originalKobo * (1 - discountPercent / 100))
  },

  subscribeToInsurancePool(callback) {
    const month = new Date().toISOString().slice(0, 7)
    let active = true
    const run = async () => {
      if (!active) return
      try {
        const row = await AdminService.getDoc("insurance_pool", month)
        callback(row ? Number((row as any).net_balance ?? 0) : 0)
      } catch { callback(0) }
      if (active) setTimeout(run, 60_000)
    }
    run()
    return () => { active = false }
  },
}
