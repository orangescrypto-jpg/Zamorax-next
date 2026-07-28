import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format price in Naira — always use kobo internally
export interface BulkTier {
  minQty: number
  price: number
}

export interface ResolvedBulkPrice {
  total: number        // kobo — resolved TOTAL for the given quantity
  isExactTier: boolean
}

// Shared bulk-tier resolver — used by both the listing page (initial add-to-cart)
// and the cart drawer (re-resolving on every quantity change), so a buyer never
// sees two different totals for the same listing/quantity depending on where
// they changed it.
//
// Bulk tiers are flat bundle totals as the seller set them — e.g.
// "≥10 pieces → ₦18,000" means ₦18,000 IS the price for a bundle of 10,
// not a per-piece rate to multiply by 10. So:
//   - Quantity exactly matches a tier's minQty → that tier's price, used
//     as-is, no multiplication.
//   - Quantity below the first tier's minQty → qty × basePriceSale.
//   - Quantity strictly between two tiers → qty × the MOST RECENTLY
//     CROSSED tier's implied per-piece rate (that tier's price ÷ its
//     minQty) — not the base 1-piece price, and not the next tier up.
// Returns null when there's no bulk pricing at all, so callers fall back
// to plain base-price × qty.
//
// flashDiscountPercent (0-100), when provided, discounts every tier by the
// same percentage as the 1-piece flash price, keeping the whole price
// ladder consistent. Tiers are scaled at read time only — the stored
// bulkPricing data itself is never mutated.
export function resolveBulkPrice(
  bulkPricing: BulkTier[] | null | undefined,
  basePriceSale: number,
  quantity: number,
  flashDiscountPercent?: number | null
): ResolvedBulkPrice | null {
  if (!bulkPricing || bulkPricing.length === 0) return null

  const scale = (price: number) =>
    flashDiscountPercent ? Math.round(price * (1 - flashDiscountPercent / 100)) : price

  const tiers = [...bulkPricing]
    .sort((a, b) => a.minQty - b.minQty)
    .map((t) => ({ minQty: t.minQty, price: scale(t.price) }))

  const exactTier = tiers.find((t) => t.minQty === quantity)
  if (exactTier) return { total: exactTier.price, isExactTier: true }

  const crossed = tiers.filter((t) => quantity > t.minQty)
  if (crossed.length === 0) return null // below first tier — caller uses base price × qty

  const lastCrossed = crossed[crossed.length - 1]
  const perPieceRate = lastCrossed.price / lastCrossed.minQty
  return { total: Math.round(perPieceRate * quantity), isExactTier: false }
}

export function formatPrice(kobo: number): string {
  const naira = kobo / 100
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(naira)
}

// Format price with unit suffix for unit-bearing categories (groceries,
// agricultural, building materials — e.g. "₦45,000.00 / bag"). Pass
// listing.attributes?.unit; falsy/empty values render with no suffix so
// this is safe to call for every listing regardless of category.
export function formatPriceWithUnit(kobo: number, unit?: string | null): string {
  const base = formatPrice(kobo)
  // "piece" is the default for single-item listings — showing "/ piece" on
  // every price would be noise. Bulk-goods units (bag, carton, kg, etc.)
  // are the ones that actually help buyers understand what they're paying
  // for.
  if (!unit || unit === "piece") return base
  // Attribute values look like "Per kg", "Per bag (50kg)", "Bags", "Tonnes" —
  // normalize to a short trailing suffix like "/ kg" or "/ bag (50kg)".
  const cleaned = unit.replace(/^per\s+/i, "").trim()
  if (!cleaned) return base
  return `${base} / ${cleaned}`
}

// Truncate text for listing titles
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}

// Generate slug from title
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
}

// Debounce — delays invoking fn until after wait ms have elapsed
// since the last time it was called. Used for search inputs etc.
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn(...args)
      timer = null
    }, wait)
  }
}
