"use client"

// components/listings/ListingForm/Step5bShipment.tsx
// Seller chooses which delivery methods to offer buyers.
// Only globally-enabled methods (from admin config/platform) are shown.
// At least one method must be selected — if seller reaches Next without
// choosing, meetup is auto-selected so the step always passes validation.
// For ZLA and FBZ, an expandable info panel shows how it works
// and which Nigerian states are currently covered.

import { useEffect, useState } from "react"
import { useFormContext } from "react-hook-form"
import { ShippingService, type ShippingMethodConfig, type FBZWarehouseAvailability } from "@/src/services"
import { cn } from "@/lib/utils"
import {
  Users, Package, Zap, ChevronDown, ChevronUp,
  MapPin, Info, Loader2, CheckCircle2, Truck, Warehouse,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Method = "meetup" | "zamorax_logistics" | "fbz"

function StatePills({ states, emptyMsg }: { states: string[]; emptyMsg: string }) {
  if (states.length === 0) {
    return <p className="text-xs text-muted-foreground italic">{emptyMsg}</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {states.map(s => (
        <span
          key={s}
          className="inline-flex items-center gap-1 text-[10px] font-medium bg-muted border rounded-full px-2 py-0.5"
        >
          <MapPin className="h-2.5 w-2.5 text-muted-foreground" />{s}
        </span>
      ))}
    </div>
  )
}

function WarehouseList({ warehouses }: { warehouses: FBZWarehouseAvailability[] }) {
  if (warehouses.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Admin hasn't added any FBZ warehouse locations yet.
      </p>
    )
  }
  return (
    <div className="space-y-1.5 mt-1">
      {warehouses.map(w => (
        <div
          key={w.id}
          className="flex items-center justify-between gap-2 text-xs bg-white border rounded-lg px-2.5 py-1.5"
        >
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">{w.name}</p>
            <p className="text-muted-foreground flex items-center gap-1">
              <MapPin className="h-2.5 w-2.5 shrink-0" />{w.city}, {w.state}
            </p>
          </div>
          {!w.isActive ? (
            <Badge variant="outline" className="text-[10px] px-1.5 shrink-0 text-muted-foreground">
              Inactive
            </Badge>
          ) : w.acceptingStock ? (
            <Badge className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5 shrink-0">
              Accepting stock
            </Badge>
          ) : (
            <Badge className="bg-red-100 text-red-700 text-[10px] px-1.5 shrink-0">
              At capacity
            </Badge>
          )}
        </div>
      ))}
    </div>
  )
}

