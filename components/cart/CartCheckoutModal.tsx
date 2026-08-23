"use client"

// components/cart/CartCheckoutModal.tsx
// Multi-step checkout for cart orders (Step 1: Address, Step 2: Delivery per seller, Step 3: Review & Pay)

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Loader2, X, MapPin, Truck, ShoppingCart, CheckCircle, ChevronRight, ChevronLeft, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"
import { useFeeSettings } from "@/hooks/useFeeSettings"
import { calculateFees } from "@/src/services/feeSettings"
import { useCartItemsStore } from "@/store/cartStore"
import { AdminService, serverTimestamp, ShippingService, LogisticsService } from "@/src/services"
import { ManualPaymentInstructions } from "@/components/payment/ManualPaymentInstructions"
import { usePaymentMethods } from "@/hooks/usePaymentMethods"

// Single source of truth for this checkout flow's payment purpose — used
// both in the pending_payments write and the escrow gate below, so the two
// can't silently drift apart if this file is edited later.
const CART_PAYMENT_PURPOSE = "cart_order"
import { useLastAddress } from "@/hooks/useLastAddress"
import { PaymentMethodPicker } from "@/components/payment/PaymentMethodPicker"
import { formatPrice } from "@/lib/utils"
import { nigerianStates } from "@/constants/nigerianStates"
import type { CartItem, DeliveryMethod } from "@/src/types"
import type { BankDetails } from "@/src/types/payment"

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

interface DeliverySelection {
  method: DeliveryMethod
  fee: number   // kobo
}

const STEP_LABELS = ["Delivery Address", "Delivery Method", "Review & Pay", "Bank Transfer"]

