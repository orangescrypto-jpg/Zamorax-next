"use client"
// components/listings/BuyNowModal.tsx
// Buy Now modal — compact Jumia-style layout.
// Small header, item row, then step content. Sticky action buttons at bottom.

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/components/ui/use-toast"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"
import { useFeeSettings } from "@/hooks/useFeeSettings"
import { calculateFees } from "@/src/services/feeSettings"
import { OrdersService, OffersService } from "@/src/services"
import { ManualPaymentService, PaystackPaymentService, FlutterwavePaymentService } from "@/src/services/payment"
import { usePaymentMethods } from "@/hooks/usePaymentMethods"
import { useLastAddress } from "@/hooks/useLastAddress"
import { PaymentMethodPicker } from "@/components/payment/PaymentMethodPicker"
import { ManualPaymentInstructions } from "@/components/payment/ManualPaymentInstructions"
import type { BankDetails } from "@/src/types/payment"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  ShieldCheck, Loader2, MapPin, CreditCard,
  Truck, Package, AlertCircle,
} from "lucide-react"
import { formatPrice } from "@/lib/utils"

const NG_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
  "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
  "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba",
  "Yobe","Zamfara",
]

interface Props {
  open: boolean
  onClose: () => void
  listing: {
    id: string
    title: string
    priceSale: number
    images?: string[]
    sellerId: string
    sellerName?: string
    sellerStoreName?: string
    nigerianState?: string
  }
  // Quantity the buyer selected on the listing page (bulk-pricing tiles or
  // the +/- stepper). listing.priceSale is treated as the PER-UNIT price
  // for that quantity UNLESS resolvedTotal is passed (see below).
  // Defaults to 1 for any caller that doesn't pass it, preserving old
  // single-unit behavior.
  quantity?: number
  // Exact TOTAL to charge for `quantity` units, when the caller has already
  // resolved bulk-tier pricing (see resolveBulkPrice in lib/utils). At an
  // exact tier this is a flat bundle price, not necessarily quantity ×
  // (some per-unit rate) — passing it directly avoids the modal re-deriving
  // a unit price and multiplying it back out, which can drift by a few
  // kobo whenever a tier's total doesn't divide evenly by its minQty.
  // Ignored when an accepted offer applies (offer total always wins).
  resolvedTotal?: number
  // Fashion variant the buyer picked on the listing page, if the listing
  // had more than one color/size option (see ListingDetailClient's variant
  // picker). Carried into the order so the seller knows what to ship.
  selectedColor?: string | null
  selectedSize?: string | null
  seller?: {
    fullName?: string
    storeName?: string
    isOfficial?: boolean
  } | null
}