export function Step5bShipment() {
  const { setValue, watch, register, formState: { errors } } = useFormContext()
  const selected: Method[] = watch("shippingMethods") ?? []

  const [config, setConfig]       = useState<ShippingMethodConfig | null>(null)
  const [loading, setLoading]     = useState(true)
  const [zlaOpen, setZlaOpen]     = useState(false)
  const [fbzOpen, setFbzOpen]     = useState(false)

  useEffect(() => {
    ShippingService.getConfig()
      .then(setConfig)
      .finally(() => setLoading(false))
  }, [])

  const toggle = (method: Method) => {
    const next = selected.includes(method)
      ? selected.filter(m => m !== method)
      : [...selected, method]
    // Always keep at least meetup if the result would be empty
    setValue("shippingMethods", next.length > 0 ? next : ["meetup"], { shouldValidate: true })
  }

  const isOn = (method: Method) => selected.includes(method)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!config) return null

  const { meetupEnabled, zlaEnabled, fbzEnabled, zlaCoveredStates, fbzCoveredStates, fbzWarehouses } = config
  const fbzHasAcceptingWarehouse = fbzWarehouses.some(w => w.acceptingStock)

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2">
      <div>
        <p className="text-sm font-semibold">Delivery Methods</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Choose how buyers can receive this item. You can offer multiple options.
          Meet Up is selected by default if you don't choose.
        </p>
      </div>

      {errors.shippingMethods && (
        <p className="text-sm text-destructive">
          {String((errors.shippingMethods as any).message)}
        </p>
      )}

      <div className="space-y-3">

        {/* ── Meet Up ─────────────────────────────────────────────── */}
        {meetupEnabled && (
          <div
            className={cn(
              "rounded-xl border-2 transition-all cursor-pointer",
              isOn("meetup")
                ? "border-emerald-500 bg-emerald-50"
                : "border-border hover:border-emerald-300 bg-muted/20"
            )}
            onClick={() => toggle("meetup")}
          >
            <div className="flex items-center gap-3 p-4">
              <div className={cn(
                "p-2 rounded-lg shrink-0",
                isOn("meetup") ? "bg-emerald-500 text-white" : "bg-white border text-muted-foreground"
              )}>
                <Users className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">Safe Meet Up</p>
                  <Badge className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5">Free</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Buyer meets you at a safe public spot in your city. No shipping cost involved.
                </p>
              </div>
              {isOn("meetup") && <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />}
            </div>
          </div>
        )}

        {/* ── ZamoraxLogic ────────────────────────────────────────── */}
        {zlaEnabled && (
          <div
            className={cn(
              "rounded-xl border-2 transition-all",
              isOn("zamorax_logistics")
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40 bg-muted/20"
            )}
          >
            {/* Header row — clicking toggles selection */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer"
              onClick={() => toggle("zamorax_logistics")}
            >
              <div className={cn(
                "p-2 rounded-lg shrink-0",
                isOn("zamorax_logistics") ? "bg-primary text-white" : "bg-white border text-muted-foreground"
              )}>
                <Package className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">ZamoraxLogic Delivery</p>
                  <Badge className="bg-primary/10 text-primary text-[10px] px-1.5">No meetup needed</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Drop parcel at nearest agent. Buyer receives it anywhere in Nigeria.
                </p>
              </div>
              {isOn("zamorax_logistics") && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
            </div>

            {/* Info panel toggle */}
            <button
              type="button"
              onClick={() => setZlaOpen(v => !v)}
              className="w-full flex items-center gap-1.5 px-4 pb-3 text-xs text-primary font-medium hover:underline"
            >
              <Info className="h-3.5 w-3.5" />
              How it works &amp; covered states
              {zlaOpen ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
            </button>

            {zlaOpen && (
              <div className="px-4 pb-4 space-y-3 border-t pt-3 mx-4 mb-1">
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">How ZamoraxLogic works</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>You drop the parcel at your nearest Zamorax agent after the order is placed.</li>
                    <li>The agent hands it off through our network to an agent near the buyer.</li>
                    <li>The buyer either picks up from their local agent or gets doorstep delivery.</li>
                    <li>Delivery fee is calculated automatically at checkout based on states.</li>
                  </ol>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-primary" /> Currently covered states
                  </p>
                  <StatePills
                    states={zlaCoveredStates}
                    emptyMsg="No active agents yet — coverage will show here once agents are live in your region."
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FBZ ─────────────────────────────────────────────────── */}
        {fbzEnabled && (
          <div
            className={cn(
              "rounded-xl border-2 transition-all",
              isOn("fbz")
                ? "border-amber-500 bg-amber-50"
                : "border-border hover:border-amber-300 bg-muted/20"
            )}
          >
            {/* Header row */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer"
              onClick={() => toggle("fbz")}
            >
              <div className={cn(
                "p-2 rounded-lg shrink-0",
                isOn("fbz") ? "bg-amber-500 text-white" : "bg-white border text-muted-foreground"
              )}>
                <Zap className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">FBZ — Fulfilled by Zamorax</p>
                  <Badge className="bg-amber-100 text-amber-700 text-[10px] px-1.5">⚡ Fastest</Badge>
                  {fbzHasAcceptingWarehouse ? (
                    <Badge className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5">
                      Warehouse available
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground">
                      No warehouse open right now
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Send your stock to our warehouse. We handle storage, packing, and fast dispatch.
                </p>
              </div>
              {isOn("fbz") && <CheckCircle2 className="h-5 w-5 text-amber-500 shrink-0" />}
            </div>

            {/* Info panel toggle */}
            <button
              type="button"
              onClick={() => setFbzOpen(v => !v)}
              className="w-full flex items-center gap-1.5 px-4 pb-3 text-xs text-amber-700 font-medium hover:underline"
            >
              <Info className="h-3.5 w-3.5" />
              How it works &amp; covered states
              {fbzOpen ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
            </button>

            {fbzOpen && (
              <div className="px-4 pb-4 space-y-3 border-t pt-3 mx-4 mb-1">
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">How FBZ works</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Ship your items to the Zamorax warehouse upfront.</li>
                    <li>We inspect, store, and list them as FBZ-ready.</li>
                    <li>When a buyer orders, we pick, pack, and dispatch immediately.</li>
                    <li>Buyers get faster delivery and you don't handle shipping per order.</li>
                  </ol>
                  <p className="pt-1">
                    Storage, inbound, and pick &amp; pack fees apply — view them under your FBZ dashboard.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-amber-600" /> States we deliver to via FBZ
                  </p>
                  <StatePills
                    states={fbzCoveredStates}
                    emptyMsg="No active warehouse locations yet — admin hasn't set one up in your area."
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Warehouse className="h-3.5 w-3.5 text-amber-600" /> Warehouse locations
                  </p>
                  <WarehouseList warehouses={fbzWarehouses} />
                </div>
              </div>
            )}

            {/* Warehouse + quantity picker — shown once FBZ is selected, so
                the shipment request is captured in the same step instead of
                sending the seller to a separate /dashboard/fbz visit after
                the listing is created. Only warehouses currently accepting
                stock are selectable. */}
            {isOn("fbz") && (
              <div className="px-4 pb-4 space-y-3 border-t pt-3 mx-4 mb-1">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">
                    Send stock to which warehouse?
                  </Label>
                  {fbzWarehouses.filter(w => w.acceptingStock).length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No warehouse is currently accepting stock — you can still list with FBZ
                      selected, but ship-to-warehouse will need to wait until one opens.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {fbzWarehouses.filter(w => w.acceptingStock).map(w => (
                        <div
                          key={w.id}
                          onClick={() => setValue("fbzWarehouseId", w.id, { shouldValidate: true })}
                          className={cn(
                            "flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-2 border cursor-pointer",
                            watch("fbzWarehouseId") === w.id
                              ? "border-amber-500 bg-amber-100/60"
                              : "border-border bg-white hover:border-amber-300"
                          )}
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{w.name}</p>
                            <p className="text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />{w.city}, {w.state}
                            </p>
                          </div>
                          {watch("fbzWarehouseId") === w.id && (
                            <CheckCircle2 className="h-4 w-4 text-amber-500 shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">
                    Quantity you'll send to the warehouse
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 15"
                    {...register("fbzQuantity", { valueAsNumber: true })}
                    className="max-w-[160px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    No fixed minimum or maximum — send what you have. Admin will confirm the
                    actual count when it arrives at the warehouse.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">
                    Notes for warehouse team (optional)
                  </Label>
                  <Input
                    placeholder="e.g. All items are sealed, accessories included..."
                    {...register("fbzNotes")}
                  />
                </div>

                <p className="text-xs text-amber-700 bg-amber-100/60 rounded-lg px-2.5 py-2">
                  This listing won't go live until admin confirms your stock has arrived and
                  activates it — this is in addition to the normal listing review.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Fallback: all methods disabled by admin */}
        {!meetupEnabled && !zlaEnabled && !fbzEnabled && (
          <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground text-center">
            All delivery methods are currently disabled by the platform. Contact support.
          </div>
        )}
      </div>

      {/* ── Estimated delivery time ─────────────────────────────── */}
      <div className="rounded-xl border-2 border-border bg-muted/20 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-white border text-muted-foreground shrink-0">
            <Truck className="h-4 w-4" />
          </div>
          <p className="font-semibold text-sm">Estimated Delivery Time</p>
          <Badge variant="outline" className="text-[10px] px-1.5 font-normal">Optional</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          How fast can buyers realistically expect this item? Shown on your listing as a
          trust signal — buyers care a lot about speed. Only commit to a window you can meet.
        </p>
        <Input
          placeholder="e.g. 2-4 days"
          maxLength={20}
          {...register("estimatedDeliveryDays")}
          className="max-w-[200px]"
        />
      </div>
    </div>
  )
}
