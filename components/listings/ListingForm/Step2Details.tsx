"use client"
// components/listings/ListingForm/Step2Details.tsx
// Price step — shows live fee note below the price input.
// Reads from useFeeSettings() so if admin changes commission, the note updates automatically.
// If admin sets a fee to 0, the note reflects that (e.g. "0% commission — free listing!").

import { useFormContext, useFieldArray } from "react-hook-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCategoryBySlug } from "@/constants/categories"
import { Package, Info, Layers, Plus, Trash2 } from "lucide-react"
import { useFeeSettings } from "@/hooks/useFeeSettings"
import { calculateFees } from "@/src/services/feeSettings"
import { formatPrice } from "@/lib/utils"

// FIX: register(field, { valueAsNumber: true }) turns a blank input into
// NaN, not undefined. NaN is still typeof "number", so Zod's
// z.number().optional() doesn't skip it — it tries to validate NaN and
// fails with "Expected number, received nan", silently blocking the whole
// form's isValid with no error shown on the field itself (since RHF only
// flags a field as touched on blur/change — a field the seller never
// touched can still poison isValid). Used below for every optional numeric
// field so "leave blank" actually means blank, not a hidden NaN.
const optionalNumber = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

// ── Live fee note shown below price input ─────────────────────────────────────

function PriceFeeNote({
  priceNaira,
  type,
}: {
  priceNaira: number
  type: "sale" | "rental"
}) {
  const { fees, loading } = useFeeSettings()

  if (loading) return null
  const commissionPct = type === "rental" ? fees.commissionRental : fees.commissionSale

  if (!priceNaira || priceNaira <= 0) {
    // No price entered yet — just show the rates so seller knows upfront
    if (commissionPct === 0 && fees.insuranceRate === 0) {
      return (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 mt-1">
          <Info className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-xs text-emerald-700">
            🎉 <strong>0% platform fee</strong> right now — you keep 100% of whatever price you set!
          </p>
        </div>
      )
    }
    return (
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 mt-1 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          <p className="text-xs font-semibold text-blue-700">Deductions from your payout:</p>
        </div>
        <ul className="text-xs text-blue-700 space-y-1 pl-5 list-disc">
          {commissionPct > 0 && (
            <li>
              <strong>{commissionPct}% platform fee</strong> — Zamorax service charge for listing, escrow protection, and buyer trust
            </li>
          )}
          {fees.insuranceRate > 0 && (
            <li>
              <strong>{fees.insuranceRate}% escrow/arbitration fee</strong> — held separately to cover any buyer–seller dispute. Returned to you if no dispute is raised
            </li>
          )}
          {fees.withdrawalFee > 0 && (
            <li>
              <strong>₦{(fees.withdrawalFee / 100).toLocaleString()} withdrawal fee</strong> — flat charge when you request a payout
            </li>
          )}
        </ul>
        <p className="text-xs text-blue-600 pl-1">Enter a price above to see your exact net earnings.</p>
      </div>
    )
  }

  const itemPriceKobo = priceNaira * 100
  const breakdown     = calculateFees(itemPriceKobo, type, fees)

  if (commissionPct === 0 && fees.insuranceRate === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 mt-1">
        <Info className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
        <p className="text-xs text-emerald-700">
          🎉 No fees right now — you receive the full <strong>{formatPrice(itemPriceKobo)}</strong>.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 mt-1 space-y-2">
      <div className="flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />
        <p className="text-xs font-semibold text-blue-700">Payout breakdown for {formatPrice(itemPriceKobo)}:</p>
      </div>
      <ul className="text-xs text-blue-700 space-y-1 pl-5 list-disc">
        {breakdown.commissionKobo > 0 && (
          <li>
            <strong>-{formatPrice(breakdown.commissionKobo)}</strong> platform fee ({commissionPct}%) — escrow & service charge
          </li>
        )}
        {breakdown.insuranceKobo > 0 && (
          <li>
            <strong>-{formatPrice(breakdown.insuranceKobo)}</strong> arbitration fee ({fees.insuranceRate}%) — dispute protection fund
          </li>
        )}
        {breakdown.withdrawalFeeKobo > 0 && (
          <li>
            <strong>-{formatPrice(breakdown.withdrawalFeeKobo)}</strong> withdrawal fee (fixed, on payout)
          </li>
        )}
      </ul>
      <div className="flex justify-between items-center border-t border-blue-200 pt-2">
        <p className="text-xs font-bold text-blue-800">You receive after settlement:</p>
        <p className="text-sm font-bold text-blue-900">{formatPrice(breakdown.sellerPayoutKobo)}</p>
      </div>
    </div>
  )
}

