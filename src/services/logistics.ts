// src/services/logistics.ts
// ─────────────────────────────────────────────────────────────────
// Logistics pricing service — zone-based with popular route overrides.
// All fee reads go through here. Never hardcode fees in components.
// ─────────────────────────────────────────────────────────────────

import { AdminService } from "@/src/services/admin"

// ─── Zone Map ────────────────────────────────────────────────────
export type DeliveryZone =
  | "southwest" | "southeast" | "southsouth"
  | "northcentral" | "northwest" | "northeast"
  | "same_state"

export const STATE_ZONE_MAP: Record<string, DeliveryZone> = {
  // Southwest
  Lagos: "southwest", Ogun: "southwest", Oyo: "southwest",
  Osun: "southwest", Ondo: "southwest", Ekiti: "southwest",
  // Southeast
  Enugu: "southeast", Anambra: "southeast", Imo: "southeast",
  Abia: "southeast", Ebonyi: "southeast",
  // South-South
  Rivers: "southsouth", Delta: "southsouth", Edo: "southsouth",
  Bayelsa: "southsouth", "Cross River": "southsouth", "Akwa Ibom": "southsouth",
  // North Central
  FCT: "northcentral", Niger: "northcentral", Kwara: "northcentral",
  Kogi: "northcentral", Benue: "northcentral", Plateau: "northcentral", Nasarawa: "northcentral",
  // Northwest
  Kano: "northwest", Kaduna: "northwest", Katsina: "northwest",
  Sokoto: "northwest", Zamfara: "northwest", Kebbi: "northwest", Jigawa: "northwest",
  // Northeast
  Borno: "northeast", Yobe: "northeast", Adamawa: "northeast",
  Gombe: "northeast", Taraba: "northeast", Bauchi: "northeast",
}

// Build a canonical zone-pair key (always sorted so A→B = B→A)
export function zonePairKey(zoneA: DeliveryZone, zoneB: DeliveryZone): string {
  return [zoneA, zoneB].sort().join("|")
}

// Build a canonical route override key (direction matters for overrides)
export function routeOverrideKey(from: string, to: string): string {
  return `${from}__${to}`
}

// ─── Default zone prices (kobo) ──────────────────────────────────
// These are the admin defaults — loaded from Firestore at runtime.
// Admin can change any of these in settings.
export const DEFAULT_ZONE_PRICES: Record<string, number> = {
  "same_state|same_state":           150000,  // ₦1,500
  "southwest|southwest":             200000,  // ₦2,000
  "southeast|southeast":             200000,
  "southsouth|southsouth":           200000,
  "northcentral|northcentral":       200000,
  "northwest|northwest":             200000,
  "northeast|northeast":             200000,
  "southeast|southwest":             350000,  // ₦3,500
  "southsouth|southwest":            350000,
  "northcentral|southwest":          300000,
  "northwest|southwest":             450000,
  "northeast|southwest":             500000,
  "southeast|southsouth":            300000,
  "northcentral|southeast":          350000,
  "northwest|southeast":             500000,
  "northeast|southeast":             450000,
  "northcentral|southsouth":         350000,
  "northwest|southsouth":            500000,
  "northeast|southsouth":            450000,
  "northcentral|northwest":          300000,
  "northcentral|northeast":          250000,
  "northeast|northwest":             300000,
}

// ─── Default popular route overrides (kobo) ──────────────────────
export const DEFAULT_ROUTE_OVERRIDES: Record<string, number> = {
  "Lagos__Ibadan":          80000,   // ₦800
  "Ibadan__Lagos":          80000,
  "Lagos__Ogun":            70000,   // ₦700
  "Ogun__Lagos":            70000,
  "Lagos__Abuja":           350000,  // ₦3,500
  "Abuja__Lagos":           350000,
  "Lagos__Port Harcourt":   400000,  // ₦4,000
  "Port Harcourt__Lagos":   400000,
  "Lagos__Benin":           250000,  // ₦2,500
  "Benin__Lagos":           250000,
  "Abuja__Kano":            250000,  // ₦2,500
  "Kano__Abuja":            250000,
  "Kano__Lagos":            450000,  // ₦4,500
  "Lagos__Kano":            450000,
  "Abuja__Ibadan":          280000,  // ₦2,800
  "Ibadan__Abuja":          280000,
}

// ─── Weight tiers ─────────────────────────────────────────────────
// Admin-editable weight-based pricing bands, replacing the old flat
// "threshold + per-kg surcharge" model. Each tier is a [minKg, maxKg) range
// with a flat kobo price for any item whose weight falls in that range.
// maxKg === null means "and above" (the last/open-ended tier).
// Example admin config: 0–5kg → ₦0, 5–10kg → ₦1,500, 10kg+ → ₦3,000.
export interface WeightTier {
  minKg:      number
  maxKg:      number | null   // null = open-ended ("and above")
  priceKobo:  number
}

export const DEFAULT_WEIGHT_TIERS: WeightTier[] = [
  { minKg: 0, maxKg: 5, priceKobo: 0 },
]

// ─── Pricing snapshot from Firestore ─────────────────────────────
export interface LogisticsPricingSnapshot {
  zonePrices:          Record<string, number>  // kobo
  routeOverrides:      Record<string, number>  // kobo
  weightTiers:         WeightTier[]
  doorstepFeeKobo:     number
  fragileFeeKobo:      number
}

const PRICING_DEFAULTS: LogisticsPricingSnapshot = {
  zonePrices:        DEFAULT_ZONE_PRICES,
  routeOverrides:    DEFAULT_ROUTE_OVERRIDES,
  weightTiers:       DEFAULT_WEIGHT_TIERS,
  doorstepFeeKobo:   50000,   // ₦500
  fragileFeeKobo:    30000,   // ₦300
}

