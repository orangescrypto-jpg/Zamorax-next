"use client"
import { useFormContext, Controller } from "react-hook-form"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card } from "@/components/ui/card"
import { formatPrice } from "@/lib/utils"
import { getCategoryBySlug } from "@/constants/categories"
import { useFeeSettings } from "@/hooks/useFeeSettings"

export function Step7Review() {
  const { watch, control, formState: { errors } } = useFormContext()
  const { fees } = useFeeSettings()
  const form = watch()
  const category = getCategoryBySlug(form.categorySlug)

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <h3 className="text-lg font-semibold">Review & Publish</h3>
      
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground uppercase">Title</p><p className="font-medium">{form.title}</p>
          <p className="text-xs text-muted-foreground uppercase">Category</p><p>{category?.name || form.categorySlug}</p>
          <p className="text-xs text-muted-foreground uppercase">Condition</p><p className="capitalize">{form.condition?.replace("_", " ")}</p>
        </Card>
        <Card className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground uppercase">Sale Price</p><p className="font-bold text-primary">{formatPrice(form.priceSale * 100)}</p>
          {form.listingType !== "sale" && <p className="text-xs text-muted-foreground">Rent: {formatPrice(form.priceRentDaily * 100)}/day</p>}
          <p className="text-xs text-muted-foreground uppercase">Location</p><p>{form.city}, {form.nigerianState}</p>
        </Card>
      </div>

      <div className="flex items-start gap-3 p-4 border rounded-lg bg-accent/10">
        {/* FIX: Checkbox is a Radix button under the hood, not a native
            <input>, so register() never captures its checked state —
            acceptTerms stayed undefined forever and silently blocked
            Publish with no visible error. Controller wires onCheckedChange
            to the form value directly, the correct pattern for non-native
            inputs with react-hook-form. */}
        <Controller
          name="acceptTerms"
          control={control}
          render={({ field }) => (
            <Checkbox
              id="terms"
              checked={!!field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          )}
        />
        <div>
          <Label htmlFor="terms" className="font-medium cursor-pointer">I agree to Zamorax Seller Rules</Label>
          <p className="text-sm text-muted-foreground mt-1">
            • Photos & videos must be real and taken by me.<br/>
            • Item matches description & condition exactly.<br/>
            • I understand {fees.commissionSale.toFixed(1)}% sales / {fees.commissionRental.toFixed(1)}% rental commission applies.<br/>
            • Disputes will be resolved via Zamorax Escrow.
          </p>
        </div>
      </div>
      {errors.acceptTerms && <p className="text-sm text-destructive">{String(errors.acceptTerms.message)}</p>}
    </div>
  )
}
