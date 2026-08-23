"use client"

import { AdminService, limit, serverTimestamp } from "@/src/services"
import { getPlatformSettings } from "@/src/services/platformSettings"
import { ShippingService } from "@/src/services/shipping"

import { useState, useCallback, useEffect, useRef } from "react"
import { useForm, FormProvider } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { listingSchema, type ListingFormValues } from "@/lib/validations/listing"
import { useAuth } from "@/hooks/useAuth"
import { useSubSettings } from "@/hooks/useSubSettings"
import { useToast } from "@/components/ui/use-toast"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Loader2, ArrowLeft, ArrowRight, X } from "lucide-react"
import { generateSlug } from "@/lib/utils"
import { saveDraft, loadDraft, clearDraft } from "@/lib/formDraft"

import { Step1Category }    from "./Step1Category"
import { Step2Details }     from "./Step2Details"
import { Step3Attributes }  from "./Step3Attributes"
import { Step4Media }       from "./Step4Media"
import { Step5Location }    from "./Step5Location"
import { Step5bShipment }   from "./Step5bShipment"
import { Step6Coupon }      from "./Step6Coupon"
import { Step6Boost }       from "./Step6Boost"
import { Step7Review }      from "./Step7Review"

const BASE_STEPS = ["Category", "Details", "Attributes", "Media", "Location", "Delivery", "Coupon", "Boost", "Review"]
const STEPS_NO_COUPON = BASE_STEPS.filter(s => s !== "Coupon")