export function CartCheckoutModal({ open, onClose, onSuccess }: Props) {
  const { user } = useAuth()
  const { settings } = usePlatformSettings()
  const { fees }     = useFeeSettings()
  const router  = useRouter()
  const { toast } = useToast()
  const { cartItems, getCartGrouped, getCartTotal, clearCart } = useCartItemsStore()

  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Which methods the admin has enabled. 2+ enabled -> buyer picks one on
  // the review step via <PaymentMethodPicker>. 1 enabled -> auto-selected.
  // A cart can mix Zamorax Enterprises Direct items with third-party seller
  // items under one shared payment step — if ANY item is third-party, this
  // checkout counts as "marketplace" so paystackEnabledForMarketplace
  // applies. An all-official-seller cart stays on "platform" context,
  // unaffected by that toggle.
  const hasThirdPartySeller = cartItems.some(item => !item.sellerIsOfficial)
  const { methods: paymentMethods, selected: selectedMethod, selectedId: selectedProvider, setSelectedId: setSelectedProvider, showPicker } =
    usePaymentMethods(settings, hasThirdPartySeller ? "marketplace" : "platform")

  // Populated after order placed (manual payment)
  const [pendingRef,         setPendingRef]         = useState<string | null>(null)
  const [pendingBankDetails, setPendingBankDetails] = useState<BankDetails | null>(null)
  const [pendingTotal,       setPendingTotal]       = useState<number>(0)

  // Step 1 — Address
  const [street, setStreet] = useState("")
  const [city,   setCity]   = useState("")
  const [state,  setState]  = useState("")
  const [lga,    setLga]    = useState("")

  // Single last-used address, auto-overwritten on each successful order.
  // Shared with BuyNowModal via the same hook — prefills the address step
  // for returning buyers, fields stay fully editable.
  const { lastAddress, saveLastAddress } = useLastAddress(user?.uid)
  useEffect(() => {
    if (!open || !lastAddress) return
    setStreet(prev => prev || lastAddress.street)
    setCity(prev   => prev || lastAddress.city)
    setState(prev  => prev || lastAddress.state)
    setLga(prev    => prev || lastAddress.lga)
  }, [open, lastAddress])

  // Step 2 — Delivery per seller
  const [deliverySelections, setDeliverySelections] = useState<Record<string, DeliverySelection>>({})
  const [coverageLoading,    setCoverageLoading]    = useState<Record<string, boolean>>({})
  const [sellerZlaCoverage,  setSellerZlaCoverage]  = useState<Record<string, boolean>>({})
  const [sellerZlaFees,      setSellerZlaFees]      = useState<Record<string, number>>({})
  const [sellerFbzFees,      setSellerFbzFees]      = useState<Record<string, number>>({})

  const grouped   = getCartGrouped()
  const sellerIds = Object.keys(grouped)

  // Load ZLA coverage + fee for each seller after buyer state is set
  useEffect(() => {
    if (!state || step !== 2) return

    sellerIds.forEach(async (sellerId) => {
      const items       = grouped[sellerId]
      const sellerState = items[0].sellerState

      setCoverageLoading(prev => ({ ...prev, [sellerId]: true }))
      try {
        const coverage = await ShippingService.getCoverageForStates(sellerState, state)
        setSellerZlaCoverage(prev => ({ ...prev, [sellerId]: coverage.bothCovered }))

        if (coverage.bothCovered) {
          // Same override rule as FBZ below: if every item in this group
          // carries a manual delivery_fee_override_kobo (e.g. 0 for free
          // delivery, set by admin on FBZ / Zamorax Direct / official-seller
          // listings), sum those instead of live zone pricing — the
          // override wins outright regardless of delivery method chosen.
          if (items.every(i => i.deliveryFeeOverrideKobo != null)) {
            const total = items.reduce((sum, i) => sum + (i.deliveryFeeOverrideKobo ?? 0), 0)
            setSellerZlaFees(prev => ({ ...prev, [sellerId]: total }))
          } else {
            const totalWeight  = items.reduce((sum, i) => sum + ((i.weightKg ?? 0.5) * i.quantity), 0)
            const hasFragile   = items.some(i => i.isFragile)
            const pricing      = await LogisticsService.getPricing()
            const feeBreakdown = LogisticsService.calculateFee(sellerState, state, pricing, { weightKg: totalWeight, isFragile: hasFragile })
            const fee: number  = feeBreakdown.total
            setSellerZlaFees(prev => ({ ...prev, [sellerId]: fee }))
          }
        }
      } catch {
        setSellerZlaCoverage(prev => ({ ...prev, [sellerId]: false }))
      } finally {
        setCoverageLoading(prev => ({ ...prev, [sellerId]: false }))
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, step])

  // FBZ Express fee — same zone-based LogisticsService pricing engine as
  // ZLA above, but "from" is the state of the nearest active FBZ warehouse
  // (the actual dispatch point), not the seller's own state — the seller
  // isn't shipping it, Zamorax is, from wherever the stock physically sits.
  useEffect(() => {
    if (!state || step !== 2) return

    sellerIds.forEach(async (sellerId) => {
      const items = grouped[sellerId]
      if (!items.every(i => i.isFBZ)) return
      // If every item in this group has a matching manual override (e.g.
      // 0 for free delivery), skip live pricing and use it directly —
      // sum the per-item overrides rather than calling the pricing API.
      if (items.every(i => i.deliveryFeeOverrideKobo != null)) {
        const total = items.reduce((sum, i) => sum + (i.deliveryFeeOverrideKobo ?? 0), 0)
        setSellerFbzFees(prev => ({ ...prev, [sellerId]: total }))
        return
      }

      try {
        const { fbzWarehouses } = await ShippingService.getConfig()
        const active = fbzWarehouses.filter(w => w.isActive)
        if (!active.length) return

        // Prefer a warehouse already in the buyer's state (cheapest/fastest
        // — same_state pricing), else fall back to the first active one.
        const warehouse   = active.find(w => w.state === state) ?? active[0]
        const totalWeight = items.reduce((sum, i) => sum + ((i.weightKg ?? 0.5) * i.quantity), 0)
        const hasFragile  = items.some(i => i.isFragile)
        const pricing      = await LogisticsService.getPricing()
        const feeBreakdown = LogisticsService.calculateFee(warehouse.state, state, pricing, { weightKg: totalWeight, isFragile: hasFragile })
        setSellerFbzFees(prev => ({ ...prev, [sellerId]: feeBreakdown.total }))
      } catch {
        // Leave fee unset — DeliveryOption below falls back to 0 rather
        // than silently blocking checkout on a pricing-fetch failure.
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, step])

  // Auto-select a sensible default delivery method per seller group.
  // FIX: this always defaulted every group to "meetup" regardless of
  // what that seller's listings actually offer — on an FBZ-only group
  // (shippingMethods === ["fbz"], meetup not rendered at all per the
  // methods.includes("meetup") check below), that left the group with no
  // delivery option actually selected/highlighted even though only one
  // was shown, and let a buyer proceed with deliverySelections silently
  // defaulted to a method the seller never offered. Pick the group's
  // first genuinely available method instead of hardcoding meetup.
  useEffect(() => {
    if (step !== 2) return
    const defaults: Record<string, DeliverySelection> = {}
    sellerIds.forEach(sid => {
      if (deliverySelections[sid]) return
      const items = grouped[sid]
      const methods = items[0]?.shippingMethods ?? ["meetup"]
      const allItemsFBZ = items.every(i => i.isFBZ)
      // Prefer whatever non-meetup method the seller actually chose and is
      // currently usable, before falling back to meetup — a legacy listing
      // saved with more than one method (e.g. ["meetup","fbz"] from before
      // shipping method became single-select) should still default to the
      // seller's real premium choice, not silently settle on meetup just
      // because it happens to be first in the array.
      if (methods.includes("fbz") && allItemsFBZ && settings.fbzEnabled) {
        defaults[sid] = { method: "fbz", fee: sellerFbzFees[sid] ?? 0 }
      } else if (methods.includes("zamorax_logistics") && (sellerZlaCoverage[sid] ?? false)) {
        defaults[sid] = { method: "zamorax_logistics", fee: sellerZlaFees[sid] ?? 0 }
      } else if (methods.includes("meetup")) {
        defaults[sid] = { method: "meetup", fee: 0 }
      } else {
        defaults[sid] = { method: "meetup", fee: 0 }
      }
    })
    if (Object.keys(defaults).length > 0) {
      setDeliverySelections(prev => ({ ...prev, ...defaults }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, grouped, sellerFbzFees, sellerZlaFees, sellerZlaCoverage])

  const handleStep1Next = () => {
    if (!street.trim() || !city.trim() || !state || !lga.trim()) {
      toast({ title: "Fill in all delivery fields", variant: "destructive" })
      return
    }
    saveLastAddress({ street: street.trim(), city: city.trim(), state, lga: lga.trim() })
    setStep(2)
  }

  const handleStep2Next = () => {
    const allSelected = sellerIds.every(sid => deliverySelections[sid])
    if (!allSelected) {
      toast({ title: "Select delivery method for each seller", variant: "destructive" })
      return
    }
    setStep(3)
  }

  const grandTotal = useCallback(() => {
    const itemsTotal    = getCartTotal()
    const deliveryTotal = Object.values(deliverySelections).reduce((sum, s) => sum + s.fee, 0)
    const buyerFee      = fees.buyerFeeEnabled ? fees.buyerConvenienceFee : 0
    return itemsTotal + deliveryTotal + buyerFee
  }, [getCartTotal, deliverySelections, fees])

  const handleSubmit = async () => {
    if (!user?.uid) {
      toast({
        title: "Please log in again",
        description: "Your session may have expired. Log out and back in, then retry.",
        variant: "destructive",
      })
      return
    }
    if (!selectedProvider) {
      toast({ title: "Choose a payment method", variant: "destructive" })
      return
    }
    setSubmitting(true)

    try {
      // FIX: was reading settings.commissionSale from usePlatformSettings(),
      // a legacy/unused config doc that stores the rate as a decimal
      // (0.015) while this code treated it as a whole-number percent,
      // and falls back to a hardcoded 5% when unset — completely
      // disconnected from the real admin-configured rate at /admin/fees.
      // calculateFees() (same helper BuyNowModal uses) reads the correct,
      // live-updating fees.commissionSale from useFeeSettings() instead.
      const capturedTotal = grandTotal()

      // Build cart items payload (matches what cart/confirm route expects)
      const cartPayload = sellerIds.map(sellerId => {
        const items    = grouped[sellerId]
        const delivery = deliverySelections[sellerId] ?? { method: "meetup", fee: 0 }
        const subtotal = items.reduce((sum, i) => sum + (i.agreedPrice ?? i.priceSale) * i.quantity, 0)
        const breakdown = calculateFees(subtotal, "sale", fees)
        const platformFee  = breakdown.commissionKobo
        const sellerPayout = breakdown.sellerPayoutKobo

        return {
          sellerId,
          sellerName:    items[0].sellerName,
          sellerState:   items[0].sellerState,
          lineItems:     items.map(i => ({
            listingId:   i.listingId,
            title:       i.listingTitle,
            qty:         i.quantity,
            unitPrice:   i.priceSale,
            agreedPrice: i.agreedPrice,
            offerId:     i.offerId ?? null,
            couponCode:  i.couponCode ?? null,
            selectedColor: i.selectedColor ?? null,
            selectedSize:  i.selectedSize ?? null,
          })),
          deliveryMethod: delivery.method,
          deliveryFee:    delivery.fee,
          subtotal,
          platformFee,
          sellerPayout,
        }
      })

      // Generate reference
      const reference = `ZMX-CART-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`

      // Fetch bank details (for manual provider)
      let bankDetails: BankDetails | null = null
      try {
        const bdRes = await fetch("/api/payment/bank-details", { cache: "no-store" })
        if (bdRes.ok) bankDetails = (await bdRes.json()).bankDetails ?? null
      } catch { /* non-fatal */ }

      // Write ONE doc to pending_payments — only real schema columns at top
      // level; everything else goes into metadata (matches manual payment provider).
      await AdminService.addDoc("pending_payments", {
        purpose:         CART_PAYMENT_PURPOSE,
        reference,
        provider:        selectedMethod?.provider ?? "manual",
        amount:          capturedTotal,
        userId:          user.uid,
        status:          "awaiting_transfer",
        adminConfirmed:  false,
        metadata: JSON.stringify({
          buyerName:           user.fullName || user.email,
          buyerEmail:          user.email,
          buyerState:          state,
          deliveryStreet:      street,
          deliveryCity:        city,
          deliveryState:       state,
          deliveryLga:         lga,
          cartItems:           cartPayload,
          buyerConvenienceFee: fees.buyerFeeEnabled ? fees.buyerConvenienceFee : 0,
        }),
      })

      clearCart()

      // Redirect providers — send buyer to Paystack or Flutterwave
      if (selectedMethod?.provider === "paystack" || selectedMethod?.provider === "flutterwave") {
        const initRes = await fetch("/api/payment/initialize", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            provider:    selectedMethod.provider,
            amount:      capturedTotal,
            email:       user.email,
            reference,
            metadata:    { purpose: CART_PAYMENT_PURPOSE },
            callbackUrl: `${window.location.origin}/dashboard/buyer/orders`,
            channel:     selectedMethod.paystackChannel,
            // Cart orders can span multiple sellers, so no single
            // subaccount is passed here — the commission split (if any)
            // happens per-seller when escrow is released, not at collection.
            // Escrow only makes sense for real purchases — gated on purpose
            // (always "cart_order" here), not just provider, so this can't
            // accidentally escrow-flag a non-purchase payment if this modal
            // is ever reused for something else (matches the
            // purpose === "order" gate in
            // src/services/providers/flutterwave/payment.ts).
            escrow:      selectedMethod.provider === "flutterwave" && CART_PAYMENT_PURPOSE === "cart_order",
          }),
        })
        const initData = await initRes.json()
        if (initData.redirectUrl) {
          // Do NOT create order rows here — payment hasn't happened yet.
          // create-pending-orders now verifies the reference server-side
          // (against whichever gateway `provider` in pending_payments says)
          // before writing anything, so calling it this early would just
          // fail. Stash the reference so the orders page can call
          // create-pending-orders itself once the buyer lands back with a
          // completed transaction.
          try {
            sessionStorage.setItem(`pending_cart_ref_${reference}`, reference)
          } catch { /* sessionStorage unavailable — reference param on return URL is the fallback */ }
          window.location.href = initData.redirectUrl
          return
        }
      }

      // Manual provider — show bank transfer instructions inside the modal
      setPendingTotal(capturedTotal)
      setPendingRef(reference)
      setPendingBankDetails(bankDetails)
      setStep(4)
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    if (step === 4) { setStep(1); setPendingRef(null); setPendingBankDetails(null); setPendingTotal(0); setSubmitted(false) }
    return null
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[170] bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center z-[180]">
        <div className="bg-background rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div>
              <h2 className="font-semibold text-foreground">Checkout</h2>
              <p className="text-xs text-muted-foreground">Step {step} of {STEP_LABELS.length}: {STEP_LABELS[step - 1]}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-muted">
            <div
              className="h-1 bg-primary transition-all duration-300"
              style={{ width: `${(step / STEP_LABELS.length) * 100}%` }}
            />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

            {/* ── Step 1: Address ───────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <MapPin className="h-4 w-4 text-primary" /> Delivery Address
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Street Address</Label>
                    <Input
                      value={street}
                      onChange={e => setStreet(e.target.value)}
                      placeholder="e.g. 12 Adeola Odeku Street"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <Label className="text-xs">City</Label>
                      <Input value={city} onChange={e => setCity(e.target.value)} placeholder="Lagos Island" />
                    </div>
                    <div className="space-y-1.5 min-w-0">
                      <Label className="text-xs">LGA</Label>
                      <Input value={lga} onChange={e => setLga(e.target.value)} placeholder="Eti-Osa" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">State</Label>
                    <select
                      value={state}
                      onChange={e => setState(e.target.value)}
                      className="mt-1 w-full h-10 text-sm border border-input rounded-md px-3 bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="">Select state</option>
                      {nigerianStates.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 2: Delivery method per seller ──────────────────── */}
            {step === 2 && (
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Truck className="h-4 w-4 text-primary" /> Choose Delivery Method
                </div>

                {sellerIds.map(sellerId => {
                  const items        = grouped[sellerId]
                  const sellerName   = items[0].sellerName
                  const methods      = items[0].shippingMethods ?? ["meetup"]
                  // FBZ Express is only offered when EVERY item in this
                  // seller's group is individually FBZ-verified (real stock
                  // held at a Zamorax warehouse, per listing.isFBZ set only
                  // by admin FBZ intake) — not derived from shippingMethods,
                  // which just reflects what the seller opted into and says
                  // nothing about where the stock physically sits. A mixed
                  // cart (some FBZ, some not) can't ship as one FBZ parcel.
                  const allItemsFBZ  = items.every(i => i.isFBZ)
                  const zlaCovered   = sellerZlaCoverage[sellerId] ?? false
                  const zlaFee       = sellerZlaFees[sellerId] ?? 0
                  const coverLoading = coverageLoading[sellerId] ?? false
                  const selected     = deliverySelections[sellerId]

                  return (
                    <div key={sellerId} className="space-y-2 p-3 rounded-xl border border-border bg-muted/30">
                      <p className="text-xs font-semibold text-foreground">{sellerName}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {items.length} item{items.length !== 1 ? "s" : ""} · {formatPrice(items.reduce((s, i) => s + (i.agreedPrice ?? i.priceSale) * i.quantity, 0))}
                      </p>

                      {coverLoading && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Checking coverage...
                        </div>
                      )}

                      <div className="space-y-1.5">
                        {methods.includes("meetup") && (
                          <DeliveryOption
                            label="Physical Meetup"
                            desc="Arrange a safe meet-up location with the seller"
                            fee={0}
                            selected={selected?.method === "meetup"}
                            onSelect={() => setDeliverySelections(prev => ({ ...prev, [sellerId]: { method: "meetup", fee: 0 } }))}
                          />
                        )}
                        {methods.includes("zamorax_logistics") && !coverLoading && (
                          zlaCovered ? (
                            <DeliveryOption
                              label={items.every(i => i.deliveryFeeOverrideKobo === 0) ? "Zamorax Logistics — Free Delivery" : "Zamorax Logistics"}
                              desc="Door-to-door delivery via ZLA agents"
                              fee={zlaFee}
                              selected={selected?.method === "zamorax_logistics"}
                              onSelect={() => setDeliverySelections(prev => ({ ...prev, [sellerId]: { method: "zamorax_logistics", fee: zlaFee } }))}
                            />
                          ) : (
                            <p className="text-[10px] text-muted-foreground italic px-1">ZLA logistics not available for this route</p>
                          )
                        )}
                        {allItemsFBZ && settings.fbzEnabled && (settings.fbzCoveredStates?.length ?? 0) > 0 && (
                          <DeliveryOption
                            label={items.every(i => i.deliveryFeeOverrideKobo === 0) ? "Fulfilled by Zamorax — Free Delivery" : "Fulfilled by Zamorax"}
                            desc="Handled from our warehouse — ships nationwide"
                            fee={sellerFbzFees[sellerId] ?? 0}
                            selected={selected?.method === "fbz"}
                            onSelect={() => setDeliverySelections(prev => ({ ...prev, [sellerId]: { method: "fbz", fee: sellerFbzFees[sellerId] ?? 0 } }))}
                          />
                        )}
                        {/* Seller picked FBZ as their shipping method, but this
                            stock hasn't been admin-activated at a warehouse yet
                            (listing.isFBZ still false) — FBZ Express can't be
                            offered until that happens. Surface why, instead of
                            silently falling back to meetup with no explanation. */}
                        {!allItemsFBZ && methods.includes("fbz") && (
                          <p className="text-[10px] text-muted-foreground italic px-1">
                            Seller selected FBZ Express for this item, but the stock hasn't been confirmed at a Zamorax warehouse yet — only the methods below are available for now.
                          </p>
                        )}
                      </div>

                      {/* Door delivery fee/timing — only when ZamoraxLogic or FBZ
                          is the SELECTED method (not just offered). No pickup
                          station shown: buyers only learn that location by
                          phone once goods arrive in their state. */}
                      {(selected?.method === "zamorax_logistics" || selected?.method === "fbz") && (
                        <div className="rounded-lg border border-border bg-background p-2.5 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground">Door Delivery</span>
                            <span className="text-xs font-semibold">
                              {selected.fee > 0 ? formatPrice(selected.fee) : "Free"}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            Delivered to your address. We'll call you once it arrives in your state.
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Step 3: Review & Pay ──────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle className="h-4 w-4 text-primary" /> Order Summary
                </div>

                <div className="space-y-3">
                  {sellerIds.map(sellerId => {
                    const items    = grouped[sellerId]
                    const delivery = deliverySelections[sellerId] ?? { method: "meetup", fee: 0 }
                    const subtotal = items.reduce((sum, i) => sum + (i.agreedPrice ?? i.priceSale) * i.quantity, 0)

                    return (
                      <div key={sellerId} className="p-3 rounded-xl border border-border space-y-2">
                        <p className="text-xs font-semibold text-foreground">{items[0].sellerName}</p>
                        {items.map((item: any) => (
                          <div key={item.listingId} className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="line-clamp-1 flex-1 pr-2">
                              {item.listingTitle}
                              {(item.selectedColor || item.selectedSize) && (
                                <span className="text-muted-foreground/70"> ({[item.selectedColor, item.selectedSize].filter(Boolean).join(", ")})</span>
                              )}
                              {" "}×{item.quantity}
                              {item.couponCode && (
                                <span className="ml-1.5 inline-flex items-center text-[10px] font-medium text-orange-700 bg-orange-50 border border-orange-100 rounded px-1 py-0.5">
                                  {item.couponCode}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0">
                              {formatPrice((item.agreedPrice ?? item.priceSale) * item.quantity)}
                              {item.agreedPrice != null && (
                                <span className="ml-1 text-green-600 font-medium">✓</span>
                              )}
                            </span>
                          </div>
                        ))}
                        <div className="border-t border-border/50 pt-1.5 flex justify-between text-xs text-muted-foreground">
                          <span>Delivery ({delivery.method.replace(/_/g, " ")})</span>
                          <span>{delivery.fee === 0 ? "Free" : formatPrice(delivery.fee)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="p-3 rounded-xl bg-muted/50 space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Items subtotal</span>
                    <span>{formatPrice(getCartTotal())}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Delivery</span>
                    <span>{formatPrice(Object.values(deliverySelections).reduce((s, d) => s + d.fee, 0))}</span>
                  </div>
                  {fees.buyerFeeEnabled && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>{fees.buyerFeeLabel || "Processing fee"}</span>
                      <span>{formatPrice(fees.buyerConvenienceFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-foreground border-t border-border pt-1.5">
                    <span>Grand Total</span>
                    <span className="text-primary">{formatPrice(grandTotal())}</span>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                  <AlertCircle className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-blue-700">
                    Each item ships within its listed delivery window. Not shipped in time? Contact support for a full refund.
                  </p>
                </div>

                {/* Notice only — third-party (non-Zamorax-Direct) cart
                    orders over 50k are recommended to use manual
                    transfer. Nothing is restricted; buyer can still pick
                    any enabled method below. Mirrors BuyNowModal. */}
                {hasThirdPartySeller && grandTotal() > 50_000 * 100 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                    <p className="text-xs text-amber-800">
                      For orders above ₦50,000 from third-party sellers, we recommend paying via <strong>Bank Transfer (Manual)</strong> for added safety.
                    </p>
                  </div>
                )}

                {/* Method choice — auto-detects how many the admin has
                    enabled. 1 enabled -> just the confirmation line. 2+ ->
                    shared picker. */}
                {showPicker ? (
                  <PaymentMethodPicker
                    methods={paymentMethods}
                    selectedId={selectedProvider}
                    onSelect={setSelectedProvider}
                    name="cartCheckoutPaymentMethod"
                  />
                ) : (
                  <div className="p-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 text-xs text-muted-foreground space-y-0.5">
                    <p className="font-semibold text-foreground">Payment via {selectedMethod?.label ?? "—"}</p>
                    <p>{selectedMethod?.desc}</p>
                  </div>
                )}

                {/* Flutterwave/Paystack dashboards are set to "charge
                    customer" for processing fees, so the amount debited on
                    the customer's card/bank statement is slightly higher
                    than the Grand Total shown above. This is unrelated to
                    fees.buyerConvenienceFee (our own platform fee, already
                    itemized above) — this note is only about the gateway's
                    own cut. Not shown for manual bank transfer, since that
                    path isn't run through the gateway. */}
                {selectedMethod?.provider !== "manual" && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    A small card/transfer processing fee may be added at checkout.
                  </p>
                )}
              </div>
            )}

            {/* ── Step 4: Bank Transfer Instructions ───────────────────── */}
            {step === 4 && pendingRef && !submitted && (
              <ManualPaymentInstructions
                amount={pendingTotal}
                reference={pendingRef}
                bankDetails={pendingBankDetails}
                userId={user?.uid ?? ""}
                purpose="order"
                onConfirmed={async () => {
                  // Create the order rows now (status "pending"), same as BuyNow
                  // does on "I've Paid" — admin confirmation later just upgrades
                  // these to escrow_held instead of creating them from scratch.
                  // FIX: this fetch had no timeout, so if the server call hung
                  // (e.g. multiple sequential D1 writes for a multi-seller cart
                  // taking longer than the browser's default), the button just
                  // spun forever with no fallback to setSubmitted(true).
                  const controller = new AbortController()
                  const timeoutId  = setTimeout(() => controller.abort(), 15000)
                  try {
                    await fetch("/api/cart/create-pending-orders", {
                      method:  "POST",
                      headers: { "Content-Type": "application/json" },
                      body:    JSON.stringify({ reference: pendingRef }),
                      signal:  controller.signal,
                    })
                  } catch (err) {
                    // non-fatal — admin confirm will still create the orders
                    // as a fallback, but log so this is visible if it recurs.
                    console.error("create-pending-orders failed/timed out:", err)
                  } finally {
                    clearTimeout(timeoutId)
                  }
                  setSubmitted(true)
                }}
              />
            )}

            {/* ── Step 5: Awaiting admin confirmation ──────────────────── */}
            {step === 4 && submitted && (
              <div className="flex flex-col items-center text-center gap-3 py-8">
                <CheckCircle className="h-12 w-12 text-emerald-500" />
                <h3 className="font-semibold text-lg">Payment Submitted!</h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  We've received your proof of payment. Your order will be created and activated
                  once our admin team confirms your transfer — usually within a few hours.
                </p>
                <p className="text-xs text-muted-foreground">
                  Reference: <span className="font-mono">{pendingRef}</span>
                </p>
                <Button
                  className="mt-2 w-full"
                  onClick={() => {
                    onSuccess()
                    router.push(`/dashboard/buyer/orders`)
                    onClose()
                  }}
                >
                  Got it — View My Orders
                </Button>
              </div>
            )}
          </div>

          {/* Footer actions */}
          {step < 4 && (
          <div className="border-t border-border px-5 py-4 flex gap-3 shrink-0">
            {step > 1 && (
              <Button
                variant="outline"
                className="flex-1 h-11"
                onClick={() => setStep(s => s - 1)}
                disabled={submitting}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}

            {step === 1 && (
              <Button className="flex-1 h-11" onClick={handleStep1Next}>
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === 2 && (
              <Button className="flex-1 h-11" onClick={handleStep2Next}>
                Review Order <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === 3 && (
              <Button
                className="flex-1 h-11 bg-primary text-primary-foreground"
                onClick={handleSubmit}
                disabled={submitting || !selectedProvider}
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Placing Order...</>
                ) : (
                  "Continue to Payment"
                )}
              </Button>
            )}
          </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Helper: single delivery option row ──────────────────────────────────────
function DeliveryOption({
  label, desc, fee, selected, onSelect
}: {
  label: string; desc: string; fee: number
  selected: boolean; onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/40 hover:bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${selected ? "border-primary bg-primary" : "border-muted-foreground"}`}>
          {selected && <div className="w-full h-full rounded-full bg-white scale-[0.45]" />}
        </div>
        <div>
          <p className="text-xs font-medium text-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground">{desc}</p>
        </div>
      </div>
      <span className="text-xs font-semibold text-primary shrink-0 ml-2">
        {fee === 0 ? "Free" : formatPrice(fee)}
      </span>
    </button>
  )
}
