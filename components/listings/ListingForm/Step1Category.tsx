"use client"
import { useFormContext, Controller } from "react-hook-form"
import { ALL_CATEGORIES, getCategoryBySlug } from "@/constants/categories"
import { getRentRule } from "@/constants/rentRules"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertTriangle } from "lucide-react"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"

export function Step1Category() {
  const { control, watch, formState: { errors } } = useFormContext()
  const { settings } = usePlatformSettings()
  const category = watch("categorySlug")
  const rule = category ? getRentRule(category) : null

  const handleListingTypeChange = (val: string, field: { onChange: (v: string) => void }) => {
    if (!settings.rentalsEnabled && (val === "rent" || val === "both")) {
      field.onChange("sale")
      return
    }
    if (rule && !rule.allowsRent && (val === "rent" || val === "both")) {
      field.onChange("sale")
      return
    }
    field.onChange(val)
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="space-y-2">
        <Label>Select Category</Label>
        <Controller
          name="categorySlug"
          control={control}
          render={({ field }) => (
            <Select onValueChange={field.onChange} value={field.value}>
              <SelectTrigger><SelectValue placeholder="Choose category" /></SelectTrigger>
              <SelectContent>
                {ALL_CATEGORIES.map(cat => (
                  <SelectItem key={cat.slug} value={cat.slug}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.categorySlug && <p className="text-sm text-destructive">{String(errors.categorySlug.message)}</p>}
      </div>

      {category && (
        <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
          <Label>Listing Type</Label>
          <Controller
            name="listingType"
            control={control}
            render={({ field }) => (
              <RadioGroup value={field.value} onValueChange={(val) => handleListingTypeChange(val, field)} className="flex gap-4">
                <div className="flex items-center gap-2"><RadioGroupItem value="sale" id="sale" /><Label htmlFor="sale">Sell</Label></div>
                {settings.rentalsEnabled && (
                  <>
                    <div className="flex items-center gap-2"><RadioGroupItem value="rent" id="rent" disabled={!rule?.allowsRent} /><Label htmlFor="rent" className={!rule?.allowsRent ? "text-muted-foreground line-through" : ""}>Rent</Label></div>
                    <div className="flex items-center gap-2"><RadioGroupItem value="both" id="both" disabled={!rule?.allowsRent} /><Label htmlFor="both" className={!rule?.allowsRent ? "text-muted-foreground line-through" : ""}>Both</Label></div>
                  </>
                )}
              </RadioGroup>
            )}
          />
          {rule && !rule.allowsRent && (
            <Alert variant="destructive" className="mt-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Renting is not allowed for {getCategoryBySlug(category)?.name} on Zamorax.</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  )
}