export function ListingForm() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const { user } = useAuth()
  const { toast } = useToast()
  const { settings: subSettings } = useSubSettings()

  const couponsOn = subSettings.couponsEnabled
  const steps = couponsOn ? BASE_STEPS : STEPS_NO_COUPON

  // Step numbers shift depending on whether the Coupon step is shown.
  // With coupons: 1 Category 2 Details 3 Attributes 4 Media 5 Location
  //   6 Delivery 7 Coupon 8 Boost 9 Review
  // Without: same but Coupon removed, Boost/Review shift down by one.
  const couponStepNum = 7
  const boostStepNum  = couponsOn ? 8 : 7
  const reviewStepNum = couponsOn ? 9 : 8

  const form = useForm<ListingFormValues>({
    resolver: zodResolver(listingSchema),
    mode: "onChange",
    defaultValues: {
      listingType: "sale",
      condition: "brand_new",
      deliveryNationwide: false,
      weightKg: 0.5,
      isFragile: false,
      shippingMethods: ["meetup"],
      couponEnabled: false,
      boostType: "none",
      // FIX: was defaulting to true, meaning sellers were silently
      // "pre-agreed" to the listing rules before ever seeing the checkbox.
      // That also caused the confusing checked/unchecked mismatch seen
      // across review-step screenshots — it started checked by default,
      // then flipped false the moment it was tapped (normal toggle
      // behavior), which looked like a bug but was actually the true state
      // finally being reflected correctly after the Controller fix.
      acceptTerms: false as unknown as true,
      offersEnabled: true,
      unitOfSale: "piece",
    }
  })

  // ── Local draft (survives browser reload / crash / accidental nav) ──────
  // Keyed per-user so one device's drafts don't leak across accounts.
  const draftKey = user?.uid ? `listing_form_${user.uid}` : null
  const [draftRestored, setDraftRestored] = useState(false)
  const draftLoadedRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore once, as soon as we know who the user is.
  useEffect(() => {
    if (!draftKey || draftLoadedRef.current) return
    draftLoadedRef.current = true
    const draft = loadDraft<{ values: ListingFormValues; step: number }>(draftKey)
    if (draft?.values) {
      form.reset(draft.values)
      if (draft.step) setStep(draft.step)
      setDraftRestored(true)
    }
  }, [draftKey, form])

  // Autosave on every change, debounced so a reload never loses more than
  // a second or two of typing without hammering localStorage on every
  // keystroke.
  useEffect(() => {
    if (!draftKey) return
    const subscription = form.watch((values) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveDraft(draftKey, { values, step })
      }, 600)
    })
    return () => subscription.unsubscribe()
  }, [draftKey, form, step])

  // Step changes should also persist immediately (watch() above only fires
  // on field changes, not on setStep), so a reload lands back on the same
  // step instead of Step 1.
  useEffect(() => {
    if (!draftKey || !draftLoadedRef.current) return
    saveDraft(draftKey, { values: form.getValues(), step })
  }, [draftKey, step])

  const clearListingDraft = () => {
    if (draftKey) clearDraft(draftKey)
    setDraftRestored(false)
  }

  const categorySlug = form.watch("categorySlug")

  const handleNext = async () => {
    if (step === 6) {
      const current = form.getValues("shippingMethods") ?? []
      if (current.length === 0) {
        form.setValue("shippingMethods", ["meetup"], { shouldValidate: true })
      }
    }

    const fieldsToValidate: Record<number, string[]> = {
      1: ["categorySlug", "listingType"],
      2: ["title", "description", "condition", "priceSale"],
      3: [],
      4: ["images"],
      5: ["nigerianState", "city"],
      6: ["shippingMethods", "fbzWarehouseId", "fbzQuantity"],
      [boostStepNum]: ["boostType"],
      [reviewStepNum]: ["acceptTerms"],
    }
    if (couponsOn) {
      fieldsToValidate[couponStepNum] = ["couponCode", "couponDiscountPercent"]
    }

    const isValid = await form.trigger(fieldsToValidate[step] as any)
    if (!isValid) return

    if (step < steps.length) setStep(step + 1)
  }

  const onSubmit = useCallback(async (data: ListingFormValues) => {
    if (!user?.uid) return
    setLoading(true)
    try {
      // Check plan limit
      const userDoc = await AdminService.getDoc("users", user.uid)
      const plan = userDoc?.plan || "free"
      const activeCount = userDoc?.activeListingCount || 0
      const platformSettings = await getPlatformSettings()
      const limits: Record<string, number> = {
        free:    platformSettings.planFreeListingLimit ?? 5,
        starter: platformSettings.planStarterListingLimit ?? 20,
        pro:     platformSettings.planProListingLimit > 0 ? platformSettings.planProListingLimit : 999,
      }
      if (activeCount >= limits[plan]) {
        toast({ title: "Limit Reached", description: `Upgrade to ${plan === "free" ? "Starter" : "Pro"} to post more.`, variant: "destructive" })
        return
      }

      const listingId = AdminService.generateId()
      const slug      = generateSlug(data.title)

      // Convert prices to kobo
      const priceSaleKobo      = data.priceSale * 100
      const priceRentDayKobo   = data.priceRentDaily   ? data.priceRentDaily   * 100 : null
      const priceRentWeekKobo  = data.priceRentWeekly  ? data.priceRentWeekly  * 100 : null
      const depositAmountKobo  = data.depositAmount    ? data.depositAmount    * 100 : null

      // Bulk pricing tiers → kobo, drop any incomplete rows (e.g. user added
      // a tier row but didn't fill it in before submitting)
      const bulkPricingKobo = (data.bulkPricing ?? [])
        .filter(t => t && t.minQty != null && t.price != null)
        .map(t => ({ minQty: t.minQty, price: t.price * 100 }))

      const shippingMethods = (data.shippingMethods && data.shippingMethods.length > 0)
        ? data.shippingMethods
        : ["meetup"]
      const isFbzChosen = shippingMethods.includes("fbz")

      // Used/graded items (grade_a, grade_b, open_box) are implicitly
      // one-of-a-kind unless the seller explicitly says otherwise — a
      // used HP laptop can't actually be "in stock: 10". Brand-new items
      // genuinely can be unlimited/untracked (the null default), so this
      // only applies to the used-condition tiers. This is also what
      // makes the cart's per-item quantity cap actually bite for these
      // listings — leaving stockQty null lets a buyer add 10 of a
      // single physical used item to their cart.
      const isUsedCondition = data.condition === "grade_a" || data.condition === "grade_b" || data.condition === "open_box"
      const stockQty = (data.stockQty != null && !isNaN(data.stockQty))
        ? Math.max(0, Math.floor(data.stockQty))
        : (isUsedCondition ? 1 : null)

      // FIX: use exact D1 column names so addDoc/setDoc auto-converter doesn't
      // produce wrong snake_case (e.g. categorySlug → category_slug which doesn't exist)
      await AdminService.setDoc("listings", listingId, {
        id:                   listingId,
        seller_id:            user.uid,
        seller_name:          user.fullName || user.email || null,
        seller_state:         data.nigerianState ?? null,
        title:                data.title,
        slug:                 slug,
        searchable_title:     data.title.toLowerCase(),
        description:          data.description ?? null,
        category:             data.categorySlug ?? null,
        listing_type:         data.listingType ?? "sale",
        condition:            data.condition ?? "brand_new",
        price:                priceSaleKobo,
        price_rent_day:       priceRentDayKobo,
        price_rent_week:      priceRentWeekKobo,
        deposit_amount:       depositAmountKobo,
        images:               JSON.stringify(data.images ?? []),
        attributes:           JSON.stringify(data.attributes ?? {}),
        verification_video:   data.verificationVideo || null,
        city:                 data.city ?? null,
        nigerian_state:       data.nigerianState ?? null,
        delivery_nationwide:  data.deliveryNationwide ? 1 : 0,
        weight_kg:            data.weightKg ?? 0.5,
        is_fragile:           data.isFragile ? 1 : 0,
        delivery_options:     JSON.stringify(shippingMethods),
        shipping_methods:     JSON.stringify(shippingMethods),
        estimated_delivery_days: data.estimatedDeliveryDays?.trim() || null,
        stock_qty:            stockQty,
        bulk_pricing:         bulkPricingKobo.length > 0 ? JSON.stringify(bulkPricingKobo) : null,
        min_order_qty:        (data.minOrderQty != null && !isNaN(data.minOrderQty)) ? Math.max(1, Math.floor(data.minOrderQty)) : null,
        unit_of_sale:         data.unitOfSale || "piece",
        // Genuinely opt-out: only false if the seller explicitly toggled off.
        offers_enabled:       data.offersEnabled === false ? 0 : 1,
        low_stock_threshold:  (data.lowStockThreshold != null && !isNaN(data.lowStockThreshold)) ? Math.max(0, Math.floor(data.lowStockThreshold)) : null,
        is_boosted:           data.boostType !== "none" ? 1 : 0,
        boost_type:           data.boostType === "none" ? null : data.boostType,
        ad_boost_status:      null,
        coupon_enabled:       (couponsOn && data.couponEnabled) ? 1 : 0,
        coupon_code:          (couponsOn && data.couponEnabled && data.couponCode) ? data.couponCode.toUpperCase() : null,
        coupon_discount_percent: (couponsOn && data.couponEnabled) ? (data.couponDiscountPercent ?? null) : null,
        status:               isFbzChosen ? "pending_fbz" : "pending",
        views:                0,
        saves:                0,
        inquiries:            0,
        is_hub_verified:      0,
        is_featured:          0,
        vacation_mode:        0,
      })

      // If seller chose FBZ, create the ship-to-warehouse request in the same
      // step — linked to this listing so admin's "receive → activate" flow
      // (see app/(admin)/admin/fbz) can find it. This listing stays hidden
      // from buyers (status: pending_fbz) until BOTH normal content review
      // AND FBZ stock activation are done — see app/api/admin/manage-listings.
      if (isFbzChosen) {
        const shippingConfig = await ShippingService.getConfig()
        const warehouse = shippingConfig.fbzWarehouses.find(w => w.id === data.fbzWarehouseId)
        await AdminService.addDoc("fbzShipments", {
          sellerId:          user.uid,
          sellerName:        user.fullName || user.email || null,
          sellerPhone:       user.phone || null,
          listingId:         listingId,
          listingTitle:      data.title,
          listingImage:      data.images?.[0] || null,
          listingPrice:      priceSaleKobo,
          quantity:          data.fbzQuantity,
          quantityAvailable: 0,
          notes:             data.fbzNotes?.trim() || null,
          status:            "pending",
          warehouseId:       data.fbzWarehouseId,
          warehouseName:     warehouse?.name ?? null,
          warehouseAddress:  null, // not exposed on FBZWarehouseAvailability; admin sees full warehouse row via warehouseId join in /admin/fbz
          warehousePhone:    null,
          warehouseCity:     warehouse?.city ?? null,
          warehouseState:    warehouse?.state ?? null,
        })
      }

      toast({
        title: "Listing Submitted!",
        description: isFbzChosen
          ? "Pending admin approval and FBZ stock confirmation. We'll notify you once your listing is live."
          : "Pending admin approval. We'll notify you shortly.",
        variant: "success",
      })
      form.reset()
      setStep(1)
      clearListingDraft()
    } catch (error: any) {
      console.error("Submit error:", error)
      toast({ title: "Submission Failed", description: error.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [user, form, toast, draftKey])

  return (
    <FormProvider {...form}>
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-heading font-bold">Post a New Listing</h1>
          <p className="text-muted-foreground">Follow the steps to list your item securely.</p>
        </div>

        {draftRestored && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5">
            <p className="text-xs text-primary">
              Picked up where you left off — we restored your unsaved draft.
            </p>
            <button
              type="button"
              onClick={() => {
                form.reset()
                setStep(1)
                clearListingDraft()
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3 w-3" /> Discard draft
            </button>
          </div>
        )}

        <Progress value={(step / steps.length) * 100} className="mb-8" />

        <div className="space-y-8">
          {step === 1 && <Step1Category />}
          {step === 2 && <Step2Details />}
          {step === 3 && <Step3Attributes categorySlug={categorySlug} />}
          {step === 4 && <Step4Media />}
          {step === 5 && <Step5Location />}
          {step === 6 && <Step5bShipment />}
          {couponsOn && step === couponStepNum && <Step6Coupon />}
          {step === boostStepNum && <Step6Boost />}
          {step === reviewStepNum && <Step7Review />}
        </div>

        <div className="flex justify-between mt-8 pt-6 border-t">
          <Button variant="outline" onClick={() => step > 1 && setStep(step - 1)} disabled={step === 1}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          
          {step < steps.length ? (
            <Button onClick={handleNext} disabled={loading}>
              Next <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={form.handleSubmit(onSubmit)} disabled={loading || !form.formState.isValid}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Publish Listing
            </Button>
          )}
        </div>
      </div>
    </FormProvider>
  )
}
