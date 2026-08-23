"use client"
import type { Listing } from "@/src/types"

import { AdminService, where, increment, serverTimestamp, ChatService } from "@/src/services"
// components/listings/ListingDetailClient.tsx

import { useEffect, useState, useCallback, useRef } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { formatPrice, formatPriceWithUnit, resolveBulkPrice } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { SellerTrustScore } from "@/components/shared/SellerTrustScore"
import { SellerReviews } from "@/components/reviews/SellerReviews"
import { RentalCalendar } from "@/components/rentals/RentalCalendar"
import { BuyNowModal } from "@/components/listings/BuyNowModal"
import { ReportListingModal } from "@/components/listings/ReportListingModal"
import { ListingQnA } from "@/components/listings/ListingQnA"
import { RelatedListings } from "@/components/listings/RelatedListings"
import { SponsoredListings } from "@/components/listings/SponsoredListings"
import { BundleDeals } from "@/components/listings/BundleDeals"
import { PriceAlertButton } from "@/components/listings/PriceAlertButton"
import { getRentRule } from "@/constants/rentRules"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"
import { useSubSettings } from "@/hooks/useSubSettings"
import { ListingsService, RecentlyViewedService, OffersService } from "@/src/services"
import { useCartItemsStore } from "@/store/cartStore"
import {
  MapPin, Shield, Truck, Heart, Share2, MessageSquare, Eye, Flag,
  Tag, Clock, Loader2,
  CheckCircle, Star, Store, ArrowLeft, CalendarDays,
  Flame, ShoppingCart, Minus, Plus, PalmtreeIcon, AlertTriangle, Package } from "lucide-react"
import Link from "next/link"
import { ImageCarousel } from "@/components/listings/ImageCarousel"
import { FormattedDescription } from "@/components/listings/FormattedDescription"

const conditionLabel: Record<string, string> = {
  brand_new: "Brand New", open_box: "Open Box",
  grade_a: "Grade A",    grade_b: "Grade B" }

interface Props {
  id: string
  initialListing: Listing   // pre-fetched by server for instant render
}