// ─── Fee breakdown ────────────────────────────────────────────────
export interface DeliveryFeeBreakdown {
  base:             number   // kobo — zone or override base rate
  weightSurcharge:  number   // kobo — the matched weight tier's price
  doorstepFee:      number   // kobo — if doorstep chosen
  fragileFee:       number   // kobo — if item fragile
  total:            number   // kobo — what buyer pays
  routeLabel:       string   // e.g. "Lagos → Abuja (override)" for UI
}

// Find the tier an item's weight falls into. Tiers are sorted by minKg
// first so an out-of-order admin edit still resolves correctly. Falls back
// to the last (highest) tier if the weight exceeds every closed range and
// none is open-ended — better to charge the top rate than silently charge
// nothing for an unexpectedly heavy item.
function matchWeightTier(weightKg: number, tiers: WeightTier[]): number {
  if (!tiers || tiers.length === 0) return 0
  const sorted = [...tiers].sort((a, b) => a.minKg - b.minKg)
  for (const tier of sorted) {
    const withinMin = weightKg >= tier.minKg
    const withinMax = tier.maxKg == null || weightKg < tier.maxKg
    if (withinMin && withinMax) return tier.priceKobo
  }
  return sorted[sorted.length - 1].priceKobo
}

// ─── Service ──────────────────────────────────────────────────────
export const LogisticsService = {

  async getPricing(): Promise<LogisticsPricingSnapshot> {
    try {
      const doc = await AdminService.getDoc("config", "platform")
      if (!doc) return PRICING_DEFAULTS
      // Back-compat: older saved settings may only have the flat
      // threshold/per-kg fields (zlaWeightThreshold/zlaWeightPerKgKobo) and
      // no zlaWeightTiers array yet — synthesize an equivalent 2-tier setup
      // from those so pricing doesn't silently reset to defaults the first
      // time this loads after the upgrade.
      const savedTiers = (doc as any).zlaWeightTiers as WeightTier[] | undefined
      const legacyThreshold = (doc as any).zlaWeightThreshold
      const legacyPerKg     = (doc as any).zlaWeightPerKgKobo
      const weightTiers = Array.isArray(savedTiers) && savedTiers.length > 0
        ? savedTiers
        : (legacyThreshold != null && legacyPerKg != null)
          ? [
              { minKg: 0, maxKg: legacyThreshold, priceKobo: 0 },
              { minKg: legacyThreshold, maxKg: null, priceKobo: Math.round(legacyPerKg) },
            ]
          : DEFAULT_WEIGHT_TIERS
      return {
        zonePrices:        (doc as any).zlaZonePrices      ?? DEFAULT_ZONE_PRICES,
        routeOverrides:    (doc as any).zlaRouteOverrides   ?? DEFAULT_ROUTE_OVERRIDES,
        weightTiers,
        doorstepFeeKobo:   (doc as any).zlaDoorstepFee      ?? PRICING_DEFAULTS.doorstepFeeKobo,
        fragileFeeKobo:    (doc as any).zlaFragileFee       ?? PRICING_DEFAULTS.fragileFeeKobo,
      }
    } catch {
      return PRICING_DEFAULTS
    }
  },

  calculateFee(
    fromState: string,
    toState:   string,
    pricing:   LogisticsPricingSnapshot,
    opts: {
      weightKg?:   number
      isDoorstep?: boolean
      isFragile?:  boolean
    } = {}
  ): DeliveryFeeBreakdown {
    const { weightKg = 0.5, isDoorstep = false, isFragile = false } = opts

    // 1. Check popular route override first
    const overrideKey = routeOverrideKey(fromState, toState)
    let base       = 0
    let routeLabel = ""

    if (pricing.routeOverrides[overrideKey] !== undefined) {
      base       = pricing.routeOverrides[overrideKey]
      routeLabel = `${fromState} → ${toState}`
    } else {
      // 2. Fall back to zone pricing
      const fromZone = fromState === toState ? "same_state" : (STATE_ZONE_MAP[fromState] ?? "southwest")
      const toZone   = fromState === toState ? "same_state" : (STATE_ZONE_MAP[toState]   ?? "southwest")
      const key      = fromState === toState ? "same_state|same_state" : zonePairKey(fromZone, toZone)
      base       = pricing.zonePrices[key] ?? pricing.zonePrices["northeast|southwest"] ?? 500000
      routeLabel = fromState === toState
        ? `Within ${fromState}`
        : `${fromZone.replace("_", " ")} → ${toZone.replace("_", " ")} zone`
    }

    // 3. Weight tier — admin-defined bands (e.g. 0–5kg free, 5–10kg ₦1,500,
    // 10kg+ ₦3,000), replacing the old flat threshold + per-kg surcharge.
    const weightSurcharge = matchWeightTier(weightKg, pricing.weightTiers)

    // 4. Other surcharges
    const doorstepFee = isDoorstep ? pricing.doorstepFeeKobo : 0
    const fragileFee  = isFragile  ? pricing.fragileFeeKobo  : 0

    const total = base + weightSurcharge + doorstepFee + fragileFee

    return { base, weightSurcharge, doorstepFee, fragileFee, total, routeLabel }
  },

  async getDeliveryFee(
    fromState: string,
    toState:   string,
    opts: { weightKg?: number; isDoorstep?: boolean; isFragile?: boolean } = {}
  ): Promise<DeliveryFeeBreakdown> {
    const pricing = await this.getPricing()
    return this.calculateFee(fromState, toState, pricing, opts)
  },
}