export function BuyNowModal({ open, onClose, listing, seller, quantity = 1, resolvedTotal, selectedColor, selectedSize }: Props) {
  const { user }     = useAuth()
  const router       = useRouter()
  const { toast }    = useToast()
  const { settings } = usePlatformSettings()
  const { fees }     = useFeeSettings()

  const [step,    setStep]    = useState<"address" | "review" | "payment" | "bank_details">("address")
  const [loading, setLoading] = useState(false)

  // Which methods the admin has enabled (manual / card / bank-online).
  // If 2+ are enabled, the buyer picks one on the Payment step via
  // <PaymentMethodPicker>. If only one is on, it's auto-selected and
  // there's nothing for the buyer to choose.
  const { methods: paymentMethods, selected: selectedMethod, selectedId: selectedProvider, setSelectedId: setSelectedProvider, showPicker } =
    usePaymentMethods(settings, seller?.isOfficial ? "platform" : "marketplace")

  // Manual payment: populated after payment is initialized, order created only after "I've Paid"
  const [pendingOrderId,  setPendingOrderId]  = useState<string | null>(null)
  const [pendingRef,      setPendingRef]      = useState<string | null>(null)
  const [pendingBankDetails, setPendingBankDetails] = useState<BankDetails | null>(null)
  const [pendingOrderData, setPendingOrderData] = useState<any>(null)

  const [acceptedOffer, setAcceptedOffer] = useState<{
    offerId: string
    agreedPrice: number
    originalPrice: number
    acceptedAt: string
    quantity?: number
  } | null>(null)
  const [offerLoading, setOfferLoading] = useState(true)

  useEffect(() => {
    if (!open || !user?.uid) { setOfferLoading(false); return }
    setOfferLoading(true)
    OffersService.getAcceptedOffer(listing.id, user.uid)
      .then(offer => setAcceptedOffer(offer))
      .catch(() => setAcceptedOffer(null))
      .finally(() => setOfferLoading(false))
  }, [open, listing.id, user?.uid])

  const [street, setStreet] = useState("")
  const [city,   setCity]   = useState("")
  const [state,  setState]  = useState("")
  const [lga,    setLga]    = useState("")

  // Single last-used address, auto-overwritten on each successful order.
  // Prefills the address step so returning buyers don't re-type it, but
  // fields stay fully editable — this only ever sets initial state.
  const { lastAddress, saveLastAddress } = useLastAddress(user?.uid)
  useEffect(() => {
    if (!open || !lastAddress) return
    setStreet(prev => prev || lastAddress.street)
    setCity(prev   => prev || lastAddress.city)
    setState(prev  => prev || lastAddress.state)
    setLga(prev    => prev || lastAddress.lga)
  }, [open, lastAddress])

  // An accepted offer is a negotiated TOTAL for offer.quantity units
  // (default 1, for legacy single-unit offers) — it does not scale with
  // whatever quantity the listing page passed in, since that price was
  // already fixed during negotiation for a specific quantity.
  //
  // Otherwise, prefer the caller's exact resolvedTotal (bulk-tier aware)
  // over deriving one here — re-multiplying a per-unit price that was
  // itself rounded from a tier total can drift by a few kobo whenever the
  // tier's total doesn't divide evenly by its minQty.
  const effectiveQty  = acceptedOffer ? Math.max(1, acceptedOffer.quantity ?? 1) : Math.max(1, quantity)
  const unitPriceKobo = acceptedOffer ? Math.round(acceptedOffer.agreedPrice / effectiveQty) : listing.priceSale
  const itemPriceKobo = acceptedOffer
    ? acceptedOffer.agreedPrice
    : resolvedTotal != null ? resolvedTotal : unitPriceKobo * effectiveQty
  const breakdown     = calculateFees(itemPriceKobo, "sale", fees)

  const sellerDisplayName =
    seller?.storeName || seller?.fullName || listing.sellerName || "Seller"

  const addressValid = street.trim() && city.trim() && state

  const handlePlaceOrder = async () => {
    if (!user?.uid || !user?.email) {
      toast({ title: "Please log in again", description: "Your session may have expired.", variant: "destructive" })
      return
    }
    if (!selectedMethod) {
      toast({ title: "Choose a payment method", variant: "destructive" })
      return
    }
    setLoading(true)
    try {
      // ── For Paystack: create order then redirect ──────────────
      // ── For manual payment: only initialize payment reference here.
      //    The actual order row is created in handlePaymentConfirmed()
      //    AFTER the buyer clicks "I've Paid" and uploads proof.
      //    This prevents ghost orders when buyers abandon the bank transfer.

      const activeService =
        selectedMethod.provider === "paystack"    ? PaystackPaymentService
        : selectedMethod.provider === "flutterwave" ? FlutterwavePaymentService
        : ManualPaymentService

      // Built up-front (not just after initializePayment) so it can ride
      // along as payment metadata too — this lets the Flutterwave/Paystack
      // webhook reconstruct and create the order server-side even if the
      // buyer's browser never makes it back to /dashboard/buyer/orders
      // (closed tab, crashed browser, or the client-side retries in that
      // page exhaust before the gateway finishes settling). sessionStorage
      // remains the primary path since it's faster; this is the fallback.
      const draftForMetadata =
        selectedMethod.provider === "paystack" || selectedMethod.provider === "flutterwave"
          ? {
              buyerId:         user.uid,
              buyerName:       user.fullName || user.email,
              sellerId:        listing.sellerId,
              sellerName:      sellerDisplayName,
              sellerStoreName: seller?.storeName ?? "",
              listingId:       listing.id,
              itemTitle:       listing.title,
              itemImage:       listing.images?.[0] ?? "",
              selectedColor:   selectedColor ?? undefined,
              selectedSize:    selectedSize ?? undefined,
              totalAmount:     breakdown.buyerTotalKobo,
              platformFee:     breakdown.commissionKobo,
              sellerPayout:    breakdown.sellerPayoutKobo,
              deliveryStreet:  street.trim(),
              deliveryCity:    city.trim(),
              deliveryState:   state,
              deliveryLGA:     lga.trim(),
              deliveryMethod:  "meetup",
              sellerState:     listing.nigerianState ?? "",
              buyerState:      state,
              itemPrice:       itemPriceKobo,
              isOfferOrder:    !!acceptedOffer,
              offerId:         acceptedOffer?.offerId ?? null,
              originalPrice:   itemPriceKobo,
              // Reuse the cart order's lineItems field for a single-item
              // Buy Now purchase too — this is how SellerOrderCard (and any
              // future order-detail UI) learns the actual quantity ordered,
              // since Order has no separate top-level quantity field.
              lineItems: [{
                listingId:  listing.id,
                title:      listing.title,
                qty:        effectiveQty,
                unitPrice:  unitPriceKobo,
                agreedPrice: acceptedOffer?.agreedPrice,
                offerId:    acceptedOffer?.offerId ?? null,
              }],
            }
          : null

      const paymentResult = await activeService.initializePayment({
        purpose:     "order",
        amount:      breakdown.buyerTotalKobo,
        email:       user.email,
        userId:      user.uid,
        metadata:    draftForMetadata ? { listingId: listing.id, orderDraft: draftForMetadata } : { listingId: listing.id },
        callbackUrl: `${window.location.origin}/dashboard/buyer/orders`,
        paystackChannel: selectedMethod.paystackChannel,
      })

      if (selectedMethod.provider === "paystack" || selectedMethod.provider === "flutterwave") {
        // Online payment — do NOT create the order yet. If the buyer abandons
        // or the payment fails, no order should ever exist. The order is
        // created only after we verify the payment on return (see
        // /api/orders/create-verified-paystack, called from the orders list).
        const orderDraft = draftForMetadata!
        try {
          sessionStorage.setItem(`pending_order_${paymentResult.reference_code}`, JSON.stringify(orderDraft))
        } catch { /* sessionStorage unavailable — orders page falls back to reference-only lookup */ }
        // NOTE: do NOT mark the offer used here. The buyer is only being
        // redirected to Paystack/Flutterwave at this point — they haven't
        // paid yet. If they abandon the redirect, fail the payment, or
        // close the tab, the offer must still be usable. It's marked used
        // only once payment is actually confirmed (see handlePaymentConfirmed
        // for the manual-transfer equivalent of this same rule).
        if (!paymentResult.redirectUrl) {
          throw new Error("Paystack did not return a redirect URL. Please try again.")
        }
        window.location.href = paymentResult.redirectUrl
        onClose()
      } else {
        // Manual bank transfer — store order data and show bank details.
        // Order is NOT created yet. It will be created in handlePaymentConfirmed()
        // only after the buyer uploads proof and clicks "I've Paid".
        const orderData = {
          buyerId:         user.uid,
          buyerName:       user.fullName || user.email,
          sellerId:        listing.sellerId,
          sellerName:      sellerDisplayName,
          sellerStoreName: seller?.storeName,
          listingId:       listing.id,
          itemTitle:       listing.title,
          itemImage:       listing.images?.[0],
          selectedColor:   selectedColor ?? undefined,
          selectedSize:    selectedSize ?? undefined,
          totalAmount:     breakdown.buyerTotalKobo,
          platformFee:     breakdown.commissionKobo,
          sellerPayout:    breakdown.sellerPayoutKobo,
          status:          "pending" as const,
          orderType:       "purchase" as const,
          escrowStatus:    "pending" as const,
          deliveryStreet:  street.trim(),
          deliveryCity:    city.trim(),
          deliveryState:   state,
          deliveryLGA:     lga.trim(),
          deliveryMethod:  "meetup",
          sellerState:     listing.nigerianState,
          buyerState:      state,
          itemPrice:       itemPriceKobo,
          isOfferOrder:    !!acceptedOffer,
          offerId:         acceptedOffer?.offerId ?? null,
          originalPrice:   itemPriceKobo,
          lineItems: [{
            listingId:  listing.id,
            title:      listing.title,
            qty:        effectiveQty,
            unitPrice:  unitPriceKobo,
            agreedPrice: acceptedOffer?.agreedPrice,
            offerId:    acceptedOffer?.offerId ?? null,
          }],
        }
        setPendingOrderData(orderData)
        setPendingRef(paymentResult.reference_code)
        setPendingBankDetails((paymentResult as any).bankDetails ?? null)
        setStep("bank_details")
      }
    } catch (err: any) {
      toast({ title: "Could not initialize payment", description: err.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  // Called by ManualPaymentInstructions after buyer uploads proof and clicks "I've Paid"
  const handlePaymentConfirmed = async (proofUrl: string | null) => {
    // FIX: guard against double invocation creating two orders for one
    // payment. pendingOrderId is only set after createOrder succeeds, so
    // checking it here — plus clearing pendingOrderData immediately —
    // means a second call (e.g. an accidental re-render-triggered re-call)
    // can't slip through and create a duplicate order.
    if (!user?.uid || !pendingOrderData || !pendingRef) return
    const orderDataToCreate = pendingOrderData
    setPendingOrderData(null)
    try {
      // NOW create the order — buyer has committed
      const { id: orderId } = await OrdersService.createOrder({
        ...orderDataToCreate,
        paymentReference: pendingRef,
        paymentProvider:  "manual",
      })
      // Patch the orderId onto pending_payments metadata — /api/payment/confirm
      // needs this to know which order to move to escrow_held when admin confirms.
      // Non-fatal: if this fails, admin can still resolve manually, but log it
      // since it means confirmation will silently no-op for this order otherwise.
      try {
        await fetch("/api/payment/attach-order", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ reference: pendingRef, orderId, userId: user.uid }),
        })
      } catch (err) {
        console.error("attach-order failed (non-blocking):", err)
      }
      if (acceptedOffer) await OffersService.markOfferUsed(listing.id, user.uid)
      setPendingOrderId(orderId)
      toast({
        title: "Payment received! 🎉",
        description: "Your order has been created. Redirecting you to track it…",
        variant: "success",
      })
      router.push(`/dashboard/buyer/orders/${orderId}`)
      handleClose()
    } catch (err: any) {
      // Restore pendingOrderData so the buyer can retry without re-uploading
      // proof or re-entering their delivery address.
      setPendingOrderData(orderDataToCreate)
      toast({ title: "Could not create order", description: err.message, variant: "destructive" })
      throw err
    }
  }

  const handleClose = () => {
    if (loading) return
    setStep("address")
    setStreet(""); setCity(""); setState(""); setLga("")
    setPendingOrderId(null); setPendingRef(null); setPendingBankDetails(null)
    setPendingOrderData(null)
    onClose()
  }

  const STEPS = ["address", "review", "payment", "bank_details"] as const

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {/* Compact modal — max-h keeps it within viewport, no oversized padding */}
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-sm sm:max-w-md mx-auto rounded-2xl p-0 gap-0 overflow-hidden max-h-[92dvh] flex flex-col">

        {/* ── Header ─────────────────────────────────────────────── */}
        <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <span>Buy Now — Escrow Protected</span>
          </DialogTitle>
          {/* Step pills */}
          <div className="flex items-center gap-1.5 mt-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0
                  ${step === s ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                  {i + 1}
                </span>
                {i < 2 && <span className="text-muted-foreground/40 text-xs">›</span>}
              </div>
            ))}
            <span className="text-xs text-muted-foreground ml-1 capitalize">
              {step === "address" ? "Delivery" : step === "review" ? "Review" : step === "payment" ? "Payment" : "Bank Transfer"}
            </span>
          </div>
        </DialogHeader>

        <Separator />

        {/* ── Item row — always visible, compact ─────────────────── */}
        {!offerLoading && (
          <div className="flex items-center gap-3 px-4 py-2.5 shrink-0">
            {listing.images?.[0] ? (
              <img
                src={listing.images[0]}
                alt={listing.title}
                className="w-11 h-11 rounded-lg object-cover shrink-0 border"
              />
            ) : (
              <div className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              {/* Title truncates — no overflow */}
              <p className="font-medium text-xs leading-tight truncate">{listing.title}</p>
              <p className="text-[11px] text-muted-foreground">by {sellerDisplayName}</p>
              {acceptedOffer ? (
                <div className="mt-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground line-through text-xs">{formatPrice(listing.priceSale)}</span>
                    <span className="text-emerald-600 font-bold text-sm">{formatPrice(acceptedOffer.agreedPrice)}</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded">Negotiated</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Qty: 1 — your negotiated price applies to a single unit
                  </p>
                </div>
              ) : (
                <div className="mt-0.5">
                  <p className="text-primary font-bold text-sm">{formatPrice(itemPriceKobo)}</p>
                  {effectiveQty > 1 && (
                    <p className="text-[10px] text-muted-foreground">
                      {effectiveQty} × {formatPrice(unitPriceKobo)}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <Separator />

        {/* ── Scrollable step content ─────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {offerLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Step 1 — Delivery Address */}
              {step === "address" && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
                    <MapPin className="h-3 w-3" /> Delivery Address
                  </p>
                  <div>
                    <Label className="text-xs">Street Address *</Label>
                    <Input
                      value={street}
                      onChange={e => setStreet(e.target.value)}
                      placeholder="e.g. 12 Allen Avenue"
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">City *</Label>
                      <Input
                        value={city}
                        onChange={e => setCity(e.target.value)}
                        placeholder="e.g. Ikeja"
                        className="mt-1 h-9 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">LGA</Label>
                      <Input
                        value={lga}
                        onChange={e => setLga(e.target.value)}
                        placeholder="e.g. Ikeja LGA"
                        className="mt-1 h-9 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">State *</Label>
                    <select
                      value={state}
                      onChange={e => setState(e.target.value)}
                      className="mt-1 w-full h-9 text-sm border rounded-md px-3 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Select state</option>
                      {NG_STATES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                    <AlertCircle className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-blue-700">
                      You can also arrange <strong>meetup</strong> with the seller after placing your order.
                    </p>
                  </div>
                </div>
              )}

              {/* Step 2 — Review */}
              {step === "review" && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
                    <Truck className="h-3 w-3" /> Order Summary
                  </p>
                  <div className="rounded-lg border bg-muted/20 divide-y text-sm">
                    <div className="flex justify-between px-3 py-2">
                      <span className="text-muted-foreground text-xs">Delivery to</span>
                      <span className="font-medium text-xs text-right max-w-[55%] truncate">{city}, {state}</span>
                    </div>
                    <div className="flex justify-between px-3 py-2">
                      <span className="text-muted-foreground text-xs">Street</span>
                      <span className="text-xs text-right max-w-[55%] truncate">{street}{lga ? `, ${lga}` : ""}</span>
                    </div>
                    <div className="flex justify-between px-3 py-2">
                      <span className="text-muted-foreground text-xs">Item price</span>
                      <span className="text-xs">{formatPrice(breakdown.itemPriceKobo)}</span>
                    </div>
                    {breakdown.buyerConvenienceKobo > 0 && (
                      <div className="flex justify-between px-3 py-2">
                        <span className="text-muted-foreground text-xs">{fees.buyerFeeLabel}</span>
                        <span className="text-xs">+{formatPrice(breakdown.buyerConvenienceKobo)}</span>
                      </div>
                    )}
                    <div className="flex justify-between px-3 py-2">
                      <span className="text-muted-foreground text-xs">Delivery (meetup)</span>
                      <span className="text-xs text-emerald-600 font-medium">Free</span>
                    </div>
                    <div className="flex justify-between px-3 py-2.5">
                      <span className="font-bold text-sm">Grand Total</span>
                      <span className="font-bold text-primary text-sm">{formatPrice(breakdown.buyerTotalKobo)}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2.5 bg-emerald-50 border border-emerald-100 rounded-lg">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-emerald-700">
                      Your payment is held in <strong>escrow</strong> and only released to the seller after you confirm receipt. You are fully protected.
                    </p>
                  </div>
                </div>
              )}

              {/* Step 3 — Payment */}
              {step === "payment" && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
                    <CreditCard className="h-3 w-3" /> Payment
                  </p>
                  <div className="rounded-lg border bg-muted/20 divide-y text-sm">
                    <div className="flex justify-between px-3 py-2.5">
                      <span className="font-semibold text-sm">Total to pay</span>
                      <span className="text-primary font-bold text-sm">{formatPrice(breakdown.buyerTotalKobo)}</span>
                    </div>
                  </div>

                  {/* Notice only — third-party (non-Zamorax-Direct) orders
                      over 50k are recommended to use manual transfer.
                      Nothing is actually restricted; the buyer can still
                      pick any enabled method below. Zamorax Direct
                      purchases (seller.isOfficial) never show this. */}
                  {!seller?.isOfficial && breakdown.buyerTotalKobo > 50_000 * 100 && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                      <p className="text-xs text-amber-800">
                        For orders above ₦50,000 from third-party sellers, we recommend paying via <strong>Bank Transfer (Manual)</strong> for added safety.
                      </p>
                    </div>
                  )}

                  {/* Method choice — auto-detects how many the admin has
                      enabled. 1 enabled -> nothing to render here, just the
                      confirmation line below. 2+ -> shared picker. */}
                  {showPicker ? (
                    <PaymentMethodPicker
                      methods={paymentMethods}
                      selectedId={selectedProvider}
                      onSelect={setSelectedProvider}
                      name="buyNowPaymentMethod"
                    />
                  ) : (
                    <div className="rounded-lg border bg-muted/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        Payment via {selectedMethod?.label ?? "—"}
                      </p>
                    </div>
                  )}

                  <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-100 rounded-lg">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-amber-700">
                      {selectedProvider === "manual"
                        ? "After placing your order, you will see our bank details. Your order is activated once admin confirms your transfer."
                        : "You will be redirected to complete payment securely."}
                    </p>
                  </div>

                  {/* Flutterwave/Paystack dashboards are set to "charge
                      customer" for processing fees, so the amount debited
                      on the customer's card/bank statement is slightly
                      higher than the total shown above. Not shown for
                      manual bank transfer, since that path isn't run
                      through the gateway and has no added fee. */}
                  {selectedProvider !== "manual" && (
                    <p className="text-[11px] text-muted-foreground text-center">
                      A small card/transfer processing fee may be added at checkout.
                    </p>
                  )}
                </div>
              )}
              {/* Step 4 — Bank Details (manual payment only) */}
              {step === "bank_details" && pendingRef && (
                <ManualPaymentInstructions
                  amount={breakdown.buyerTotalKobo}
                  reference={pendingRef}
                  bankDetails={pendingBankDetails}
                  userId={user?.uid ?? ""}
                  purpose="order"
                  onConfirmed={handlePaymentConfirmed}
                />
              )}
            </>
          )}
        </div>

        {/* ── Sticky action buttons — always visible at bottom ─────── */}
        {!offerLoading && step !== "bank_details" && (
          <>
            <Separator />
            <div className="px-4 py-3 shrink-0">
              {step === "address" && (
                <Button
                  className="w-full h-10 bg-primary text-white"
                  disabled={!addressValid}
                  onClick={() => {
                    saveLastAddress({ street: street.trim(), city: city.trim(), state, lga: lga.trim() })
                    setStep("review")
                  }}
                >
                  Continue to Review
                </Button>
              )}
              {step === "review" && (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-none px-5 h-10" onClick={() => setStep("address")}>
                    ‹ Back
                  </Button>
                  <Button className="flex-1 h-10 bg-primary text-white" onClick={() => setStep("payment")}>
                    Continue to Payment
                  </Button>
                </div>
              )}
              {step === "payment" && (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-none px-5 h-10" disabled={loading} onClick={() => setStep("review")}>
                    ‹ Back
                  </Button>
                  <Button
                    className="flex-1 h-10 bg-primary text-white"
                    disabled={loading || !selectedProvider}
                    onClick={handlePlaceOrder}
                  >
                    {loading
                      ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Placing order...</>
                      : <>Pay {formatPrice(breakdown.buyerTotalKobo)}</>}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
