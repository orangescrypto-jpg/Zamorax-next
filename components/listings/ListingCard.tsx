"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Heart, Share2, MapPin, ShieldCheck, BadgeCheck, Star, Crown, Flame, PalmtreeIcon, Eye, Truck, Tag, Layers } from "lucide-react"
import { cn, formatPrice, formatPriceWithUnit, truncateText } from "@/lib/utils"
import type { Listing } from "@/src/types"
import { useToast } from "@/components/ui/use-toast"
import { ListingsService } from "@/src/services"
import { ImageCarousel } from "@/components/listings/ImageCarousel"

const conditionStyles: Record<string, { bg: string; text: string; label: string }> = {
  brand_new: { bg: "bg-blue-100", text: "text-blue-700", label: "Brand New" },
  open_box: { bg: "bg-purple-100", text: "text-purple-700", label: "Open Box" },
  grade_a: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Grade A" },
  grade_b: { bg: "bg-amber-100", text: "text-amber-700", label: "Grade B" },
}

const planBadges: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  pro: { icon: <Crown className="h-3 w-3" />, color: "text-amber-500", label: "Pro" },
  starter: { icon: <Star className="h-3 w-3" />, color: "text-gray-500", label: "Starter" },
}

// ── Flash deal countdown hook ──────────────────────────────────────────────
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