// ── Bulk / quantity pricing — seller-defined tiers ──────────────────────────
// e.g. 1 piece: priceSale | ≥5: ₦X | ≥15: ₦Y | ≥25: ₦Z
// Seller can add/remove tiers freely, no fixed count.

function BulkPricingSection({ priceSale, stockQty }: { priceSale: number; stockQty?: number }) {
  const { control, register, watch, formState: { errors } } = useFormContext()
  const { fields, append, remove } = useFieldArray({ control, name: "bulkPricing" })
  const tiers = watch("bulkPricing") ?? []

  const bulkPricingError =
    (errors.bulkPricing as any)?.message ||
    (errors as any).root?.bulkPricing?.message

  // Soft warning (non-blocking): stock quantity is lower than the highest
  // bulk tier's minQty, meaning that top tier can never actually be fulfilled.
  const validTiers = tiers.filter((t: any) => t?.minQty)
  const highestTierMinQty = validTiers.length
    ? Math.max(...validTiers.map((t: any) => Number(t.minQty)))
    : undefined
  const showStockWarning =
    typeof stockQty === "number" && highestTierMinQty !== undefined && stockQty < highestTierMinQty

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Bulk Pricing (Optional)
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            Offer a lower price per piece when buyers order in bulk, e.g. ≥5 pieces.
          </p>
        </div>
      </div>

      {fields.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border/60 p-4">
          {priceSale > 0 && (
            <p className="text-xs text-muted-foreground">
              1 piece: <strong className="text-foreground">{formatPrice(priceSale * 100)}</strong>
            </p>
          )}
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`bulkPricing.${index}.minQty`} className="text-xs">
                  Min. quantity
                </Label>
                <Input
                  id={`bulkPricing.${index}.minQty`}
                  type="number"
                  min={2}
                  placeholder="e.g. 5"
                  {...register(`bulkPricing.${index}.minQty`, { valueAsNumber: true })}
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`bulkPricing.${index}.price`} className="text-xs">
                  Price per piece (₦)
                </Label>
                <Input
                  id={`bulkPricing.${index}.price`}
                  type="number"
                  min={1}
                  placeholder="e.g. 22,500"
                  {...register(`bulkPricing.${index}.price`, { valueAsNumber: true })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive shrink-0"
                onClick={() => remove(index)}
                aria-label="Remove tier"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {bulkPricingError && (
            <p className="text-xs text-destructive">{String(bulkPricingError)}</p>
          )}
          {showStockWarning && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
              <Info className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                Your highest tier needs ≥{highestTierMinQty} pieces, but stock is only {stockQty}. That tier won't be reachable until you restock.
              </p>
            </div>
          )}
          {priceSale > 0 && tiers.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
              <Info className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-foreground">
                Buyers will see: 1 piece {formatPrice(priceSale * 100)}
                {tiers
                  .filter((t: any) => t?.minQty && t?.price)
                  .map((t: any, i: number) => (
                    <span key={i}> · ≥{t.minQty} pieces {formatPrice(t.price * 100)}</span>
                  ))}
              </p>
            </div>
          )}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ minQty: undefined, price: undefined })}
        className="gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" />
        Add price tier
      </Button>
    </div>
  )
}

// ── Main step component ───────────────────────────────────────────────────────

