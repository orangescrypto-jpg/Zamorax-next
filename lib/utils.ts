import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format price in Naira — always use kobo internally
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
