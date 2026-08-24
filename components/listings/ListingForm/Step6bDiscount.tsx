"use client"
// components/listings/ListingForm/Step6bDiscount.tsx
// Standing discount step — lets the seller set a plain, permanent price cut
// on this listing (percentage off, applied automatically, no code needed).
//
// Unlike flashDeal (time-limited, set post-creation from the seller
// dashboard, shown to buyers as a red countdown "FLASH DEAL" badge) and
// coupon (buyer must enter a code at checkout), this one has no expiry and
// is never labeled "discount" or "flash deal" anywhere buyers see it — it
// just renders as a struck-through original price next to the new price,
// like a normal marketplace listing. Available on both creation and edit,
// and not gated on any admin sub-setting.

import { useFormContext, Controller } from "react-hook-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Percent, Info } from "lucide-react"

export function Step6bDiscount() {
  const { control, watch, setValue, formState: { errors } } = useFormContext()
  const enabled = watch("standingDiscountEnabled")
  const priceSale = watch("priceSale")
  const discountPercent = watch("standingDiscountPercent")
  const bulkPricing = watch("bulkPricing")
  const hasBulkPricing = Array.isArray(bulkPricing) && bulkPricing.length > 0

  const previewPrice = enabled && priceSale && discountPercent
    ? Math.round(priceSale * (1 - discountPercent / 100))
    : null

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="flex items-center gap-2">
            <Percent className="h-4 w-4 text-primary" />
            Price Cut (Optional)
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            Show a lower price on this listing right away — no code, no timer, just a better price for buyers.
          </p>
        </div>
        <Controller
          name="standingDiscountEnabled"
          control={control}
          render={({ field }) => (
            <Switch
              checked={!!field.value}
              onCheckedChange={(v) => {
                field.onChange(v)
                if (!v) {
                  setValue("standingDiscountPercent", undefined)
                  setValue("standingDiscountApplyToBulk", false)
                }
              }}
            />
          )}
        />
      </div>

      {enabled && (
        <div className="space-y-4 rounded-xl border border-border/60 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="standingDiscountPercent">Discount percentage</Label>
            <Controller
              name="standingDiscountPercent"
              control={control}
              render={({ field }) => (
                <Input
                  id="standingDiscountPercent"
                  type="number"
                  min={1}
                  max={90}
                  placeholder="e.g. 5"
                  value={field.value ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value)
                    field.onChange(v)
                  }}
                />
              )}
            />
            {errors.standingDiscountPercent && (
              <p className="text-xs text-destructive">{String((errors.standingDiscountPercent as any).message)}</p>
            )}
            <p className="text-xs text-muted-foreground">Up to 90%. Stays on until you change or turn it off.</p>
          </div>

          {previewPrice != null && (
            <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
              <Info className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-foreground">
                Buyers will see <strong>₦{previewPrice.toLocaleString()}</strong> instead of ₦{Number(priceSale).toLocaleString()} — automatically, no code needed.
              </p>
            </div>
          )}

          {/* Only shown when this listing actually has bulk pricing tiers —
              a discount toggle for a feature the listing doesn't use would
              just be confusing. Off by default: a bulk tier is often
              already a negotiated bundle price the seller may not want
              stacked with this discount. */}
          {hasBulkPricing && (
            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div className="pr-3">
                <Label className="text-sm">Apply to bulk pricing too</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Also discount your bulk-price tiers by the same {discountPercent || "—"}%, not just the single-piece price.
                </p>
              </div>
              <Controller
                name="standingDiscountApplyToBulk"
                control={control}
                render={({ field }) => (
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                )}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