export function ListingCard({ listing }: { listing: Listing }) {
  const { toast } = useToast()
  const router = useRouter()
  const [saved, setSaved] = useState(false)

  // Flash deal
  const flashActive     = ListingsService.isFlashDealActive(listing)
  const flashPrice      = flashActive && listing.flashDeal
    ? ListingsService.getFlashPrice(listing.priceSale, listing.flashDeal.discountPercent)
    : null
  const flashCountdown  = useFlashCountdown(flashActive ? listing.flashDeal?.expiresAt : undefined)

  // Vacation mode
  const onVacation = listing.vacationMode === true

  const handleShare = () => {
    const url = typeof window !== "undefined" ? `${window.location.origin}/listings/${listing.id}` : "#"
    if (navigator.share) {
      navigator.share({ title: listing.title, url })
    } else {
      navigator.clipboard.writeText(url)
      toast({ title: "Link Copied", description: "Share via WhatsApp or any app" })
    }
  }

  const cond = conditionStyles[listing.condition] || conditionStyles.grade_a
  const plan = planBadges[listing.sellerPlan || ""]


  return (
    <article className="group relative flex flex-col bg-card rounded-xl border border-border/50 overflow-hidden transition-all hover:shadow-md hover:border-primary/30">
      {/* Image */}
      <div className="relative aspect-[3/4] overflow-hidden bg-muted">
        <ImageCarousel
          images={listing.images}
          alt={listing.title}
          aspectClassName="aspect-[3/4]"
          variant="card"
          disableZoom
          onImageClick={() => router.push(`/listings/${listing.id}`)}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          overlay={
            <>
              {/* Badges Overlay */}
              <div className="absolute top-2 left-2 flex flex-col gap-1.5">
                {listing.isBoosted && (
                  <span className="px-2 py-0.5 bg-primary/90 text-white text-[10px] font-bold uppercase tracking-wider rounded-sm shadow-sm">
                    Sponsored
                  </span>
                )}
                {/* Flash deal discount badge */}
                {flashActive && listing.flashDeal && (
                  <span className="px-2 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-sm shadow-sm flex items-center gap-0.5">
                    <Flame className="h-2.5 w-2.5" />
                    -{listing.flashDeal.discountPercent}%
                  </span>
                )}
                {!flashActive && (
                  <span className={cn("px-2 py-0.5 text-[10px] font-medium rounded-sm", cond.bg, cond.text)}>
                    {cond.label}
                  </span>
                )}
              </div>

              {/* Vacation overlay badge */}
              {onVacation && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
                  <span className="bg-white/90 text-gray-800 text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow">
                    🏖️ On Vacation
                  </span>
                </div>
              )}
            </>
          }
        />

        {/* Save Button */}
        <button
          onClick={() => setSaved(!saved)}
          className="absolute top-2 right-2 p-1.5 bg-white/80 backdrop-blur rounded-full hover:bg-white transition shadow-sm"
          aria-label={saved ? "Unsave listing" : "Save listing"}
        >
          <Heart className={cn("h-4 w-4 transition-colors", saved ? "fill-red-500 text-red-500" : "text-gray-600")} />
        </button>

        {/* View count */}
        {typeof listing.views === "number" && listing.views > 0 && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/60 text-white text-[10px] font-medium rounded-full backdrop-blur-sm">
            <Eye className="h-3 w-3" /> {listing.views.toLocaleString()}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-2 sm:p-3 gap-1.5 sm:gap-2">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/listings/${listing.id}`}>
            <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-snug hover:text-primary transition-colors">
              {truncateText(listing.title, 50)}
            </h3>
          </Link>
        </div>

        {/* Price Section */}
        <div className="space-y-0.5">
          {flashActive && flashPrice != null ? (
            <>
              <p className="text-base font-bold text-red-600 truncate">
                {formatPrice(flashPrice)}
              </p>
              <p className="text-xs text-muted-foreground line-through">
                {formatPrice(listing.priceSale)}
              </p>
            </>
          ) : (
            <p className="text-base font-bold text-primary truncate">
              {formatPriceWithUnit(listing.priceSale, listing.attributes?.unit)}
            </p>
          )}
          {listing.listingType !== "sale" && listing.priceRentDaily && (
            <p className="text-xs text-muted-foreground">
              or {formatPrice(listing.priceRentDaily)} / day rent
            </p>
          )}
          {listing.bulkPricing && listing.bulkPricing.length > 0 && (
            <p className="text-[10px] font-medium text-primary flex items-center gap-0.5">
              <Layers className="h-2.5 w-2.5" />
              Bulk pricing available
            </p>
          )}
        </div>

        {/* Escrow Protection Badge — buyer fee is always ₦0, fees are seller-side only.
            Skipped for official/Zamorax Direct listings since the "Zamorax
            Enterprises Direct" badge below already implies trust/escrow —
            avoids redundant badges stacking up on the card. */}
        {!listing.isOfficial && (
          <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-1">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            <span>Escrow Protected</span>
            <span className="text-emerald-600/70">· ₦0 buyer fees</span>
          </div>
        )}

        {/* Fast-delivery badge — only shown if seller committed to a window */}
        {listing.estimatedDeliveryDays && (
          <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-1">
            <Truck className="h-3 w-3 shrink-0" />
            <span>Delivered in {listing.estimatedDeliveryDays}</span>
          </div>
        )}

        {/* Coupon badge — seller-set standing discount code, set at listing
            creation. Shows the code so buyers know to enter it at checkout. */}
        {listing.coupon?.code && (
          <div className="flex items-center gap-1 text-[10px] font-medium text-orange-700 bg-orange-50 border border-orange-100 rounded px-1.5 py-1">
            <Tag className="h-3 w-3 shrink-0" />
            <span>Code {listing.coupon.code} — {listing.coupon.discountPercent}% off</span>
          </div>
        )}

        {/* Zamorax Enterprises Direct tag — shown whenever the listing is
            official: either admin picked this specific listing
            (is_zamorax_pick) or the seller account itself is official
            (users.is_official). Using the combined isOfficial flag so every
            listing from an official seller shows this automatically, not
            just ones admin individually picked. */}
        {listing.isOfficial && (
          <div className="flex items-center gap-1 text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded px-1.5 py-1">
            <BadgeCheck className="h-3 w-3 shrink-0" />
            <span>Zamorax Enterprises Direct</span>
          </div>
        )}

        {/* Flash countdown */}
        {flashActive && flashCountdown && (
          <div className="flex items-center gap-1 text-[10px] text-red-600 font-medium bg-red-50 rounded px-1.5 py-0.5">
            <Flame className="h-2.5 w-2.5" />
            Ends in {flashCountdown}
          </div>
        )}

        {/* Seller plan badge (trust score removed from card for brevity —
            still shown on seller profile page) */}
        {plan && (
          <div className="flex items-center justify-end mt-1">
            <span className={cn("flex items-center gap-0.5 text-[10px] font-medium", plan.color)}>
              {plan.icon} {plan.label}
            </span>
          </div>
        )}

        {/* Location — hidden for official/Zamorax Direct listings (backed
            by Zamorax itself, no seller address relevant to the buyer);
            shown for regular seller listings so buyers can judge meetup
            proximity. Date removed so location has full width when shown. */}
        {!listing.isOfficial && (
          <div className="mt-auto pt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{listing.city}, {listing.nigerianState}</span>
          </div>
        )}

        {/* Actions — WhatsApp moved to listing detail page only */}
        <div className="flex gap-1.5 sm:gap-2 mt-2 pt-2 border-t border-border/50">
          <button onClick={handleShare} className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground hover:bg-muted/50 rounded transition">
            <Share2 className="h-3 w-3 shrink-0" /> <span className="truncate">Share</span>
          </button>
        </div>
      </div>
    </article>
  )
}
