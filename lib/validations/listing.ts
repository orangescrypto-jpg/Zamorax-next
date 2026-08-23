// lib/validations/listing.ts

import { z } from "zod"

export const listingSchema = z.object({
  // Step 1
  categorySlug: z.string().min(1, "Select a category"),
  listingType: z.enum(["sale", "rent", "both"]),
  
  // Step 2
  title: z.string().min(5, "Title must be at least 5 characters").max(100),
  description: z.string().min(20, "Add more details (min 20 chars)").max(2000),
  condition: z.enum(["brand_new", "open_box", "grade_a", "grade_b"]),
  priceSale: z.number().positive("Price must be greater than 0"),
  priceRentDaily: z.number().positive().optional(),
  priceRentWeekly: z.number().positive().optional(),
  depositAmount: z.number().nonnegative().optional(),
  // Stock quantity — null/undefined = unlimited; 0 = out of stock; 1+ = available qty
  stockQty: z.number().int().min(0).optional(),

  // Bulk / quantity pricing (optional) — seller-defined tiers below the
  // 1-piece priceSale, e.g. "≥5 pieces: ₦X". Sellers can add/remove tiers
  // freely — no fixed count. Each tier needs minQty ≥ 2 (1 piece is
  // priceSale already) and a positive price.
  bulkPricing: z.array(z.object({
    minQty: z.number().int().min(2, "Minimum quantity must be at least 2"),
    price: z.number().positive("Price must be greater than 0"),
  })).optional(),

  // Optional hard floor on order size — separate from bulk-pricing tiers.
  // If set, buyers can't order fewer than this quantity at all.
  minOrderQty: z.number().int().min(1).optional(),

  // Optional unit of sale (piece/bag/carton/etc). Defaults to "piece" so
  // existing categories/listings are unaffected.
  unitOfSale: z.enum(["piece", "bag", "carton", "pack", "dozen", "kg", "litre", "unit"]).default("piece"),

  // Per-listing offer toggle. Defaults to enabled (unset/true) to match
  // prior behavior; seller can opt out. Platform-wide admin toggle still
  // takes precedence over this when off.
  offersEnabled: z.boolean().default(true),

  // Optional low-stock alert threshold, seller-configurable. Defaults to
  // undefined here — the dashboard widget falls back to 3 if unset.
  lowStockThreshold: z.number().int().min(0).optional(),

  // Step 3: Attributes (dynamic, validated per category later)
  attributes: z.record(z.any()).optional(),

  // Step 4: Media
  // Max is enforced at runtime by Step4Media using the platform setting.
  // The schema only enforces min(1) — the hard upper cap is dynamic.
  images: z.array(z.string()).min(1, "Upload at least 1 photo"),
  verificationVideo: z.string().optional(),

  // Step 5: Location
  nigerianState: z.string().min(1, "Select state"),
  city: z.string().min(2, "Enter city"),
  deliveryNationwide: z.boolean(),
  weightKg: z.number().min(0.1).max(100).optional(),
  isFragile: z.boolean().optional(),

  // Step 5b: Shipping methods — at least one must be chosen.
  // Defaults to ["meetup"] if the seller skips past without selecting.
  shippingMethods: z
    .array(z.enum(["meetup", "zamorax_logistics", "fbz"]))
    .min(1, "Select at least one delivery method")
    .default(["meetup"]),
  // Optional seller-stated delivery window, e.g. "2-4 days" — free text, kept short.
  estimatedDeliveryDays: z.string().max(20).optional(),

  // FBZ ship-to-warehouse details — only required when "fbz" is one of the
  // chosen shippingMethods (enforced below via .refine, not here, since
  // these fields don't exist/aren't required for non-FBZ listings).
  fbzWarehouseId: z.string().optional(),
  fbzQuantity: z.number().int().positive().optional(),
  fbzNotes: z.string().max(500).optional(),

  // Step 6: Coupon (optional) — seller sets a standing discount code for
  // this listing. Only shown/usable when sub_settings.couponsEnabled is on;
  // the schema stays permissive here since the toggle gates the UI, not
  // the data shape.
  couponEnabled: z.boolean().optional(),
  couponCode: z.string()
    .trim()
    .max(20, "Coupon code must be 20 characters or fewer")
    .regex(/^[A-Za-z0-9]*$/, "Letters and numbers only")
    .optional(),
  couponDiscountPercent: z.number().int().min(1).max(90).optional(),

  // Standing discount (optional) — a plain, permanent price cut. No expiry,
  // no code, never labeled "discount"/"flash deal" in the UI — just shows
  // as a struck-through price. Settable at creation or edit, always
  // available (not gated on an admin sub-setting like coupons are).
  standingDiscountEnabled: z.boolean().optional(),
  standingDiscountPercent: z.number().int().min(1).max(90).optional(),

  // Step 7: Boost
  boostType: z.enum(["none", "standard", "premium", "category_top"]).default("none"),

  // Step 8: Rules
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the listing rules" }) })
})
.refine(
  data => !data.shippingMethods?.includes("fbz") || !!data.fbzWarehouseId,
  { message: "Select a warehouse to send your FBZ stock to", path: ["fbzWarehouseId"] }
)
.refine(
  data => !data.shippingMethods?.includes("fbz") || (!!data.fbzQuantity && data.fbzQuantity > 0),
  { message: "Enter the quantity you'll send to the warehouse", path: ["fbzQuantity"] }
)
.refine(
  data => !data.couponEnabled || (!!data.couponCode && data.couponCode.length >= 3 && !!data.couponDiscountPercent),
  {
    message: "Enter a coupon code (min 3 characters) and a discount percentage",
    path: ["couponCode"],
  }
)
.refine(
  data => !data.standingDiscountEnabled || !!data.standingDiscountPercent,
  {
    message: "Enter a discount percentage",
    path: ["standingDiscountPercent"],
  }
)
.refine(
  data => {
    if (!data.bulkPricing || data.bulkPricing.length === 0) return true
    const tiers = data.bulkPricing
    for (let i = 0; i < tiers.length; i++) {
      // Each tier must be cheaper than the 1-piece price
      if (tiers[i].price >= data.priceSale) return false
      // Sorted ascending by minQty, each with a strictly lower price than the previous tier
      if (i > 0 && (tiers[i].minQty <= tiers[i - 1].minQty || tiers[i].price >= tiers[i - 1].price)) return false
    }
    return true
  },
  {
    message: "Bulk pricing tiers must be sorted by increasing quantity with decreasing price, and each price must be below the 1-piece price",
    path: ["bulkPricing"],
  }
)

export type ListingFormValues = z.infer<typeof listingSchema>
