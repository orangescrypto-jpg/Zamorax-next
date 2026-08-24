"use client"

// components/home/FlashSaleListingsSection.tsx
// Homepage preview row for individual seller listings that have a live
// flashDeal (Listing.flashDeal — set per-listing by the seller, see
// src/types/index.ts). This is deliberately a *separate* section from
// FlashDealsSection.tsx, which is the admin-managed banner/slider fed by
// the standalone "flashDeals" collection — that one stays exactly as is.
//
// This section instead mirrors the query used on the full /flash-deals
// page (active listings with a non-null, non-expired flashDeal) so the
// homepage preview always matches what buyers find when they tap "See all".
// Same horizontal swipe-carousel pattern as ZamoraxDirectSection.tsx.

import { AdminService, where, orderBy, onSnapshot } from "@/src/services"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Flame, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react"
import { ListingCard } from "@/components/listings/ListingCard"
import { ListingsService } from "@/src/services"
import type { Listing } from "@/src/types"

// Auto-slide interval — same rhythm as PromoStrip's Featured Deals slider
const AUTOPLAY_MS = 3500
// How long to stay paused after the user manually touches/scrolls before
// autoplay resumes, so it doesn't yank the row away mid-swipe.
const RESUME_DELAY_MS = 4000

export function FlashSaleListingsSection() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollPct, setScrollPct] = useState(0)
  const [canScroll, setCanScroll] = useState(false)
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pausedRef = useRef(false)

  useEffect(() => {
    const q = AdminService._ref_("listings", [
      where("isActive", "==", true),
      where("flashDeal", "!=", null),
      orderBy("flashDeal"),
    ])
    const unsub = onSnapshot(
      q,
      (docs: any) => {
        const active = docs.docs
          .map((d: any) => ({ id: d.id, ...d.data() }))
          .filter((d: any) => d.flashDeal && d.flashDeal.expiresAt && new Date(
            typeof d.flashDeal.expiresAt === "string" ? d.flashDeal.expiresAt : d.flashDeal.expiresAt.toDate?.() ?? d.flashDeal.expiresAt
          ).getTime() > Date.now())
        setListings(active)
        setLoading(false)
      },
      () => setLoading(false)
    )
    return unsub
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || listings.length === 0) return
    const check = () => {
      const maxScroll = el.scrollWidth - el.clientWidth
      setCanScroll(maxScroll > 4)
      setScrollPct(maxScroll > 4 ? Math.min(1, Math.max(0, el.scrollLeft / maxScroll)) : 0)
    }
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [listings])

  if (loading || listings.length === 0) return null

  const updateScrollState = () => {
    const el = scrollerRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    setCanScroll(maxScroll > 4)
    setScrollPct(maxScroll > 4 ? Math.min(1, Math.max(0, el.scrollLeft / maxScroll)) : 0)
  }

  const scrollByCards = (dir: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    const card = el.querySelector<HTMLElement>("[data-carousel-card]")
    const step = card ? card.offsetWidth + 12 : el.clientWidth * 0.46
    el.scrollBy({ left: dir * step, behavior: "smooth" })
  }

  // Autoplay — advances one card at a time, looping back to the start once
  // it reaches the end. Only runs when the row actually overflows and
  // isn't currently paused by user interaction.
  useEffect(() => {
    if (!canScroll) return
    autoplayRef.current = setInterval(() => {
      if (pausedRef.current) return
      const el = scrollerRef.current
      if (!el) return
      const maxScroll = el.scrollWidth - el.clientWidth
      if (el.scrollLeft >= maxScroll - 4) {
        el.scrollTo({ left: 0, behavior: "smooth" })
      } else {
        scrollByCards(1)
      }
    }, AUTOPLAY_MS)
    return () => { if (autoplayRef.current) clearInterval(autoplayRef.current) }
  }, [canScroll, listings.length])

  // Pause autoplay on manual touch/drag/wheel, resume a few seconds after
  // the user stops interacting — same "swipe still works" feel as any
  // standard product carousel.
  const pauseAutoplay = () => {
    pausedRef.current = true
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current)
    resumeTimeoutRef.current = setTimeout(() => { pausedRef.current = false }, RESUME_DELAY_MS)
  }

  useEffect(() => {
    return () => { if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current) }
  }, [])

  return (
    <section>
      <div className="flex items-start justify-between mb-4 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-primary/10 rounded-lg shrink-0">
            <Flame className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <h2 className="text-base font-bold text-foreground truncate">Flash Sale</h2>
              <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full animate-pulse">
                LIVE
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Limited-time discounts from sellers</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canScroll && (
            <div className="hidden sm:flex items-center gap-1">
              <button
                type="button"
                aria-label="Scroll left"
                onClick={() => { pauseAutoplay(); scrollByCards(-1) }}
                disabled={scrollPct <= 0.02}
                className="h-7 w-7 flex items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Scroll right"
                onClick={() => { pauseAutoplay(); scrollByCards(1) }}
                disabled={scrollPct >= 0.98}
                className="h-7 w-7 flex items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Link href="/flash-deals" className="text-xs text-primary font-medium flex items-center gap-0.5 whitespace-nowrap">
            See all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={updateScrollState}
        onTouchStart={pauseAutoplay}
        onMouseDown={pauseAutoplay}
        onWheel={pauseAutoplay}
        className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-1 -mx-4 px-4 sm:mx-0 sm:px-0"
      >
        {listings.map(l => (
          <div key={l.id} data-carousel-card className="shrink-0 w-[46%] sm:w-[220px] snap-start">
            <ListingCard
              listing={{
                ...l,
                priceSale: ListingsService.getFlashPrice(l.priceSale as number, (l.flashDeal as any).discountPercent),
              }}
            />
          </div>
        ))}
      </div>

      {canScroll && (
        <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden max-w-[120px] mx-auto sm:mx-0">
          <div
            className="h-full bg-primary/60 rounded-full transition-transform duration-150 ease-out"
            style={{ width: "40%", transform: `translateX(${scrollPct * 150}%)` }}
          />
        </div>
      )}
    </section>
  )
}
