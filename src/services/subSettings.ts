// src/services/subSettings.ts
// Separate, small settings doc for anything added AFTER the main
// platformSettings.ts grew too large. Same storage pattern (kv_store via
// /api/admin/sub-settings), but its own key ("config:sub_settings") so it
// never collides with the main config/platform doc.
//
// USAGE IN COMPONENTS:
//   import { useSubSettings } from "@/hooks/useSubSettings"
//   const { settings } = useSubSettings()
//   settings.relatedListingsCount
//
// TO ADD A NEW SETTING IN THE FUTURE:
//   1. Add the field to SubSettings below + a sensible default in DEFAULT_SUB_SETTINGS
//   2. Add a control for it in app/(admin)/admin/sub-settings/page.tsx
//   That's it — the API route and hook are already generic and need no changes.

export interface SubSettings {
  // ── Related listings ("You may also like" row on listing detail pages) ──
  relatedListingsEnabled: boolean
  relatedListingsCount: number   // how many similar listings to show (1–12)

  // ── Seller coupon codes — lets sellers set a standing % discount code
  // on their own listing at creation time (Step 6 of the listing form).
  // Master toggle only — the code/percentage themselves live per-listing
  // on the listing row, not here.
  couponsEnabled: boolean
  couponMaxDiscountPercent: number   // upper bound sellers can set (1–90)

  // ── Sponsored Products row on listing detail pages — shows boosted
  // listings (paid placement, same source as the homepage Featured
  // Listings section) above "You May Also Like", biased toward the same
  // category as the listing being viewed.
  sponsoredListingsEnabled: boolean
  sponsoredListingsCount: number   // how many sponsored listings to show (1–12)

  // ── Cart abandonment reminder — client-side only. Carts are Zustand +
  // localStorage (no server-visible cart to scan), so this nudges a
  // returning buyer with a dismissible banner instead of a server cron.
  cartAbandonmentEnabled: boolean
  cartAbandonmentThresholdHours: number   // how old an item must be to trigger the nudge

  // ── Free Delivery homepage section — shows listings that have a
  // per-listing delivery fee override of 0 (Listing.deliveryFeeOverrideKobo
  // === 0, same flag that drives the "Free Delivery" badge on ListingCard).
  // Master toggle + how many to show on the homepage row; the full list
  // always lives at /free-delivery regardless of this toggle.
  freeDeliveryEnabled: boolean
  freeDeliveryCount: number   // how many to show on the homepage row (1–20)
}

export const DEFAULT_SUB_SETTINGS: SubSettings = {
  relatedListingsEnabled: true,
  relatedListingsCount: 4,
  couponsEnabled: true,
  couponMaxDiscountPercent: 50,
  sponsoredListingsEnabled: true,
  sponsoredListingsCount: 6,
  cartAbandonmentEnabled: true,
  cartAbandonmentThresholdHours: 24,
  freeDeliveryEnabled: true,
  freeDeliveryCount: 8,
}

let _cached: SubSettings | null = null

export async function getSubSettings(): Promise<SubSettings> {
  if (_cached) return _cached
  try {
    const base = typeof window === "undefined"
      ? (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000")
      : ""
    const res = await fetch(`${base}/api/admin/sub-settings?t=${Date.now()}`, { cache: "no-store" })
    const json = await res.json()
    if (json?.settings) {
      _cached = { ...DEFAULT_SUB_SETTINGS, ...(json.settings as Partial<SubSettings>) }
      return _cached
    }
  } catch { /* use defaults */ }
  return DEFAULT_SUB_SETTINGS
}

export function invalidateSubSettingsCache() {
  _cached = null
}

export function subscribeToSubSettings(
  callback: (settings: SubSettings) => void
): () => void {
  let active = true

  const poll = async () => {
    if (!active) return
    try {
      const base = typeof window === "undefined"
        ? (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000")
        : ""
      const res = await fetch(`${base}/api/admin/sub-settings`, { cache: "no-store" })
      const json = await res.json()
      if (json?.settings) {
        _cached = { ...DEFAULT_SUB_SETTINGS, ...(json.settings as Partial<SubSettings>) }
        callback(_cached)
      }
    } catch { /* non-fatal */ }
  }

  poll()
  const interval = setInterval(poll, 30_000)

  return () => {
    active = false
    clearInterval(interval)
  }
}
