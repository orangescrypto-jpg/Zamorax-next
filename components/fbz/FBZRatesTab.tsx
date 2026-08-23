"use client"
// components/fbz/FBZRatesTab.tsx
// FBZ (Fulfilled by Zamorax) configuration — previously a section inside
// /admin/settings, now its own tab on /admin/fbz so warehouse/fee tuning
// lives next to pending/received/live/history shipment tabs.
//
// Loads + saves through the same /api/admin/settings blob endpoint as the
// main settings page, but only reads/writes FBZ-related keys — merging
// into whatever else is saved server-side.

import { useEffect, useState } from "react"
import { adminFetch } from "@/lib/admin-fetch"
import { invalidateSettingsCache } from "@/src/services/platformSettings"
import { invalidatePlatformCache } from "@/hooks/usePlatformSettings"
import { useToast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { nigerianStates } from "@/constants/nigerianStates"
import { Loader2, Warehouse, MapPin, Phone, Clock, Save, Plus, X, Truck } from "lucide-react"
import {
  SectionCard, ToggleRow, KoboField, NumField, StrField, InfoBox,
} from "@/components/admin/SettingsFields"
import { FBZWarehouseLocations } from "@/components/admin/FBZWarehouseLocations"

// ─── FBZ's own rate table (independent of ZamoraxLogic) ──────────────────
// Mirrors ZLA's zone/route/weight shape exactly, but priced and stored
// separately (fbz*-prefixed keys), and calculated warehouse-state → buyer-
// state at checkout — see src/services/logistics.ts getFbzPricing().

interface WeightTierUI {
  minKg: number
  maxKg: number | null
  priceKobo: number
}

const DEFAULT_WEIGHT_TIERS_UI: WeightTierUI[] = [
  { minKg: 0, maxKg: 5, priceKobo: 0 },
]

const ZONE_PAIRS: { key: string; label: string }[] = [
  { key: "same_state|same_state",       label: "Same State (Intrastate)" },
  { key: "southwest|southwest",         label: "Southwest ↔ Southwest" },
  { key: "southeast|southeast",         label: "Southeast ↔ Southeast" },
  { key: "southsouth|southsouth",       label: "South-South ↔ South-South" },
  { key: "northcentral|northcentral",   label: "North Central ↔ North Central" },
  { key: "northwest|northwest",         label: "Northwest ↔ Northwest" },
  { key: "northeast|northeast",         label: "Northeast ↔ Northeast" },
  { key: "southeast|southwest",         label: "Southwest ↔ Southeast" },
  { key: "southsouth|southwest",        label: "Southwest ↔ South-South" },
  { key: "northcentral|southwest",      label: "Southwest ↔ North Central" },
  { key: "northwest|southwest",         label: "Southwest ↔ Northwest" },
  { key: "northeast|southwest",         label: "Southwest ↔ Northeast" },
  { key: "southeast|southsouth",        label: "Southeast ↔ South-South" },
  { key: "northcentral|southeast",      label: "Southeast ↔ North Central" },
  { key: "northwest|southeast",         label: "Southeast ↔ Northwest" },
  { key: "northeast|southeast",         label: "Southeast ↔ Northeast" },
  { key: "northcentral|southsouth",     label: "South-South ↔ North Central" },
  { key: "northwest|southsouth",        label: "South-South ↔ Northwest" },
  { key: "northeast|southsouth",        label: "South-South ↔ Northeast" },
  { key: "northcentral|northwest",      label: "North Central ↔ Northwest" },
  { key: "northcentral|northeast",      label: "North Central ↔ Northeast" },
  { key: "northeast|northwest",         label: "Northwest ↔ Northeast" },
]

const POPULAR_ROUTES: { key: string; label: string }[] = [
  { key: "Lagos__Ibadan",         label: "Lagos → Ibadan" },
  { key: "Ibadan__Lagos",         label: "Ibadan → Lagos" },
  { key: "Lagos__Ogun",           label: "Lagos → Ogun" },
  { key: "Ogun__Lagos",           label: "Ogun → Lagos" },
  { key: "Lagos__Abuja",          label: "Lagos → Abuja" },
  { key: "Abuja__Lagos",          label: "Abuja → Lagos" },
  { key: "Abuja__Ibadan",         label: "Abuja → Ibadan" },
  { key: "Ibadan__Abuja",         label: "Ibadan → Abuja" },
  { key: "Lagos__Port Harcourt",  label: "Lagos → Port Harcourt" },
  { key: "Port Harcourt__Lagos",  label: "Port Harcourt → Lagos" },
  { key: "Lagos__Benin",          label: "Lagos → Benin City (Edo)" },
  { key: "Benin__Lagos",          label: "Benin City (Edo) → Lagos" },
  { key: "Abuja__Kano",           label: "Abuja → Kano" },
  { key: "Kano__Abuja",           label: "Kano → Abuja" },
  { key: "Kano__Lagos",           label: "Kano → Lagos" },
  { key: "Lagos__Kano",           label: "Lagos → Kano" },
]

const DEFAULT_ZONE_PRICES: Record<string, number> = {
  "same_state|same_state":       150000,
  "southwest|southwest":         200000,
  "southeast|southeast":         200000,
  "southsouth|southsouth":       200000,
  "northcentral|northcentral":   200000,
  "northwest|northwest":         200000,
  "northeast|northeast":         200000,
  "southeast|southwest":         350000,
  "southsouth|southwest":        350000,
  "northcentral|southwest":      300000,
  "northwest|southwest":         450000,
  "northeast|southwest":         500000,
  "southeast|southsouth":        300000,
  "northcentral|southeast":      350000,
  "northwest|southeast":         500000,
  "northeast|southeast":         450000,
  "northcentral|southsouth":     350000,
  "northwest|southsouth":        500000,
  "northeast|southsouth":        450000,
  "northcentral|northwest":      300000,
  "northcentral|northeast":      250000,
  "northeast|northwest":         300000,
}

const DEFAULT_ROUTE_OVERRIDES: Record<string, number> = {
  "Lagos__Ibadan":         80000,
  "Ibadan__Lagos":         80000,
  "Lagos__Ogun":           70000,
  "Ogun__Lagos":           70000,
  "Lagos__Abuja":          350000,
  "Abuja__Lagos":          350000,
  "Abuja__Ibadan":         280000,
  "Ibadan__Abuja":         280000,
  "Lagos__Port Harcourt":  400000,
  "Port Harcourt__Lagos":  400000,
  "Lagos__Benin":          250000,
  "Benin__Lagos":          250000,
  "Abuja__Kano":           250000,
  "Kano__Abuja":           250000,
  "Kano__Lagos":           450000,
  "Lagos__Kano":           450000,
}

// ─── Add Custom Route ─────────────────────────────────────────────────────

function AddRouteForm({ onAdd }: { onAdd: (from: string, to: string) => void }) {
  const [from, setFrom] = useState("")
  const [to,   setTo]   = useState("")

  const submit = () => {
    if (!from || !to || from === to) return
    onAdd(from, to)
    setFrom(""); setTo("")
  }

  return (
    <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-dashed bg-muted/20">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">From</label>
        <select
          value={from}
          onChange={e => setFrom(e.target.value)}
          className="h-9 text-xs border rounded-md px-2 bg-background min-w-[130px]"
        >
          <option value="">Select state</option>
          {nigerianStates.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">To</label>
        <select
          value={to}
          onChange={e => setTo(e.target.value)}
          className="h-9 text-xs border rounded-md px-2 bg-background min-w-[130px]"
        >
          <option value="">Select state</option>
          {nigerianStates.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={submit} disabled={!from || !to || from === to}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Add Route
      </Button>
    </div>
  )
}

// ─── Weight Tiers Editor ──────────────────────────────────────────────────
function WeightTiersEditor({
  tiers, onChange,
}: {
  tiers: WeightTierUI[]
  onChange: (v: WeightTierUI[]) => void
}) {
  const update = (index: number, patch: Partial<WeightTierUI>) => {
    const next = tiers.map((t, i) => i === index ? { ...t, ...patch } : t)
    onChange(next)
  }

  const remove = (index: number) => {
    onChange(tiers.filter((_, i) => i !== index))
  }

  const addTier = () => {
    const highestMax = tiers.reduce((max, t) => t.maxKg != null ? Math.max(max, t.maxKg) : max, 0)
    onChange([...tiers, { minKg: highestMax, maxKg: null, priceKobo: 0 }])
  }

  return (
    <div className="space-y-2">
      {tiers.length === 0 && (
        <p className="text-xs text-muted-foreground italic px-1">
          No weight bands set — every order will be charged ₦0 for weight. Add at least one band.
        </p>
      )}
      {tiers.map((tier, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 p-2.5 rounded-lg border bg-muted/10">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">From (kg)</label>
            <Input
              type="number" min={0} step={0.5}
              value={tier.minKg}
              onChange={e => update(i, { minKg: Number(e.target.value) })}
              className="h-8 w-20 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Up to (kg)</label>
            <Input
              type="number" min={0} step={0.5}
              placeholder="and above"
              value={tier.maxKg ?? ""}
              onChange={e => update(i, { maxKg: e.target.value === "" ? null : Number(e.target.value) })}
              className="h-8 w-24 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Price</label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">₦</span>
              <Input
                type="number" min={0} step={100}
                value={tier.priceKobo / 100}
                onChange={e => update(i, { priceKobo: Math.round(parseFloat(e.target.value || "0") * 100) })}
                className="h-8 w-24 text-xs"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md border text-muted-foreground hover:text-red-600 hover:border-red-200"
            title="Delete this band"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" onClick={addTier}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Add Weight Band
      </Button>
    </div>
  )
}

// ─── Types (FBZ-only slice of the global Settings shape) ────────────────────

interface FBZSettings {
  fbzEnabled: boolean
  fbzPauseReason: string
  fbzWarehouseAddress: string
  fbzWarehousePhone: string
  fbzWarehouseHours: string
  fbzInboundFeeKobo: number
  fbzStorageFeePerDayKobo: number
  fbzPickPackFeeKobo: number
  fbzFulfillmentFeeKobo: number
  fbzMaxStockPerSeller: number
  fbzWarehouseCapacity: number
  fbzAutoRejectDamagedGoods: boolean
  fbzRequireInsurance: boolean
  fbzInsuranceRatePercent: number
  fbzDeliveryPartner: string
  fbzDeliveryDaysMin: number
  fbzDeliveryDaysMax: number
  fbzCoveredStates: string[]
  // ── FBZ's own independent rate table (mirrors ZLA's shape exactly) ──
  fbzZonePrices: Record<string, number>
  fbzRouteOverrides: Record<string, number>
  fbzWeightTiers: WeightTierUI[]
  fbzDoorstepFee: number
  fbzFragileFee: number
}

const DEFAULTS: FBZSettings = {
  fbzEnabled: true,
  fbzPauseReason: "",
  fbzWarehouseAddress: "",
  fbzWarehousePhone: "",
  fbzWarehouseHours: "Mon–Sat, 9am–5pm",
  fbzInboundFeeKobo: 50000,
  fbzStorageFeePerDayKobo: 500,
  fbzPickPackFeeKobo: 40000,
  fbzFulfillmentFeeKobo: 1500,
  fbzMaxStockPerSeller: 500,
  fbzWarehouseCapacity: 10000,
  fbzAutoRejectDamagedGoods: true,
  fbzRequireInsurance: false,
  fbzInsuranceRatePercent: 0.5,
  fbzDeliveryPartner: "GIG Logistics",
  fbzDeliveryDaysMin: 1,
  fbzDeliveryDaysMax: 3,
  fbzCoveredStates: [],
  fbzZonePrices: {},
  fbzRouteOverrides: {},
  fbzWeightTiers: DEFAULT_WEIGHT_TIERS_UI,
  fbzDoorstepFee: 50000,
  fbzFragileFee: 30000,
}

// ─── FBZ Coverage Editor ──────────────────────────────────────────────────

function FBZCoverageEditor({
  states, onChange,
}: {
  states: string[]
  onChange: (v: string[]) => void
}) {
  const toggle = (state: string) =>
    onChange(
      states.includes(state)
        ? states.filter(s => s !== state)
        : [...states, state].sort()
    )

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" /> FBZ Delivery Coverage
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Select which states FBZ delivers to. Sellers and buyers will see this list when choosing FBZ as a shipping method.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {nigerianStates.map(state => {
          const active = states.includes(state)
          return (
            <button
              key={state}
              type="button"
              onClick={() => toggle(state)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-full border font-medium transition-all",
                active
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-background border-border text-muted-foreground hover:border-amber-400"
              )}
            >
              {state}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {states.length === 0
          ? "No states selected — FBZ will show as unavailable to buyers and sellers."
          : `${states.length} state${states.length === 1 ? "" : "s"} selected.`}
      </p>
    </div>
  )
}

// ─── Main Tab ─────────────────────────────────────────────────────────────

export function FBZRatesTab() {
  const { toast } = useToast()
  const [s, setS] = useState<FBZSettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    adminFetch("/api/admin/settings")
      .then(r => r.json())
      .then(json => {
        if (json?.settings) {
          const picked = pickFbzKeys(json.settings)
          // Back-compat: settings saved before FBZ had its own weight tiers
          // only have the old flat fbzWeightThreshold/fbzWeightPerKgKobo
          // pair (if any) — synthesize an equivalent 2-tier setup so this
          // doesn't silently reset to the bare default the first time it
          // loads after the upgrade.
          if (!Array.isArray((picked as any).fbzWeightTiers) || (picked as any).fbzWeightTiers.length === 0) {
            const legacyThreshold = (json.settings as any).fbzWeightThreshold
            const legacyPerKg     = (json.settings as any).fbzWeightPerKgKobo
            if (legacyThreshold != null && legacyPerKg != null) {
              picked.fbzWeightTiers = [
                { minKg: 0, maxKg: legacyThreshold, priceKobo: 0 },
                { minKg: legacyThreshold, maxKg: null, priceKobo: Math.round(legacyPerKg) },
              ]
            }
          }
          setS(prev => ({ ...prev, ...picked }))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const bool = (key: keyof FBZSettings) => () => setS(p => ({ ...p, [key]: !p[key] } as FBZSettings))
  const str  = (key: keyof FBZSettings) => (v: string) => setS(p => ({ ...p, [key]: v }))
  const num  = (key: keyof FBZSettings) => (v: number) => setS(p => ({ ...p, [key]: v }))
  const kobo = (key: keyof FBZSettings) => (v: number) => setS(p => ({ ...p, [key]: v }))

  // Preset routes + any custom ones the admin has added (present in saved
  // overrides but not in the preset list). Ordered presets-first so the
  // familiar list doesn't jump around as custom routes are added.
  const customRouteKeys = Object.keys(s.fbzRouteOverrides ?? {}).filter(
    k => !POPULAR_ROUTES.some(r => r.key === k)
  )
  const allRouteKeys = [...POPULAR_ROUTES.map(r => r.key), ...customRouteKeys]

  const save = async () => {
    setSaving(true)
    try {
      const res = await adminFetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Save failed (HTTP ${res.status})`)
      invalidateSettingsCache()
      invalidatePlatformCache()
      toast({ title: "✅ FBZ settings saved", description: "Changes applied instantly across the platform." })
    } catch (err: any) {
      toast({ title: "Error saving settings", description: err.message, variant: "destructive" })
    } finally { setSaving(false) }
  }

  if (loading) return (
    <div className="flex h-[40vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )

  return (
    <div className="space-y-5 pb-24">
      <SectionCard icon={Warehouse} title="FBZ — Fulfilled by Zamorax" accent>
        <ToggleRow label="FBZ enabled" desc="Toggle off to pause all new seller enrollments instantly" checked={s.fbzEnabled} onChange={bool("fbzEnabled")} />
        {!s.fbzEnabled && (
          <StrField label="Pause reason (shown to sellers)" value={s.fbzPauseReason} onChange={str("fbzPauseReason")} placeholder="e.g. We are at capacity. Check back in 2 weeks." />
        )}

        <Separator />

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Warehouse Drop-off Details
          </p>
          <p className="text-xs text-muted-foreground">Shown to sellers after their shipment is approved.</p>
          <StrField label="Drop-off address" value={s.fbzWarehouseAddress} onChange={str("fbzWarehouseAddress")} placeholder="e.g. 14 Bode Thomas Street, Surulere, Lagos" />
          <div className="space-y-1">
            <Label className="text-sm font-medium flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> Contact phone</Label>
            <Input value={s.fbzWarehousePhone} onChange={e => str("fbzWarehousePhone")(e.target.value)} placeholder="e.g. 0801 234 5678" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-medium flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Operating hours</Label>
            <Input value={s.fbzWarehouseHours} onChange={e => str("fbzWarehouseHours")(e.target.value)} placeholder="e.g. Mon–Sat, 9am–5pm" />
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">FBZ Fees (charged to sellers)</p>
          <KoboField label="Inbound handling fee (per item)"  value={s.fbzInboundFeeKobo}       onChange={kobo("fbzInboundFeeKobo")} />
          <KoboField label="Storage fee per day (per unit)"   value={s.fbzStorageFeePerDayKobo} onChange={kobo("fbzStorageFeePerDayKobo")} />
          <KoboField label="Pick & pack fee per order"        value={s.fbzPickPackFeeKobo}      onChange={kobo("fbzPickPackFeeKobo")} />
          <KoboField label="Fulfillment fee per order"        value={s.fbzFulfillmentFeeKobo}   onChange={kobo("fbzFulfillmentFeeKobo")} />
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Capacity & Rules</p>
          <NumField label="Max stock per seller" value={s.fbzMaxStockPerSeller} onChange={num("fbzMaxStockPerSeller")} suffix="units" />
          <NumField label="Total warehouse capacity" value={s.fbzWarehouseCapacity} onChange={num("fbzWarehouseCapacity")} suffix="units" />
          <ToggleRow label="Auto-reject damaged goods on intake" checked={s.fbzAutoRejectDamagedGoods} onChange={bool("fbzAutoRejectDamagedGoods")} />
          <ToggleRow label="Require seller insurance for FBZ items" checked={s.fbzRequireInsurance} onChange={bool("fbzRequireInsurance")} />
          {s.fbzRequireInsurance && (
            <NumField label="Insurance rate" value={s.fbzInsuranceRatePercent} onChange={num("fbzInsuranceRatePercent")} suffix="%" step={0.1} />
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Delivery Promise (shown to buyers)</p>
          <StrField label="Delivery partner name" value={s.fbzDeliveryPartner} onChange={str("fbzDeliveryPartner")} placeholder="e.g. GIG Logistics" />
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Min delivery days" value={s.fbzDeliveryDaysMin} onChange={num("fbzDeliveryDaysMin")} suffix="days" />
            <NumField label="Max delivery days" value={s.fbzDeliveryDaysMax} onChange={num("fbzDeliveryDaysMax")} suffix="days" />
          </div>
          <InfoBox color="green">
            Buyers see: <strong>"⚡ FBZ — Arrives in {s.fbzDeliveryDaysMin}–{s.fbzDeliveryDaysMax} days via {s.fbzDeliveryPartner || "courier"}"</strong>
          </InfoBox>
        </div>

        <Separator />

        <FBZCoverageEditor
          states={s.fbzCoveredStates}
          onChange={v => setS(p => ({ ...p, fbzCoveredStates: v }))}
        />

        <Separator />

        {/* ── FBZ Rate Settings — independent of ZamoraxLogic ────────────
            Same zone/route/weight/doorstep shape as ZLA, but its own
            fbz*-prefixed keys. Calculated at checkout from the WAREHOUSE's
            state (where the seller dropped stock) to the buyer's state —
            never the seller's own state — see getFbzDeliveryFee(). */}
        <div className="space-y-1">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Truck className="h-4 w-4 text-amber-600" /> FBZ Rate Settings
          </p>
          <p className="text-xs text-muted-foreground">
            Priced independently from ZamoraxLogic — from the warehouse's state to the buyer's state, not the seller's.
          </p>
        </div>

        {/* ── Zone Base Rates ── */}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Zone Base Rates</p>
            <p className="text-xs text-muted-foreground mt-1">
              Base rate by warehouse-zone → buyer-zone before weight pricing is added. Route overrides below take priority.
            </p>
          </div>
          <div className="space-y-2">
            {ZONE_PAIRS.map(({ key, label }) => (
              <KoboField
                key={key}
                label={label}
                value={(s.fbzZonePrices ?? {})[key] ?? DEFAULT_ZONE_PRICES[key] ?? 0}
                onChange={v => setS(p => ({ ...p, fbzZonePrices: { ...(p.fbzZonePrices ?? {}), [key]: v } }))}
              />
            ))}
          </div>
        </div>

        <Separator />

        {/* ── Route Overrides ── */}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Route Overrides</p>
            <p className="text-xs text-muted-foreground mt-1">
              These override zone prices above. Pre-loaded with common routes — add any other warehouse State → buyer State pair you need priced individually.
            </p>
          </div>
          <div className="space-y-2">
            {allRouteKeys.map(key => {
              const preset = POPULAR_ROUTES.find(r => r.key === key)
              const [from, to] = key.split("__")
              const label = preset?.label ?? `${from} → ${to}`
              const isCustom = !preset
              return (
                <div key={key} className="flex items-center gap-2">
                  <div className="flex-1">
                    <KoboField
                      label={label}
                      value={(s.fbzRouteOverrides ?? {})[key] ?? DEFAULT_ROUTE_OVERRIDES[key] ?? 0}
                      onChange={v => setS(p => ({ ...p, fbzRouteOverrides: { ...(p.fbzRouteOverrides ?? {}), [key]: v } }))}
                    />
                  </div>
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => setS(p => {
                        const next = { ...(p.fbzRouteOverrides ?? {}) }
                        delete next[key]
                        return { ...p, fbzRouteOverrides: next }
                      })}
                      className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md border text-muted-foreground hover:text-red-600 hover:border-red-200"
                      title="Remove custom route"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <AddRouteForm
            onAdd={(from, to) => setS(p => ({
              ...p,
              fbzRouteOverrides: { ...(p.fbzRouteOverrides ?? {}), [`${from}__${to}`]: 0 },
            }))}
          />
        </div>

        <Separator />

        {/* ── Weight Pricing ── */}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Weight Pricing</p>
            <p className="text-xs text-muted-foreground mt-1">
              Set the FBZ delivery fee by weight band. Independent of ZamoraxLogic's weight bands.
            </p>
          </div>
          <WeightTiersEditor
            tiers={s.fbzWeightTiers ?? DEFAULT_WEIGHT_TIERS_UI}
            onChange={v => setS(p => ({ ...p, fbzWeightTiers: v }))}
          />
        </div>

        <Separator />

        {/* ── Other Surcharges ── */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Other Surcharges</p>
          <KoboField label="Doorstep delivery fee" desc="Extra when buyer chooses doorstep" value={s.fbzDoorstepFee} onChange={kobo("fbzDoorstepFee")} />
          <KoboField label="Fragile handling fee"  desc="Extra when item is marked fragile" value={s.fbzFragileFee}  onChange={kobo("fbzFragileFee")} />
        </div>

        <Separator />

        <FBZWarehouseLocations />
      </SectionCard>

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={save} disabled={saving} size="lg" className="shadow-lg">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save FBZ Settings
        </Button>
      </div>
    </div>
  )
}

// Pull only the FBZ-relevant keys out of the full settings blob so this
// tab's local state never carries unrelated settings fields around.
function pickFbzKeys(full: Record<string, any>): Partial<FBZSettings> {
  const keys: (keyof FBZSettings)[] = [
    "fbzEnabled", "fbzPauseReason", "fbzWarehouseAddress", "fbzWarehousePhone",
    "fbzWarehouseHours", "fbzInboundFeeKobo", "fbzStorageFeePerDayKobo",
    "fbzPickPackFeeKobo", "fbzFulfillmentFeeKobo", "fbzMaxStockPerSeller",
    "fbzWarehouseCapacity", "fbzAutoRejectDamagedGoods", "fbzRequireInsurance",
    "fbzInsuranceRatePercent", "fbzDeliveryPartner", "fbzDeliveryDaysMin",
    "fbzDeliveryDaysMax", "fbzCoveredStates",
    "fbzZonePrices", "fbzRouteOverrides", "fbzWeightTiers",
    "fbzDoorstepFee", "fbzFragileFee",
  ]
  const picked: Partial<FBZSettings> = {}
  for (const k of keys) {
    if (full[k] !== undefined) (picked as any)[k] = full[k]
  }
  return picked
}