export function Step2Details() {
  const { register, watch, setValue, formState: { errors } } = useFormContext()
  const category    = watch("categorySlug")
  const listingType = watch("listingType")
  const priceSale   = watch("priceSale")
  const priceRent   = watch("priceRentDaily")
  const stockQty    = watch("stockQty")
  const offersEnabled = watch("offersEnabled")

  // Auto-calculate deposit for rentals (30% default, adjustable)
  const updateDeposit = () => {
    if (priceRent && Number(priceRent) > 0) {
      setValue("depositAmount", Math.ceil(Number(priceRent) * 0.3), { shouldValidate: true })
    }
  }

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2">
      <div className="space-y-2">
        <Label>Listing Title</Label>
        <Input {...register("title")} placeholder="e.g., iPhone 14 Pro Max 256GB Deep Purple" />
        {errors.title && <p className="text-sm text-destructive">{String(errors.title.message)}</p>}
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea {...register("description")} placeholder="Describe condition, accessories, defects, etc." rows={4} />
        {errors.description && <p className="text-sm text-destructive">{String(errors.description.message)}</p>}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Condition</Label>
          <Select onValueChange={(v) => setValue("condition", v)}>
            <SelectTrigger><SelectValue placeholder="Select condition" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="brand_new">Brand New</SelectItem>
              <SelectItem value="open_box">Open Box</SelectItem>
              <SelectItem value="grade_a">Grade A (Excellent)</SelectItem>
              <SelectItem value="grade_b">Grade B (Good/Fair)</SelectItem>
            </SelectContent>
          </Select>
          {errors.condition && <p className="text-sm text-destructive">{String(errors.condition.message)}</p>}
        </div>
      </div>

      {/* ── Sale price + live fee note ──────────────────────────── */}
      {(listingType === "sale" || listingType === "both" || !listingType) && (
        <div className="space-y-2">
          <Label>Price (₦)</Label>
          <Input
            type="number"
            {...register("priceSale", { valueAsNumber: true })}
            placeholder="100,000"
          />
          {errors.priceSale && (
            <p className="text-sm text-destructive">{String(errors.priceSale.message)}</p>
          )}
          {/* Live fee note — updates as seller types */}
          <PriceFeeNote priceNaira={Number(priceSale) || 0} type="sale" />
        </div>
      )}

      {/* Stock Quantity — only for sale listings */}
      {(listingType === "sale" || listingType === "both") && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            Stock Quantity
          </Label>
          <Input
            type="number"
            min={0}
            placeholder="Leave blank for unlimited"
            {...register("stockQty", { setValueAs: optionalNumber })}
          />
          <p className="text-xs text-muted-foreground">
            How many of this item do you have? Leave blank for unlimited. Set to <strong>1</strong> if this is a unique item (used laptop, one-of-a-kind).
          </p>
          {errors.stockQty && <p className="text-sm text-destructive">{String(errors.stockQty.message)}</p>}
        </div>
      )}

      {/* ── Bulk / quantity pricing (optional) ─────────────────── */}
      {(listingType === "sale" || listingType === "both") && (
        <BulkPricingSection
          priceSale={Number(priceSale) || 0}
          stockQty={stockQty === undefined || stockQty === null || stockQty === "" ? undefined : Number(stockQty)}
        />
      )}

      {/* ── Minimum order quantity + unit of sale (optional) ────── */}
      {(listingType === "sale" || listingType === "both") && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              Minimum Order Quantity (Optional)
            </Label>
            <Input
              type="number"
              min={1}
              placeholder="Leave blank for no minimum"
              {...register("minOrderQty", { setValueAs: optionalNumber })}
            />
            <p className="text-xs text-muted-foreground">
              Buyers can't order fewer than this. Separate from bulk pricing tiers.
            </p>
            {errors.minOrderQty && <p className="text-sm text-destructive">{String(errors.minOrderQty.message)}</p>}
          </div>

          <div className="space-y-2">
            <Label>Unit of Sale</Label>
            <Select onValueChange={(v) => setValue("unitOfSale", v)} defaultValue="piece">
              <SelectTrigger><SelectValue placeholder="Piece" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="piece">Piece</SelectItem>
                <SelectItem value="bag">Bag</SelectItem>
                <SelectItem value="carton">Carton</SelectItem>
                <SelectItem value="pack">Pack</SelectItem>
                <SelectItem value="dozen">Dozen</SelectItem>
                <SelectItem value="kg">Kg</SelectItem>
                <SelectItem value="litre">Litre</SelectItem>
                <SelectItem value="unit">Unit</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Defaults to "Piece" — how buyers order this item.</p>
          </div>
        </div>
      )}

      {/* ── Allow buyer offers toggle (optional, defaults ON) ───── */}
      <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
        <div>
          <Label>Allow Buyer Offers</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Buyers can negotiate with an offer on this listing. Switch off if you only want fixed-price sales.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={offersEnabled !== false}
          onClick={() => setValue("offersEnabled", !(offersEnabled !== false), { shouldValidate: true })}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            offersEnabled !== false ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              offersEnabled !== false ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* ── Rental details + live fee note ─────────────────────── */}
      {listingType !== "sale" && (
        <div className="p-4 border rounded-lg bg-accent/5 space-y-4">
          <h4 className="font-medium text-accent">Rental Details</h4>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Daily Rate (₦)</Label>
              <Input
                type="number"
                {...register("priceRentDaily", { setValueAs: optionalNumber })}
                onBlur={updateDeposit}
              />
              {/* Live fee note for rental */}
              <PriceFeeNote priceNaira={Number(priceRent) || 0} type="rental" />
            </div>
            <div className="space-y-2">
              <Label>Weekly Rate (₦)</Label>
              <Input type="number" {...register("priceRentWeekly", { setValueAs: optionalNumber })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Security Deposit (₦) — Auto: 30%</Label>
            <Input type="number" {...register("depositAmount", { setValueAs: optionalNumber })} />
          </div>
        </div>
      )}
    </div>
  )
}
