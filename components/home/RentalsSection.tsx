"use client"

// components/home/RentalsSection.tsx
// Homepage section for rental listings — same shape and interaction
// pattern as ZamoraxDirectSection.tsx (auto + manual swipe carousel),
// but backed by ListingsService.getListings({ listingType: "rent" })
// instead of the official-listings endpoint. Count shown is admin-
// configurable (settings.homepageRentalsCount); the rest live on /rentals.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CalendarDays, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"
import { ListingsService } from "@/src/services"
import { ListingCard } from "@/components/listings/ListingCard"
import type { Listing } from "@/src/types"

// Auto-slide interval — same rhythm as ZamoraxDirectSection/PromoStrip
const AUTOPLAY_MS = 3500
// How long to stay paused after manual touch/drag/scroll before autoplay
// resumes, so it doesn't yank the row away mid-swipe.
const RESUME_DELAY_MS = 4000

export function RentalsSection({ onLoaded }: { onLoaded?: (ids: string[]) => void } = {}) {
  const { settings } = usePlatformSettings()
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollPct, setScrollPct] = useState(0)   // 0–1, how far through the row we've scrolled
  const [canScroll, setCanScroll] = useState(false) // whether content overflows at all
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pausedRef = useRef(false)

  const count = settings.homepageRentalsCount || 8

  useEffect(() => {
    if (!settings.homepageRentalsEnabled) { setLoading(false); return }

    ListingsService.getListings({ listingType: "rent", sort: "newest" })
      .then(res => {
        const items = (res.items ?? []).slice(0, count)
        setListings(items)
        onLoaded?.(items.map(l => l.id))
      })
      .catch(() => setListings([]))
      .finally(() => setLoading(false))
  }, [settings.homepageRentalsEnabled, count])

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

  const scrollByCards = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    const card = el.querySelector<HTMLElement>("[data-carousel-card]")
    const step = card ? card.offsetWidth + 12 : el.clientWidth * 0.46
    el.scrollBy({ left: dir * step, behavior: "smooth" })
  }, [])

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
  }, [canScroll, listings.length, scrollByCards])

  // Pause autoplay on manual touch/drag/wheel, resume a few seconds after
  // the user stops interacting.
  const pauseAutoplay = useCallback(() => {
    pausedRef.current = true
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current)
    resumeTimeoutRef.current = setTimeout(() => { pausedRef.current = false }, RESUME_DELAY_MS)
  }, [])

  useEffect(() => {
    return () => { if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current) }
  }, [])

  // ── Everything below this line may early-return, so every hook above
  // this point must run on every render regardless of these conditions.
  if (!settings.homepageRentalsEnabled) return null
  if (loading || listings.length === 0) return null

  const updateScrollState = () => {
    const el = scrollerRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    setCanScroll(maxScroll > 4)
    setScrollPct(maxScroll > 4 ? Math.min(1, Math.max(0, el.scrollLeft / maxScroll)) : 0)
  }

  return (
    <section>
      <div className="flex items-start justify-between mb-4 gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className="p-1.5 bg-amber-50 rounded-lg shrink-0">
            <CalendarDays className="h-4 w-4 text-amber-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground truncate">
              Rent Anything
            </h2>
            <p className="text-xs text-muted-foreground">Phones, vehicles, party equipment and more — protected by escrow</p>
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
          <Link href="/rentals" className="text-xs text-primary font-medium flex items-center gap-0.5 whitespace-nowrap">
            See more <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
      {/* Horizontal swipe carousel — same ListingCard used everywhere else,
          presented as slide cards the user swipes left/right through
          instead of a grid. */}
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
            <ListingCard listing={l} />
          </div>
        ))}
      </div>
      {/* Scroll progress line — visual cue that the row is scrollable,
          without relying on the user discovering it by dragging. */}
      {canScroll && (
        <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden max-w-[120px] mx-auto sm:mx-0">
          <div
            className="h-full bg-primary/60 rounded-full transition-transform duration-150 ease-out"
            style={{
              width: "40%",
              transform: `translateX(${scrollPct * 150}%)`,
            }}
          />
        </div>
      )}
    </section>
  )
}
