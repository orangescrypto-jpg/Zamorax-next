"use client"

// components/listings/ListingForm/Step5Location.tsx
// Location + shipping details step.
// Added: weightKg field (defaults 0.5kg) + isFragile toggle.
// Weight is used at checkout to auto-calculate logistics fee for buyer.

import { useFormContext } from "react-hook-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { nigerianStates } from "@/constants/nigerianStates"
import { Package, Weight, Info } from "lucide-react"

// See Step2Details.tsx for the full explanation — valueAsNumber turns a
// blank input into NaN (not undefined), which fails an optional() schema
// check silently. weightKg has a 0.5 default so this is less likely to be
// hit, but stays consistent with the other optional numeric fields.
const optionalNumber = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

export function Step5Location() {
  const { register, watch, setValue, formState: { errors } } = useFormContext()
  const nationwide = watch("deliveryNationwide")
  const isFragile  = watch("isFragile") ?? false
  const weightKg   = watch("weightKg")

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2">

      {/* State */}
      <div className="space-y-2">
        <Label>State</Label>
        <Select onValueChange={v => setValue("nigerianState", v)} value={watch("nigerianState")}>
          <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
          <SelectContent className="max-h-60">
            {nigerianStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {errors.nigerianState && <p className="text-sm text-destructive">{String(errors.nigerianState.message)}</p>}
      </div>

      {/* City */}
      <div className="space-y-2">
        <Label>City / Area</Label>
        <Input {...register("city")} placeholder="e.g., Ikeja, Lekki, GRA" />
        {errors.city && <p className="text-sm text-destructive">{String(errors.city.message)}</p>}
      </div>

      {/* Nationwide delivery toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/20">
        <div>
          <Label className="cursor-pointer">Nationwide Delivery</Label>
          <p className="text-xs text-muted-foreground">Buyers across Nigeria can view & order this item.</p>
        </div>
        <Switch checked={nationwide} onCheckedChange={v => setValue("deliveryNationwide", v, { shouldValidate: true })} />
      </div>

      {/* ── Shipping Details ─────────────────────────────────────── */}
      <div className="space-y-4 p-4 border rounded-lg bg-muted/10">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Shipping Details</p>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Help buyers see the correct delivery fee before they pay.
        </p>

        {/* Weight */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Weight className="h-3.5 w-3.5" /> Item Weight (kg)
          </Label>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              step="0.1"
              min="0.1"
              max="100"
              placeholder="0.5"
              {...register("weightKg", { setValueAs: optionalNumber })}
              className="max-w-[120px]"
              onFocus={e => {
                // Clear 0 on focus so user doesn't have to delete it
                if (e.target.value === "0") e.target.value = ""
              }}
            />
            <span className="text-sm text-muted-foreground">kg</span>
          </div>
          {/* Weight hint */}
          <div className="flex items-start gap-1.5 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            <Info className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-700">
              Items up to <strong>2kg</strong> pay the standard base rate.
              Above 2kg, a small surcharge applies per extra kg.
              Leave as <strong>0.5kg</strong> if unsure — most small items qualify for the base rate.
            </p>
          </div>
          {errors.weightKg && <p className="text-sm text-destructive">{String(errors.weightKg.message)}</p>}
        </div>

        {/* Fragile toggle */}
        <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
          <div>
            <p className="text-sm font-medium">Fragile Item</p>
            <p className="text-xs text-muted-foreground">
              Requires extra care during handling. A small fragile surcharge applies.
            </p>
          </div>
          <Switch
            checked={isFragile}
            onCheckedChange={v => setValue("isFragile", v)}
          />
        </div>

        {/* Summary preview */}
        {(weightKg > 2 || isFragile) && (
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
            {weightKg > 2 && <p>⚖️ Weight surcharge applies — item is above 2kg threshold</p>}
            {isFragile  && <p>📦 Fragile surcharge applies</p>}
          </div>
        )}
      </div>
    </div>
  )
}
