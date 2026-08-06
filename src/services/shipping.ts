// src/services/shipping.ts
// ─────────────────────────────────────────────────────────────────
// Shipping methods service.
//
// OPTION A — ZamoraxLogic is the single source of truth for agent coverage.
// Covered states are fetched live from ZamoraxLogic's /api/v1/coverage
// endpoint. The marketplace's own agentLocations collection is no longer
// used for coverage — admin only manages agents on ZamoraxLogic.
//
// FBZ covered states are now derived live from active warehouses in the
// fbz_warehouses table (via /api/fbz/warehouses), so what the seller sees
// while posting a listing matches what admin actually configured — instead
// of the separate, easily-stale config/platform.fbzCoveredStates field.
// ─────────────────────────────────────────────────────────────────

import { AdminService }        from "@/src/services"
import { ZamoraxLogicClient }  from "@/lib/zamoraxlogic"

export type ShippingMethodKey = "meetup" | "zamorax_logistics" | "fbz"

export interface FBZWarehouseAvailability {
  id: string
  name: string
  state: string
  city: string
  isActive: boolean
  currentStock: number
  capacity: number
  /** true when isActive and there's still room to receive stock */
  acceptingStock: boolean
}

export interface ShippingMethodConfig {
  meetupEnabled:    boolean
  zlaEnabled:       boolean
  fbzEnabled:       boolean
  zlaCoveredStates: string[]  // live from ZamoraxLogic /api/v1/coverage
  fbzCoveredStates: string[]  // derived from active fbz_warehouses (see getFBZWarehouses)
  fbzWarehouses:    FBZWarehouseAvailability[]  // full detail for seller-facing UI
}

/** Per-state coverage detail returned to the checkout UI */
export interface ZLAStateCoverage {
  sellerCovered: boolean   // active agent exists in seller's state on ZamoraxLogic
  buyerCovered:  boolean   // active agent exists in buyer's state on ZamoraxLogic
  bothCovered:   boolean   // true only when both are covered → ZLA option enabled
}

const DEFAULTS: ShippingMethodConfig = {
  meetupEnabled:    true,
  zlaEnabled:       true,
  fbzEnabled:       true,
  zlaCoveredStates: [],
  fbzCoveredStates: [],
  fbzWarehouses:    [],
}

export const ShippingService = {

  /** Full config — used by seller listing form and buyer checkout */
  async getConfig(): Promise<ShippingMethodConfig> {
    try {
      const platform = await AdminService.getDoc("config", "platform")

      const meetupEnabled = (platform as any)?.safeMeetEnabled  ?? true
      const zlaEnabled    = (platform as any)?.logisticsEnabled ?? true
      const fbzEnabled    = (platform as any)?.fbzEnabled       ?? true

      const [zlaCoveredStates, fbzWarehouses] = await Promise.all([
        ShippingService.getZLACoveredStates(),
        ShippingService.getFBZWarehouses(),
      ])

      // Only warehouses admin has marked active feed the state list sellers
      // see — a warehouse that's paused (isActive: false) shouldn't make a
      // seller think FBZ is available in that state.
      const fbzCoveredStates = Array.from(
        new Set(fbzWarehouses.filter(w => w.isActive).map(w => w.state))
      )

      return { meetupEnabled, zlaEnabled, fbzEnabled, zlaCoveredStates, fbzCoveredStates, fbzWarehouses }
    } catch {
      return DEFAULTS
    }
  },

  /**
   * Fetch FBZ warehouse locations from the dedicated /api/fbz/warehouses
   * route (same source of truth admin uses in FBZWarehouseLocations.tsx),
   * so sellers see real, current warehouse availability while posting —
   * not a separately-maintained state list that can drift out of sync.
   * Falls back to [] if the route is unreachable, so FBZ just shows no
   * covered states rather than crashing the listing form.
   */
  async getFBZWarehouses(): Promise<FBZWarehouseAvailability[]> {
    try {
      const res = await fetch("/api/fbz/warehouses", { cache: "no-store" })
      if (!res.ok) return []
      const data = await res.json()
      const rows: any[] = data?.results ?? []
      return rows.map(r => {
        const capacity = Number(r.capacity ?? 0)
        const currentStock = Number(r.current_stock ?? r.currentStock ?? 0)
        const isActive = !!(r.is_active ?? r.isActive)
        return {
          id: String(r.id),
          name: r.name ?? "",
          state: r.state ?? "",
          city: r.city ?? "",
          isActive,
          currentStock,
          capacity,
          acceptingStock: isActive && (capacity === 0 || currentStock < capacity),
        }
      })
    } catch {
      return []
    }
  },

  /**
   * Fetch covered states live from ZamoraxLogic /api/v1/coverage.
   * ZamoraxLogic is the single source of truth — no local agentLocations
   * collection needed on the marketplace side.
   *
   * Falls back to [] if ZamoraxLogic is unreachable, so the ZLA option
   * gracefully becomes unavailable rather than crashing checkout.
   */
  async getZLACoveredStates(): Promise<string[]> {
    try {
      const res = await ZamoraxLogicClient.getCoverage()
      return res.coveredStates ?? []
    } catch {
      return []
    }
  },

  /**
   * Check ZLA coverage for a specific seller state + buyer state pair.
   * Single API call to ZamoraxLogic — returns granular flags for checkout UI.
   *
   * sellerCovered → origin agent available in seller's state
   * buyerCovered  → destination agent available in buyer's state
   * bothCovered   → ZLA delivery is fully operational for this route
   */
  async getCoverageForStates(
    sellerState: string,
    buyerState:  string,
  ): Promise<ZLAStateCoverage> {
    try {
      const res = await ZamoraxLogicClient.getCoverage()
      const covered = res.coveredStates ?? []

      const sellerCovered = sellerState ? covered.includes(sellerState) : false
      const buyerCovered  = buyerState  ? covered.includes(buyerState)  : false

      return {
        sellerCovered,
        buyerCovered,
        bothCovered: sellerCovered && buyerCovered,
      }
    } catch {
      return { sellerCovered: false, buyerCovered: false, bothCovered: false }
    }
  },

  /**
   * Legacy manual override, kept for backward compatibility only.
   * fbzCoveredStates on getConfig() is now derived live from active
   * fbz_warehouses rows (see getFBZWarehouses), so this write no longer
   * affects what sellers see during listing creation.
   */
  async saveFBZCoveredStates(states: string[]): Promise<void> {
    await AdminService.updateDoc("config", "platform", {
      fbzCoveredStates: states,
    })
  },
}