// Flash countdown
function useFlashCountdown(expiresAt: string | { toDate: () => Date } | undefined) {
  const [timeLeft, setTimeLeft] = useState("")
  useEffect(() => {
    if (!expiresAt) return
    const target = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt.toDate()
    const tick = () => {
      const diff = target.getTime() - Date.now()
      if (diff <= 0) { setTimeLeft("Ended"); return }
      const h = Math.floor(diff / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      const s = Math.floor((diff % 60_000) / 1_000)
      setTimeLeft(`${h}h ${m}m ${s}s`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  return timeLeft
}

export function ListingDetailClient({ id, initialListing }: Props) {
  const { user, loading: authLoading }   = useAuth()
  const { settings } = usePlatformSettings()
  const { settings: subSettings } = useSubSettings()
  const router     = useRouter()
  const pathname   = usePathname()
  const gotoLogin  = () => router.push(`/login?next=${encodeURIComponent(pathname)}`)
  const { toast }  = useToast()
  const { addToCart, getCartItems } = useCartItemsStore()

  const [listing,     setListing]     = useState<any>(initialListing)
  const viewCounted = useRef(false)
  const [seller,      setSeller]      = useState<any>(null)
  const [loading,     setLoading]     = useState(!initialListing)
  const [saved,       setSaved]       = useState(false)
  const [savingItem,  setSavingItem]  = useState(false)
  const [offerAmount, setOfferAmount] = useState("")
  const [offerOpen,   setOfferOpen]   = useState(false)
  const [offerLoading,setOfferLoading]= useState(false)
  const [rentalDates,  setRentalDates]  = useState<{ start: Date; end: Date; days: number } | null>(null)
  const [buyNowOpen,   setBuyNowOpen]   = useState(false)
  const [reportOpen,   setReportOpen]   = useState(false)
  const [quantity,     setQuantity]     = useState(1)
  // Fashion variant selection — only relevant when listing.attributes.colors
  // / .sizes have more than one option (set via the multi-select chips in
  // FashionAttr.tsx at listing creation). null until the buyer picks one.
  const [selectedColor, setSelectedColor] = useState<string | null>(null)
  const [selectedSize,  setSelectedSize]  = useState<string | null>(null)
  const searchParams = useSearchParams()

  // Coupon code — buyer types the seller's code, we validate it against
  // listing.coupon (case-insensitive) and apply the discount. Only one
  // price adjustment applies at a time: if a flash deal is active, the
  // coupon input is hidden rather than letting the two stack silently.
  const [couponInput,   setCouponInput]   = useState("")
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountPercent: number } | null>(null)
  const [couponError,   setCouponError]   = useState<string | null>(null)

  // Accepted-offer price for this buyer+listing, if any — looked up here
  // (not just inside BuyNowModal) so "Add to Cart" can also honor the
  // negotiated price instead of silently charging full price. Whichever
  // checkout path the buyer picks (Buy Now or Cart), the agreed price
  // should apply the same way.
  const [acceptedOffer, setAcceptedOffer] = useState<{
    offerId: string
    agreedPrice: number
    originalPrice: number
    acceptedAt: string
    quantity?: number
  } | null>(null)

  useEffect(() => {
    if (!listing?.id || !user?.uid) { setAcceptedOffer(null); return }
    OffersService.getAcceptedOffer(listing.id, user.uid)
      .then(setAcceptedOffer)
      .catch(() => setAcceptedOffer(null))
  }, [listing?.id, user?.uid])

  // Coming from an accepted-offer chat bubble ("Buy Now at ₦X") — auto-open
  // the Buy Now modal instead of dropping the buyer on the plain listing
  // page at full price. BuyNowModal itself already looks up any accepted
  // offer for this buyer+listing and applies the negotiated price, so this
  // just needs to trigger it.
  useEffect(() => {
    if (searchParams.get("buyNow") === "1" && user?.uid) {
      setBuyNowOpen(true)
      // Clean the URL so a refresh/back doesn't reopen the modal.
      router.replace(`/listings/${id}`, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user?.uid])

  // Flash deal
  const flashActive   = listing ? ListingsService.isFlashDealActive(listing) : false
  const flashPrice    = flashActive && listing?.flashDeal
    ? ListingsService.getFlashPrice(listing.priceSale, listing.flashDeal.discountPercent)
    : null
  const flashCountdown = useFlashCountdown(flashActive ? listing?.flashDeal?.expiresAt : undefined)

  // Coupon price — only computed when a coupon is applied and no flash
  // deal is active (flash deal takes priority since it's time-limited).
  const couponPrice = !flashActive && appliedCoupon && listing?.priceSale
    ? Math.round(listing.priceSale * (1 - appliedCoupon.discountPercent / 100))
    : null

  const applyCoupon = () => {
    setCouponError(null)
    const code = couponInput.trim().toUpperCase()
    if (!code) return
    if (!listing?.coupon?.code) {
      setCouponError("This listing has no coupon code")
      return
    }
    if (listing.coupon.code.toUpperCase() !== code) {
      setCouponError("Invalid coupon code")
      return
    }
    setAppliedCoupon({ code: listing.coupon.code, discountPercent: listing.coupon.discountPercent })
  }

  const removeCoupon = () => {
    setAppliedCoupon(null)
    setCouponInput("")
    setCouponError(null)
  }

  // Stock status
  const stockQty      = listing?.stockQty
  const isOutOfStock  = stockQty === 0
  const hasLimitedStock = stockQty != null && stockQty > 0
  // The seller's own highest bulk-pricing tier (e.g. "≥20 pieces") is a
  // deliberate quantity the seller defined — it must always be reachable,
  // even when it's above the platform's generic maxQtyPerItem default.
  // Without this, tapping that tier silently clamped to the generic cap,
  // so the tile never matched quantity and looked unresponsive/broken.
  // Stock (if limited) is still the hard ceiling either way.
  const highestBulkTierQty = listing?.bulkPricing?.length
    ? Math.max(...listing.bulkPricing.map((t: { minQty: number }) => t.minQty))
    : 0
  const baseMaxQty    = Math.max(settings.maxQtyPerItem ?? 10, highestBulkTierQty)
  const maxQty        = hasLimitedStock
    ? Math.min(stockQty, baseMaxQty)
    : baseMaxQty
  // Seller-defined hard floor on order size. Falls back to 1 when unset.
  // Clamped so it can never exceed maxQty (e.g. stock dropped below it),
  // which would otherwise make the quantity selector unusable.
  const minQty         = Math.min(Math.max(listing?.minOrderQty ?? 1, 1), maxQty)
  const showQtySelector = settings.multiCartEnabled && hasLimitedStock && stockQty >= 2

  // Fashion variants — attributes.colors / attributes.sizes are only ever
  // set as arrays by FashionAttr.tsx (see Step3Attributes). A single-option
  // array (e.g. just ["Black"]) isn't a real choice, so the picker only
  // shows and only becomes required when there's more than one option.
  const availableColors: string[] = Array.isArray(listing?.attributes?.colors) ? listing.attributes.colors : []
  const availableSizes:  string[] = Array.isArray(listing?.attributes?.sizes)  ? listing.attributes.sizes  : []
  const needsColorSelection = availableColors.length > 1
  const needsSizeSelection  = availableSizes.length > 1
  const variantSelectionMissing = (needsColorSelection && !selectedColor) || (needsSizeSelection && !selectedSize)

  // Vacation mode
  const onVacation    = listing?.vacationMode === true

  // Once the listing (and its minOrderQty) loads, bump the default
  // selection up to the seller's minimum if it's currently below it —
  // the quantity state initializes to 1 before listing data arrives.
  useEffect(() => {
    if (listing && quantity < minQty) setQuantity(minQty)
  }, [listing, minQty])

  useEffect(() => {
    const load = async () => {
      try {
        // initialListing is only for instant first paint (server-prefetched).
        // Always follow up with a fresh client-side fetch so edits made
        // elsewhere (e.g. the seller just saved changes on the Edit
        // Listing page, including stock quantity) show up immediately
        // instead of the page silently continuing to show stale data
        // until a hard reload.
        //
        // IMPORTANT: use ListingsService.getListingById here, NOT
        // AdminService.getDoc. The generic AdminService.getDoc goes through
        // rowToDoc(), which does a dumb snake_case -> camelCase copy of every
        // D1 column with no field-specific coercion. That meant numeric
        // columns which are 0/NULL by default in D1 (e.g. estimated_delivery_
        // days, stock_qty) came back as raw 0 instead of the "" / undefined
        // the listing-specific mapper produces — so a falsy-looking field
        // silently became a truthy 0 and rendered as a bare "0" in the UI
        // once this effect overwrote the clean server-rendered listing.
        // ListingsService.getListingById uses the same dedicated mapper the
        // server component uses for initialListing, so the two stay
        // consistent.
        const data = await ListingsService.getListingById(id)

        if (!data) { setLoading(false); return }
        setListing(data)

        // Increment views — skip when the seller is viewing their own
        // listing (matches every marketplace's behaviour: editing/checking
        // your own listing shouldn't inflate its view count). Wait for auth
        // to resolve first so we don't miscount before we know who's
        // viewing, and guard with a ref so it only ever fires once per visit
        // even though this effect re-runs when authLoading flips.
        if (!viewCounted.current && !authLoading && data.sellerId !== user?.uid) {
          viewCounted.current = true
          await AdminService.updateDoc("listings", id, { views: increment(1) })
          // The increment above only updates the DB — reflect it locally too,
          // otherwise the count on screen stays stale until the next reload.
          setListing((prev: any) => prev ? { ...prev, views: (prev.views || 0) + 1 } : prev)
        }

        // Load seller via public route (no auth required)
        if (data.sellerId) {
          try {
            const res = await fetch(`/api/seller/${data.sellerId}`)
            if (res.ok) {
              const sellerData = await res.json()
              if (sellerData) setSeller(sellerData)
            }
          } catch { /* non-blocking */ }
        }

        // Check if saved
        if (user?.uid) {
          const savedSnap = await AdminService.getDoc("savedListings", `${user.uid}_${id}`)
          setSaved(!!savedSnap)
        }

        // Track recently viewed
        if (user?.uid && settings.recentlyViewedEnabled) {
          RecentlyViewedService.trackView(user.uid, {
            id: data.id,
            title: data.title,
            images: data.images ?? [],
            priceSale: data.priceSale,
            sellerId: data.sellerId,
            nigerianState: data.nigerianState,
          }).catch(() => {}) // fire-and-forget
        }
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [id, user?.uid, authLoading, settings.recentlyViewedEnabled])

  const handleSave = async () => {
    if (!user?.uid) { gotoLogin(); return }
    setSavingItem(true)
    try {
      if (saved) {
        await AdminService.deleteDoc("savedListings", `${user.uid}_${id}`)
        setSaved(false)
        toast({ title: "Removed from saved" })
      } else {
        await AdminService.setDoc("savedListings", `${user.uid}_${id}`, { savedAt: serverTimestamp(), listingId: id, userId: user.uid, listingTitle: listing?.title ?? "", listingImage: listing?.images?.[0] ?? null, listingPrice: listing?.priceSale ?? 0 })
        setSaved(true)
        toast({ title: "Saved!", variant: "success" })
      }
    } catch (e: any) { toast({ title: "Could not save listing", description: e?.message ?? "Please try again.", variant: "destructive" }) }
    setSavingItem(false)
  }

  const handleShare = async () => {
    const url = window.location.href
    if (navigator.share) {
      await navigator.share({ title: listing?.title, url })
    } else {
      await navigator.clipboard.writeText(url)
      toast({ title: "Link copied!", variant: "success" })
    }
  }

  // Resolve the correct TOTAL price for the currently selected quantity.
  //
  // Bulk tiers are flat bundle totals as the seller set them — e.g.
  // "≥10 pieces → ₦18,000" means ₦18,000 IS the price for a bundle of 10,
  // not a per-piece rate to multiply by 10. So:
  //   - Quantity exactly matches a tier's minQty (tile tap, or stepper
  //     landing precisely on it) → that tier's price, used as-is, no
  //     multiplication.
  //   - Quantity below the first tier's minQty → qty × the base 1-piece
  //     price (listing.priceSale).
  //   - Quantity strictly between two tiers (only reachable via the
  //     stepper) → qty × the MOST RECENTLY CROSSED tier's implied
  //     per-piece rate (that tier's price ÷ its minQty) — not the base
  //     1-piece price, and not the next tier up.
  // Returns null when the listing has no bulk pricing at all, so callers
  // fall back to their existing plain-price behavior unchanged.
  // When a flash deal is active, every bulk tier is discounted by the same
  // percentage as the 1-piece flash price — keeps the whole price ladder
  // consistent instead of the flash price ever being pricier than a bulk
  // tier (or vice versa). Tiers are scaled at read time only; the stored
  // bulkPricing data itself is never rewritten.
  const resolvedBulkPrice = resolveBulkPrice(
    listing?.bulkPricing,
    listing?.priceSale ?? 0,
    quantity,
    flashActive && listing?.flashDeal ? listing.flashDeal.discountPercent : null
  )
  // Per-unit price for display purposes only (e.g. price cards, cart line
  // items that expect a unit price rather than a resolved total). Not used
  // for the actual charge total — that's resolvedBulkPrice.total above,
  // which correctly avoids multiplying an exact tier's flat bundle price.
  const bulkUnitPrice = resolvedBulkPrice
    ? Math.round(resolvedBulkPrice.total / Math.max(1, quantity))
    : null

  const handleAddToCart = useCallback(() => {
    if (!user?.uid) { gotoLogin(); return }
    if (!listing || isOutOfStock || onVacation) return
    if (variantSelectionMissing) {
      toast({
        title: "Select an option",
        description: [needsColorSelection && !selectedColor ? "color" : null, needsSizeSelection && !selectedSize ? "size" : null]
          .filter(Boolean).join(" and "),
        variant: "destructive",
      })
      return
    }

    const currentItems = getCartItems()
    if (currentItems.length >= (settings.maxCartItems ?? 20)) {
      toast({ title: "Cart is full", description: `Max ${settings.maxCartItems} items`, variant: "destructive" })
      return
    }

    // An accepted offer is a negotiated price for the quantity that was
    // actually agreed on (offer.quantity, default 1) — not per-unit and not
    // whatever the buyer currently has the quantity selector set to. Without
    // this cap, a buyer could add extra units at a price only negotiated
    // for a smaller quantity.
    const isOfferPriced = !!acceptedOffer
    const cartQuantity  = isOfferPriced ? Math.max(1, acceptedOffer!.quantity ?? 1) : quantity

    addToCart({
      listingId:      listing.id,
      listingTitle:   listing.title,
      listingImage:   listing.images?.[0],
      sellerId:       listing.sellerId,
      sellerName:     seller?.storeName || seller?.fullName || "Seller",
      sellerIsOfficial: seller?.isOfficial ?? false,
      sellerState:    listing.nigerianState,
      // bulkUnitPrice already has the flash discount baked in (see
      // resolvedBulkPrice above) when a flash deal is active, so it's
      // checked ahead of the plain flashPrice — otherwise a buyer at a
      // bulk quantity would get charged the 1-piece flash price instead
      // of their (also-discounted) bulk rate.
      priceSale:      couponPrice ?? (isOfferPriced ? listing.priceSale : (bulkUnitPrice ?? flashPrice ?? listing.priceSale)),
      // Passed through so the cart can re-resolve the correct total/unit
      // price whenever quantity changes in the drawer, instead of being
      // stuck with the per-unit rate captured at this exact quantity.
      // Omitted entirely for offer-priced items — a negotiated price is
      // fixed regardless of any bulk tiers.
      basePriceSale:  isOfferPriced ? undefined : listing.priceSale,
      bulkPricing:    isOfferPriced ? undefined : (listing.bulkPricing ?? undefined),
      minOrderQty:    listing.minOrderQty ?? undefined,
      stockQty:       listing.stockQty ?? undefined,
      agreedPrice:    acceptedOffer?.agreedPrice,
      offerId:        acceptedOffer?.offerId ?? null,
      couponCode:     (!flashActive && appliedCoupon) ? appliedCoupon.code : undefined,
      quantity:       cartQuantity,
      shippingMethods: listing.shippingMethods ?? ["meetup"],
      weightKg:       listing.weightKg,
      isFragile:      listing.isFragile,
      selectedColor:  selectedColor ?? undefined,
      selectedSize:   selectedSize ?? undefined,
      addedAt:        new Date().toISOString(),
    }, settings.maxQtyPerItem ?? 10, isOfferPriced ? 1 : minQty)

    toast({
      title: "Added to cart!",
      description: isOfferPriced
        ? `${listing.title} — your negotiated price of ${formatPrice(acceptedOffer!.agreedPrice)} applies`
        : listing.title,
      variant: "success",
    })
  }, [listing, seller, user?.uid, quantity, minQty, flashPrice, bulkUnitPrice, isOutOfStock, onVacation, settings, addToCart, getCartItems, router, toast, acceptedOffer, variantSelectionMissing, needsColorSelection, needsSizeSelection, selectedColor, selectedSize])

  // Shared by both Buy Now buttons (desktop panel + mobile sticky bar) —
  // same variant guard as Add to Cart, so a buyer can't skip straight to
  // checkout without picking a color/size when the listing requires one.
  const handleBuyNowClick = useCallback(() => {
    if (!user?.uid) { gotoLogin(); return }
    if (variantSelectionMissing) {
      toast({
        title: "Select an option",
        description: [needsColorSelection && !selectedColor ? "color" : null, needsSizeSelection && !selectedSize ? "size" : null]
          .filter(Boolean).join(" and "),
        variant: "destructive",
      })
      return
    }
    setBuyNowOpen(true)
  }, [user?.uid, variantSelectionMissing, needsColorSelection, needsSizeSelection, selectedColor, selectedSize, toast, gotoLogin])

  const handleChat = async (targetSellerId?: string, targetSellerName?: string) => {
    if (!user?.uid) { gotoLogin(); return }
    const sellerId   = targetSellerId   ?? listing?.sellerId
    const sellerName = targetSellerName ?? seller?.storeName ?? seller?.fullName ?? "Seller"
    if (!sellerId || user.uid === sellerId || !listing) return
    try {
      const chat = await ChatService.getOrCreateChat({
        listingId:    id,
        listingTitle: listing.title,
        listingImage: listing.images?.[0] || null,
        buyerId:      user.uid,
        buyerName:    user.fullName || user.email || "Buyer",
        sellerId,
        sellerName,
      })
      router.push(`/chat/${chat.id}`)
    } catch (err: any) {
      toast({ title: "Could not open chat", description: err?.message, variant: "destructive" })
    }
  }

  const handleContactBuyer = async (buyerId: string, buyerName: string) => {
    if (!user?.uid) {
      toast({ title: "Please log in again", description: "Your session may have expired.", variant: "destructive" })
      return
    }
    if (!listing) return
    try {
      const chat = await ChatService.getOrCreateChat({
        listingId:    id,
        listingTitle: listing.title,
        listingImage: listing.images?.[0] || null,
        buyerId,
        buyerName,
        sellerId:     user.uid,
        sellerName:   user.fullName || user.email || "Seller",
      })
      router.push(`/chat/${chat.id}`)
    } catch (err: any) {
      toast({ title: "Could not open chat", description: err?.message, variant: "destructive" })
    }
  }

  const handleOffer = async () => {
    if (!user?.uid) { gotoLogin(); return }
    const naira = parseInt(offerAmount.replace(/\D/g, ""))
    if (!naira || naira < 1) { toast({ title: "Enter a valid amount", variant: "destructive" }); return }
    const offerKobo = naira * 100
    // offerKobo is the TOTAL for `quantity` units, so the "too high" ceiling
    // scales with quantity too — otherwise a legitimate 15-unit offer near
    // full price would be rejected against the single-unit asking price.
    const offerQty = Math.max(1, quantity)
    if (offerKobo > listing.priceSale * offerQty) { toast({ title: "Offer too high", description: "Your offer can't exceed the asking price for the selected quantity.", variant: "destructive" }); return }
    setOfferLoading(true)
    try {
      await OffersService.makeOffer({
        listingId:     id,
        listingTitle:  listing.title,
        listingImage:  listing.images?.[0] || "",
        originalPrice: listing.priceSale,
        offerAmount:   offerKobo,
        buyerId:       user.uid,
        buyerName:     user.fullName || user.email || "Buyer",
        sellerId:      listing.sellerId,
        sellerName:    listing.sellerName || "Seller",
        quantity:      offerQty,
      })
      setOfferOpen(false)
      toast({ title: "Offer sent!", variant: "success" })
    } catch (e: any) {
      console.error("[handleOffer] failed:", e)
      toast({ title: "Error sending offer", description: e?.message || String(e), variant: "destructive" })
    }
    setOfferLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="container py-20 text-center">
        <h2 className="text-xl font-semibold">Listing not found</h2>
        <Button asChild className="mt-4"><Link href="/search">Browse Listings</Link></Button>
      </div>
    )
  }

  const isSeller = user?.uid === listing.sellerId
  const isRentalOnly = listing.listingType === "rent"
  // bulkUnitPrice already includes the flash discount when active (see
  // resolvedBulkPrice), so it's checked ahead of the plain flashPrice —
  // otherwise selecting a bulk quantity would show the 1-piece flash price.
  const displayPrice = couponPrice ?? bulkUnitPrice ?? flashPrice ?? listing.priceSale

  return (
    <>
    <div className="container max-w-5xl py-6 space-y-6 pb-24 lg:pb-6">

      <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 -ml-2 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>

      <div className="grid lg:grid-cols-[1fr_380px] gap-6">

        {/* Left: Images */}
        <div className="space-y-3">
          <div className="group relative rounded-2xl overflow-hidden">
            <ImageCarousel
              images={listing.images}
              alt={listing.title}
              aspectClassName="aspect-[4/3]"
              className="rounded-2xl"
              variant="detail"
              priority
              sizes="(max-width: 1024px) 100vw, 60vw"
              overlay={
                flashActive && listing.flashDeal ? (
                  <div className="absolute top-3 left-3 flex flex-col gap-1.5 pointer-events-none">
                    <span className="bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-md">
                      <Flame className="h-3 w-3" />
                      -{listing.flashDeal.discountPercent}% OFF
                    </span>
                  </div>
                ) : null
              }
            />
          </div>
        </div>

        {/* Right: Info + Actions */}
        <div className="space-y-4">
          <div>
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-xl font-bold text-foreground leading-snug">{listing.title}</h1>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={handleSave} disabled={savingItem} className="p-2 rounded-full hover:bg-muted transition">
                  <Heart className={`h-5 w-5 transition-colors ${saved ? "fill-red-500 text-red-500" : "text-muted-foreground"}`} />
                </button>
                <button onClick={handleShare} className="p-2 rounded-full hover:bg-muted transition">
                  <Share2 className="h-5 w-5 text-muted-foreground" />
                </button>
                {!isSeller && (
                  <button
                    onClick={() => {
                      if (!user) { router.push(`/login?next=${encodeURIComponent(pathname)}`); return }
                      setReportOpen(true)
                    }}
                    className="p-2 rounded-full hover:bg-muted transition"
                    aria-label="Report listing"
                  >
                    <Flag className="h-5 w-5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="secondary">{conditionLabel[listing.condition] || listing.condition}</Badge>
              {listing.isHubVerified && (
                <Badge className="bg-emerald-100 text-emerald-700 border-0 gap-1">
                  <CheckCircle className="h-3 w-3" /> Hub Verified
                </Badge>
              )}
              {listing.listingType === "rent" || listing.listingType === "both" ? (
                <Badge variant="outline" className="text-accent border-accent">For Rent</Badge>
              ) : null}
            </div>

            {!!listing.estimatedDeliveryDays && (
              <div className="flex items-center gap-1.5 mt-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 w-fit">
                <Truck className="h-4 w-4 shrink-0" />
                Delivered in {listing.estimatedDeliveryDays}
              </div>
            )}

            {!!listing.estimatedDeliveryDays && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Not shipped within {listing.estimatedDeliveryDays}? Contact support for a full refund.
              </p>
            )}
          </div>

          {/* Price */}
          <div className="space-y-1">
            {flashActive && flashPrice != null ? (
              <div className="space-y-0.5">
                <p className="text-3xl font-extrabold text-red-600">{formatPriceWithUnit(flashPrice, listing.unitOfSale)}</p>
                <p className="text-sm text-muted-foreground line-through">{formatPriceWithUnit(listing.priceSale, listing.unitOfSale)}</p>
                {flashCountdown && (
                  <div className="flex items-center gap-1.5 text-sm text-red-600 font-semibold bg-red-50 rounded-lg px-2.5 py-1.5 w-fit">
                    <Flame className="h-3.5 w-3.5" />
                    Flash deal ends in {flashCountdown}
                  </div>
                )}
              </div>
            ) : appliedCoupon && couponPrice != null ? (
              <div className="space-y-0.5">
                <p className="text-3xl font-extrabold text-orange-600">{formatPriceWithUnit(couponPrice, listing.unitOfSale)}</p>
                <p className="text-sm text-muted-foreground line-through">{formatPriceWithUnit(listing.priceSale, listing.unitOfSale)}</p>
                <div className="flex items-center gap-1.5 text-sm text-orange-600 font-semibold bg-orange-50 rounded-lg px-2.5 py-1.5 w-fit">
                  <Tag className="h-3.5 w-3.5" />
                  Code {appliedCoupon.code} applied — {appliedCoupon.discountPercent}% off
                </div>
              </div>
            ) : (
              <p className="text-3xl font-extrabold text-primary">{formatPriceWithUnit(listing.priceSale, listing.unitOfSale)}</p>
            )}
            {listing.listingType !== "sale" && listing.priceRentDaily && (
              <p className="text-sm text-muted-foreground">or {formatPrice(listing.priceRentDaily)} / day</p>
            )}
            {/* FIX: priceRentWeekly was collected in Step2 and saved, but
                nothing on this page ever displayed it — only the daily
                rate showed. */}
            {listing.listingType !== "sale" && listing.priceRentWeekly && (
              <p className="text-sm text-muted-foreground">or {formatPrice(listing.priceRentWeekly)} / week</p>
            )}
          </div>

          {/* Bulk pricing tiers — shown only when the seller has set them.
              Base "1 piece" price is listing.priceSale; tiers are additional
              lower per-piece prices at seller-defined quantity thresholds.
              Each tile is tappable — selects that tier's quantity so the
              price/total below updates to the bulk rate. Uses a wrapping
              grid (not horizontal scroll) so tiles flow onto new rows on
              narrow screens instead of widening the page or requiring a
              side-scroll to see every tier. */}
          {listing.bulkPricing && listing.bulkPricing.length > 0 && (
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setQuantity(1)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  quantity < (listing.bulkPricing[0]?.minQty ?? Infinity)
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 hover:border-primary/40"
                }`}
              >
                {flashActive && flashPrice ? (
                  <>
                    <p className="text-[10px] text-muted-foreground line-through">{formatPrice(listing.priceSale)}</p>
                    <p className="text-sm font-bold text-red-600">{formatPrice(flashPrice)}</p>
                  </>
                ) : (
                  <p className="text-sm font-bold text-foreground">{formatPrice(listing.priceSale)}</p>
                )}
                <p className="text-[11px] text-muted-foreground">1 piece</p>
              </button>
              {listing.bulkPricing.map((tier: { minQty: number; price: number }, i: number) => {
                const tierPrice = flashActive && listing.flashDeal
                  ? ListingsService.getFlashPrice(tier.price, listing.flashDeal.discountPercent)
                  : tier.price
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => setQuantity(Math.min(tier.minQty, maxQty))}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      quantity === tier.minQty
                        ? "border-primary bg-primary/5"
                        : "border-border bg-muted/30 hover:border-primary/40"
                    }`}
                  >
                    {flashActive && listing.flashDeal ? (
                      <>
                        <p className="text-[10px] text-muted-foreground line-through">{formatPrice(tier.price)}</p>
                        <p className="text-sm font-bold text-red-600">{formatPrice(tierPrice)}</p>
                      </>
                    ) : (
                      <p className="text-sm font-bold text-foreground">{formatPrice(tierPrice)}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">≥ {tier.minQty} pieces</p>
                  </button>
                )
              })}
            </div>
          )}

          {/* Description — placed right after price/title so buyers know
              what they're buying before any coupon/escrow/safety copy.
              Previously this sat near the bottom of the page, after the
              entire buy-action funnel, which meant scrolling past all of
              that just to read what the item actually is. */}
          {listing.description && (
            <div className="border-t border-border pt-4 space-y-2">
              <h2 className="font-semibold text-sm text-foreground">Description</h2>
              <FormattedDescription text={listing.description} />
            </div>
          )}

          {/* Specifications — generic renderer for listing.attributes.
              Step3's per-category components (ComputingAttr, VehiclesAttr,
              etc.) collect and save real spec data — device type, RAM,
              storage, brand, and so on — but nothing on this page ever
              displayed it back to buyers; attributes was only ever read
              for a .unit price-formatting lookup elsewhere on this file.
              This renders whatever keys are present for any category
              without needing a hardcoded field list per category, and
              skips internal/non-buyer-facing keys and empty values. */}
          {listing.attributes && Object.keys(listing.attributes).length > 0 && (
            <div className="border-t border-border pt-4 space-y-2">
              <h2 className="font-semibold text-sm text-foreground">Specifications</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {Object.entries(listing.attributes)
                  .filter(([key, value]) => {
                    if (key === "unit") return false // internal, used for price formatting only
                    // colors/sizes are multi-select arrays surfaced via the
                    // dedicated variant picker above (color swatches / size
                    // chips), not as a plain spec row — showing both would
                    // be redundant and the array would print as "Black,Red"
                    // here anyway since this list only handles scalars.
                    if (key === "colors" || key === "sizes") return false
                    if (value === undefined || value === null || value === "") return false
                    if (Array.isArray(value) && value.length === 0) return false
                    return true
                  })
                  .map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-muted-foreground capitalize">
                        {key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim()}
                      </dt>
                      <dd className="text-foreground font-medium">
                        {Array.isArray(value) ? value.join(", ") : String(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}

          {/* Coupon code input — only shown when the listing has a coupon
              and no flash deal is currently active (flash deal takes
              priority, so the input is hidden rather than letting a buyer
              enter a code that won't apply). */}
          {!flashActive && listing.coupon?.code && !isSeller && (
            <div className="space-y-1.5">
              {appliedCoupon ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
                  <span className="text-sm text-orange-700 font-medium flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5" /> Code {appliedCoupon.code} applied
                  </span>
                  <button onClick={removeCoupon} className="text-xs text-muted-foreground hover:text-foreground underline">
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter coupon code"
                    value={couponInput}
                    onChange={(e) => { setCouponInput(e.target.value); setCouponError(null) }}
                    className="max-w-[200px]"
                  />
                  <Button variant="outline" size="sm" onClick={applyCoupon}>Apply</Button>
                </div>
              )}
              {couponError && <p className="text-xs text-destructive">{couponError}</p>}
            </div>
          )}

          {/* Bundle deals — shown when this listing is part of one or more
              active seller-created bundles. */}
          {!isSeller && <BundleDeals listingId={listing.id} />}

          {/* Escrow-Protected Transaction panel */}
          {(listing.listingType === "sale" || listing.listingType === "both") && (() => {
            // An accepted offer is a negotiated total for offer.quantity
            // units (default 1) — it ignores the buyer's current quantity
            // selector and bulk tiers entirely, since the price was already
            // fixed for a specific quantity during negotiation. Otherwise:
            // if a bulk tier applies, use its resolved total directly —
            // resolvedBulkPrice already handles the three cases correctly
            // (exact tier = flat price, no multiplication; below first tier
            // = qty × base price; between tiers = qty × the most recently
            // crossed tier's implied per-piece rate). Falls back to
            // flash/coupon/base price × qty when there's no bulk pricing on
            // this listing at all.
            const panelQty = acceptedOffer ? Math.max(1, acceptedOffer.quantity ?? 1) : Math.max(1, quantity)
            const panelTotal = acceptedOffer
              ? acceptedOffer.agreedPrice
              : resolvedBulkPrice
                ? resolvedBulkPrice.total
                : (flashPrice ?? couponPrice ?? listing.priceSale) * panelQty
            const perPieceForDisplay = panelQty > 0 ? panelTotal / panelQty : panelTotal
            return (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                <Shield className="h-4 w-4 shrink-0" />
                Escrow-Protected Transaction
              </div>
              <p className="text-xs text-emerald-700/90 leading-relaxed">
                Your payment is held securely by Zamorax until you confirm the item is as described.
              </p>
              <div className="pt-1.5 mt-1 border-t border-emerald-100 space-y-1 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Listing price{panelQty > 1 ? ` (${panelQty} × ${formatPrice(perPieceForDisplay)})` : ""}</span>
                  <span className="text-foreground font-medium">{formatPrice(panelTotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Buyer fee</span>
                  <span className="text-emerald-700 font-medium">₦0</span>
                </div>
                <div className="flex justify-between font-bold pt-1">
                  <span>Total</span>
                  <span className="text-primary">{formatPrice(panelTotal)}</span>
                </div>
              </div>
            </div>
            )
          })()}

          {/* Price alert */}
          {settings.priceAlertsEnabled && !isSeller && !isOutOfStock && (
            <PriceAlertButton listing={listing} />
          )}

          {/* Stock status */}
          {isOutOfStock && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-sm font-semibold text-destructive">Out of Stock</p>
            </div>
          )}
          {hasLimitedStock && !isOutOfStock && settings.showLowStockWarning && stockQty <= (settings.lowStockThreshold ?? 3) && (
            <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <p className="text-xs font-medium text-amber-700">Only {stockQty} left in stock!</p>
            </div>
          )}
          {/* Plain stock count — shown whenever a finite stock number is set
              and it's above the low-stock threshold (the warning above
              already covers the "running low" case). Without this, a
              listing with plenty of stock (e.g. 10) showed no stock
              information anywhere on the page. */}
          {hasLimitedStock && !isOutOfStock && stockQty > (settings.lowStockThreshold ?? 3) && (
            <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <Package className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <p className="text-xs font-medium text-amber-700">{stockQty} in stock</p>
            </div>
          )}


          {/* Fashion variant picker — colors/sizes only show up here when the
              listing was created with more than one option selected (see
              FashionAttr.tsx). Selection is required before Add to Cart /
              Buy Now when there's a real choice to make. */}
          {!isSeller && !isOutOfStock && !onVacation && needsColorSelection && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Color{selectedColor ? `: ${selectedColor}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {availableColors.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    aria-pressed={selectedColor === color}
                    className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                      selectedColor === color
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isSeller && !isOutOfStock && !onVacation && needsSizeSelection && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Size{selectedSize ? `: ${selectedSize}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {availableSizes.map(size => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setSelectedSize(size)}
                    aria-pressed={selectedSize === size}
                    className={`min-w-[2.75rem] px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                      selectedSize === size
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Qty selector — only for multi-cart mode with limited stock */}
          {showQtySelector && !isSeller && !isOutOfStock && !onVacation && (
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-foreground">Quantity:</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setQuantity(q => Math.max(minQty, q - 1))}
                  disabled={quantity <= minQty}
                  className="w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-8 text-center text-sm font-semibold">{quantity}</span>
                <button
                  onClick={() => setQuantity(q => Math.min(maxQty, q + 1))}
                  className="w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition"
                  disabled={quantity >= maxQty}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {hasLimitedStock && <p className="text-xs text-muted-foreground">Max {maxQty}</p>}
            </div>
          )}

          {/* Vacation banner */}
          {onVacation && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
              <span className="text-xl">🏖️</span>
              <div>
                <p className="text-sm font-semibold text-blue-800">Seller is on vacation</p>
                {listing.vacationReturnDate && (
                  <p className="text-xs text-blue-600">
                    Back on {new Date(listing.vacationReturnDate).toLocaleDateString("en-NG", { day: "numeric", month: "long" })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Location */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0" />
              {listing.city}, {listing.nigerianState}
            </span>
            {typeof listing.views === "number" && listing.views > 0 && (
              <span className="flex items-center gap-1">
                <Eye className="h-4 w-4 shrink-0" />
                {listing.views.toLocaleString()} view{listing.views !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Actions */}
          {!isSeller ? (
            <div className="space-y-2 pt-1">
              {(settings.chatEnabled ?? true) ? (
                <>
                  <Button
                    className="w-full bg-primary text-white hover:bg-primary/90 h-12"
                    onClick={() => handleChat()}
                    disabled={onVacation}
                  >
                    <MessageSquare className="h-4 w-4 mr-2" /> Chat with Seller
                  </Button>

                  {(listing.listingType === "sale" || listing.listingType === "both") && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        className="h-11 border-primary text-primary hover:bg-primary/5"
                        onClick={handleBuyNowClick}
                        disabled={isOutOfStock || onVacation}
                      >
                        Buy Now
                      </Button>
                      {settings.multiCartEnabled && (
                        <Button
                          variant="outline"
                          className="h-11 gap-2"
                          onClick={handleAddToCart}
                          disabled={isOutOfStock || onVacation}
                        >
                          <ShoppingCart className="h-4 w-4" />
                          Add to Cart
                        </Button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-12 flex items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 text-sm text-muted-foreground gap-2">
                  <MessageSquare className="h-4 w-4" /> Messaging is currently unavailable
                </div>
              )}
              {(listing.listingType === "sale" || listing.listingType === "both") && settings.offersEnabled && (settings.makeOfferEnabled ?? true) && (listing as any).offersEnabled !== false && (
                <Button variant="outline" className="w-full h-10" onClick={() => setOfferOpen(true)} disabled={isOutOfStock || onVacation}>
                  <Tag className="h-4 w-4 mr-2" /> Make an Offer
                </Button>
              )}
              {(listing.listingType === "rent" || listing.listingType === "both") && (
                <div className="space-y-3 pt-1 border-t border-border">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    Select Rental Dates
                  </p>
                  <RentalCalendar
                    listingId={id}
                    maxRentalDays={getRentRule(listing.category)?.maxRentalDays ?? 30}
                    onRangeSelect={(start, end, days) => setRentalDates({ start, end, days })}
                  />
                  {rentalDates && listing.priceRentDaily && (
                    <div className="rounded-xl bg-muted/50 p-3 space-y-1.5 text-sm border border-border">
                      <div className="flex justify-between text-muted-foreground">
                        <span>₦{listing.priceRentDaily.toLocaleString()} × {rentalDates.days} days</span>
                        <span>₦{(listing.priceRentDaily * rentalDates.days).toLocaleString()}</span>
                      </div>
                      {listing.depositAmount && (
                        <div className="flex justify-between text-amber-700">
                          <span>Security deposit</span>
                          <span>₦{listing.depositAmount.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold border-t pt-1.5">
                        <span>Total</span>
                        <span>₦{((listing.priceRentDaily * rentalDates.days) + (listing.depositAmount ?? 0)).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                  <Button
                    className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-white border-0"
                    disabled={!rentalDates || onVacation}
                    onClick={() => handleChat()}
                  >
                    <CalendarDays className="h-4 w-4 mr-2" />
                    {rentalDates ? `Rent for ${rentalDates.days} day${rentalDates.days > 1 ? "s" : ""}` : "Select dates to rent"}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 pt-1">
              <Button asChild variant="outline" className="w-full">
                <Link href={`/dashboard/seller/listings/${id}/edit`}>Edit Listing</Link>
              </Button>
              {(listing as any).lastEnquiryBuyerId && (listing as any).lastEnquiryBuyerName && (
                <Button
                  variant="ghost"
                  className="w-full border border-primary/30 text-primary hover:bg-primary/5 h-10"
                  onClick={() => handleContactBuyer(
                    (listing as any).lastEnquiryBuyerId,
                    (listing as any).lastEnquiryBuyerName,
                  )}
                >
                  <MessageSquare className="h-4 w-4 mr-2" /> Contact Buyer
                </Button>
              )}
            </div>
          )}

          {offerOpen && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-3">
                <p className="text-sm font-medium">Your Offer</p>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Quantity</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => setQuantity(q => Math.max(minQty, q - 1))}
                      disabled={quantity <= minQty}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-sm font-semibold w-6 text-center">{quantity}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => setQuantity(q => Math.min(maxQty, q + 1))}
                      disabled={quantity >= maxQty}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {quantity > 1 && (
                  <p className="text-xs text-muted-foreground -mt-1">
                    For {quantity} pieces — enter your total offer, not a per-piece price.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm font-medium">₦</span>
                  <input
                    type="number"
                    value={offerAmount}
                    onChange={e => setOfferAmount(e.target.value)}
                    placeholder="Enter amount"
                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 bg-primary text-white" onClick={handleOffer} disabled={offerLoading}>
                    {offerLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send Offer"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOfferOpen(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Safety tip */}
      <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
        <Shield className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-800">
          <span className="font-semibold">Safety Tip:</span> Always pay through Zamorax escrow. Never pay a seller directly before verifying the item.
        </p>
      </div>

      {seller ? (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">About the Seller</h2>
              <Link href={`/seller/${seller.id}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                <Store className="h-3.5 w-3.5" /> View Store
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-primary font-bold text-lg">
                  {(seller.fullName || "S")[0].toUpperCase()}
                </span>
              </div>
              <div>
                <p className="font-medium">{seller.fullName || seller.storeName}</p>
                {seller.storeName && <p className="text-xs text-muted-foreground">{seller.storeName}</p>}
                <div className="flex items-center gap-1 text-xs text-amber-500 mt-0.5">
                  <Star className="h-3 w-3 fill-amber-400" />
                  <span>{(seller.sellerRating || 0).toFixed(1)}</span>
                  <span className="text-muted-foreground">· {seller.totalSales || 0} sales</span>
                </div>
              </div>
            </div>
            <SellerTrustScore
              ninVerified={seller.ninVerified}
              bvnVerified={seller.bvnVerified}
              sellerRating={seller.sellerRating || 0}
              totalSales={seller.totalSales || 0}
              totalRentals={seller.totalRentals || 0}
              size="sm"
            />
            {/* Prompt seller to complete their store profile */}
            {user?.uid === listing.sellerId && !seller.storeName && (
              <Link
                href="/dashboard/seller/store"
                className="flex items-center justify-center gap-2 text-xs font-medium p-2.5 border border-dashed border-primary/40 bg-primary/5 text-primary rounded-lg hover:bg-primary/10 transition-colors"
              >
                <Store className="h-3.5 w-3.5" /> Set up your store profile
              </Link>
            )}
          </CardContent>
        </Card>
      ) : !user && listing?.sellerId ? (
        <Card>
          <CardContent className="p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Store className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-sm">About the Seller</p>
                <p className="text-xs text-muted-foreground">Log in to view seller profile</p>
              </div>
            </div>
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="text-xs font-medium text-primary border border-primary rounded-md px-3 py-1.5 hover:bg-primary/5 whitespace-nowrap">
              Log in
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {listing.sellerId && settings.qnaEnabled && (
        <ListingQnA
          listingId={id}
          sellerId={listing.sellerId}
          sellerName={(listing as any).sellerName || "Seller"}
        />
      )}

      {buyNowOpen && listing && (
        <BuyNowModal
          open={buyNowOpen}
          onClose={() => setBuyNowOpen(false)}
          listing={{
            id:            listing.id,
            title:         listing.title,
            // Per-unit price for display only — the modal uses
            // resolvedTotal below as the actual charge whenever bulk
            // pricing applies, so this ordering no longer needs to matter
            // for the total, only for what's shown per-unit in the modal.
            priceSale:     couponPrice ?? bulkUnitPrice ?? flashPrice ?? listing.priceSale,
            images:        listing.images,
            sellerId:      listing.sellerId,
            sellerName:    seller?.storeName || seller?.fullName,
            nigerianState: listing.nigerianState,
          }}
          // An accepted offer is a negotiated total for offer.quantity units
          // (default 1) — same rule as Add to Cart above — so Buy Now
          // charges that agreed quantity, not whatever the buyer's quantity
          // selector currently shows. Otherwise pass the quantity the buyer
          // selected via the bulk-pricing tiles/stepper, so Buy Now charges
          // and records the same quantity Add to Cart would (previously it
          // silently charged for 1 unit at the bulk per-piece rate no
          // matter what quantity was selected).
          quantity={acceptedOffer ? Math.max(1, acceptedOffer.quantity ?? 1) : quantity}
          // Exact resolved total when a bulk tier applies (flat bundle
          // price at an exact tier, or the correctly-rounded between-tier
          // total) — avoids the modal re-deriving and re-multiplying a
          // unit price, which can drift by a few kobo. Coupon/flash-only
          // (no bulk tiers) cases fall back to undefined, so the modal's
          // own unitPriceKobo × quantity applies unchanged.
          resolvedTotal={!acceptedOffer && resolvedBulkPrice ? resolvedBulkPrice.total : undefined}
          seller={seller}
          selectedColor={selectedColor}
          selectedSize={selectedSize}
        />
      )}

      <ReportListingModal
        open={reportOpen}
        onOpenChange={setReportOpen}
        listingId={listing.id}
        listingTitle={listing.title}
        sellerId={listing.sellerId}
      />

      {listing.sellerId && settings.reviewsEnabled && (
        <div>
          <h2 className="font-semibold mb-3">Seller Reviews</h2>
          <SellerReviews sellerId={listing.sellerId} />
        </div>
      )}

      {subSettings.sponsoredListingsEnabled && listing.categorySlug && (
        <SponsoredListings
          category={listing.categorySlug}
          excludeId={listing.id}
          count={subSettings.sponsoredListingsCount}
        />
      )}

      {subSettings.relatedListingsEnabled && listing.categorySlug && (
        <RelatedListings
          category={listing.categorySlug}
          excludeId={listing.id}
          count={subSettings.relatedListingsCount}
        />
      )}
    </div>

    {/* Sticky mobile action bar — mirrors the inline actions above so the
        primary buy/chat actions stay reachable without scrolling back up.
        Desktop already shows the inline sidebar actions clearly in view,
        so this is mobile-only (matches BottomNav's own md:hidden). Sits
        just above BottomNav (h-16) rather than overlapping it. */}
    {!isSeller && !isRentalOnly && (
      <div className="fixed bottom-16 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:hidden safe-area-pb">
        <div className="flex items-stretch gap-2 p-2">
          {(settings.chatEnabled ?? true) && (
            <button
              onClick={() => handleChat()}
              disabled={onVacation}
              aria-label="Chat with seller"
              className="flex flex-col items-center justify-center gap-0.5 px-3 rounded-lg border border-border text-muted-foreground hover:bg-muted transition disabled:opacity-50 shrink-0"
            >
              <MessageSquare className="h-5 w-5" />
              <span className="text-[10px] font-medium">Chat</span>
            </button>
          )}

          {(listing.listingType === "sale" || listing.listingType === "both") && (
            <Button
              className="flex-1 h-auto bg-primary text-white hover:bg-primary/90"
              onClick={handleBuyNowClick}
              disabled={isOutOfStock || onVacation}
            >
              Buy Now
            </Button>
          )}

          {(listing.listingType === "sale" || listing.listingType === "both") && settings.multiCartEnabled && (
            <Button
              variant="outline"
              className="flex-1 h-auto border-primary text-primary hover:bg-primary/5 gap-1.5"
              onClick={handleAddToCart}
              disabled={isOutOfStock || onVacation}
            >
              <ShoppingCart className="h-4 w-4" />
              Add to Cart
            </Button>
          )}
        </div>
      </div>
    )}
    </>
  )
}
