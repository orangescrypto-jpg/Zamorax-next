"use client"
// components/home/PromoStrip.tsx
// FIX: previously used AdminService.subscribeToFeaturedBanners(), which
// polls through /api/d1/query — a proxy that requires a logged-in session.
// Logged-out visitors (most of a public homepage's traffic) got a silent
// 401 and always fell back to the hardcoded FALLBACK cards below, never
// seeing admin's actual banners. Now fetches the public, unauthenticated
// /api/featured-banners route instead.

import type { FeaturedBanner } from "@/src/services/admin"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronRight, Zap, ShieldCheck, TrendingUp, Tag, Star, Flame } from "lucide-react"

// Auto-advance interval — same rhythm as the header slider (HeaderBannerSlider.tsx)
const AUTOPLAY_MS = 4000

const ICON_MAP: Record<string, React.ReactNode> = {
  zap:      <Zap className="h-5 w-5" />,
  shield:   <ShieldCheck className="h-5 w-5" />,
  trending: <TrendingUp className="h-5 w-5" />,
  tag:      <Tag className="h-5 w-5" />,
  star:     <Star className="h-5 w-5" />,
  flame:    <Flame className="h-5 w-5" />,
}

const GRADIENT_MAP: Record<string, string> = {
  dark:   "from-secondary to-secondary/80",
  orange: "from-primary to-orange-600",
  teal:   "from-accent to-teal-600",
  purple: "from-violet-600 to-purple-700",
  green:  "from-emerald-600 to-green-700",
  red:    "from-red-600 to-rose-700",
}

const ACCENT_MAP: Record<string, string> = {
  dark:   "bg-yellow-400 text-secondary",
  orange: "bg-white/20 text-white",
  teal:   "bg-white/20 text-white",
  purple: "bg-white/20 text-white",
  green:  "bg-white/20 text-white",
  red:    "bg-white/20 text-white",
}

// Shown before the API call resolves or if admin has no active banners yet
const FALLBACK: FeaturedBanner[] = [
  { id: "f1", tag: "HOT DEALS",    title: "Phones & Tablets",    subtitle: "Verified phones at great prices",  href: "/categories/phones-tablets", imageUrl: "", color: "dark",   icon: "zap",      order: 0, active: true },
  { id: "f2", tag: "ESCROW SAFE",  title: "Laptops & Computing", subtitle: "Buy with full buyer protection",   href: "/categories/computing",       imageUrl: "", color: "orange", icon: "shield",   order: 1, active: true },
  { id: "f3", tag: "TRENDING NOW", title: "Fashion & Clothing",  subtitle: "New arrivals every day",           href: "/categories/fashion",          imageUrl: "", color: "teal",   icon: "trending", order: 2, active: true },
]

export function PromoStrip() {
  const [banners, setBanners] = useState<FeaturedBanner[]>(FALLBACK)
  const [index, setIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  // Drag/swipe state — refs so touch handlers don't need to be re-created
  // every render, plain numbers so we don't fight React's render cycle
  // mid-gesture.
  const dragStartX = useRef(0)
  const dragDeltaX = useRef(0)
  const isDragging = useRef(false)
  const suppressClick = useRef(false)
  const [dragOffsetPct, setDragOffsetPct] = useState(0) // live drag translate, 0 when not dragging

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const res = await fetch("/api/featured-banners", { cache: "no-store" })
        const json = await res.json()
        if (!active) return
        if (json?.banners?.length > 0) setBanners(json.banners as FeaturedBanner[])
        // else keep FALLBACK silently
      } catch {
        // keep FALLBACK on error
      }
    }

    load()
    const interval = setInterval(load, 120_000) // banners rarely change — poll every 2 min
    return () => { active = false; clearInterval(interval) }
  }, [])

  // Clamp index if the banner list shrinks
  useEffect(() => {
    if (index >= banners.length) setIndex(0)
  }, [banners, index])

  const startAutoplay = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (banners.length > 1) {
      timerRef.current = setInterval(() => {
        setIndex(i => (i + 1) % banners.length)
      }, AUTOPLAY_MS)
    }
  }

  // Autoplay — mirrors HeaderBannerSlider.tsx: only runs with more than one
  // card, advances one at a time, pauses cleanly on unmount.
  useEffect(() => {
    startAutoplay()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [banners.length])

  useEffect(() => {
    return () => { if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current) }
  }, [])

  const goTo = (i: number) => {
    setIndex(i)
    // Restart the autoplay countdown from a manual dot tap so it doesn't
    // immediately jump again right after the user picked one.
    startAutoplay()
  }

  // Pause autoplay while dragging, resume a beat after release so the user
  // has a moment to see where they landed before it moves again.
  const pauseAutoplayForDrag = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current)
  }
  const resumeAutoplaySoon = () => {
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current)
    resumeTimeoutRef.current = setTimeout(startAutoplay, 3000)
  }

  const onDragStart = (clientX: number) => {
    isDragging.current = true
    dragStartX.current = clientX
    dragDeltaX.current = 0
    pauseAutoplayForDrag()
  }

  const onDragMove = (clientX: number) => {
    if (!isDragging.current || !trackRef.current) return
    dragDeltaX.current = clientX - dragStartX.current
    const widthPx = trackRef.current.clientWidth || 1
    setDragOffsetPct((dragDeltaX.current / widthPx) * 100)
  }

  const onDragEnd = () => {
    if (!isDragging.current) return
    isDragging.current = false
    const widthPx = trackRef.current?.clientWidth || 1
    const draggedPct = dragDeltaX.current / widthPx

    // A real drag (moved more than a few px) should not also fire the
    // card's Link click — the next click event gets swallowed once below.
    if (Math.abs(dragDeltaX.current) > 5) {
      suppressClick.current = true
    }

    // Swiped far enough (>15% of card width) — move one slide in that
    // direction; otherwise snap back to the current slide.
    if (draggedPct <= -0.15 && index < banners.length - 1) {
      setIndex(i => i + 1)
    } else if (draggedPct >= 0.15 && index > 0) {
      setIndex(i => i - 1)
    } else if (draggedPct <= -0.15 && index === banners.length - 1) {
      setIndex(0) // loop forward from the last slide
    } else if (draggedPct >= 0.15 && index === 0) {
      setIndex(banners.length - 1) // loop back from the first slide
    }

    setDragOffsetPct(0)
    resumeAutoplaySoon()
  }

  const onTrackClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault()
      e.stopPropagation()
      suppressClick.current = false
    }
  }

  if (banners.length === 0) return null


  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-secondary">Featured Deals</h2>
      </div>

      <div className="relative overflow-hidden md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0">
        <div
          ref={trackRef}
          className={`flex gap-3 md:grid md:grid-cols-3 select-none touch-pan-y ${
            isDragging.current ? "" : "transition-transform duration-500 ease-out md:transition-none"
          }`}
          style={{ transform: `translateX(calc(-${index} * (100% + 0.75rem) + ${dragOffsetPct}%))` }}
          onTouchStart={e => onDragStart(e.touches[0].clientX)}
          onTouchMove={e => onDragMove(e.touches[0].clientX)}
          onTouchEnd={onDragEnd}
          onMouseDown={e => onDragStart(e.clientX)}
          onMouseMove={e => { if (isDragging.current) onDragMove(e.clientX) }}
          onMouseUp={onDragEnd}
          onMouseLeave={() => { if (isDragging.current) onDragEnd() }}
          onClickCapture={onTrackClickCapture}
        >
          {banners.map((banner) => {
            const gradient = GRADIENT_MAP[banner.color] ?? GRADIENT_MAP.dark
            const accent   = ACCENT_MAP[banner.color]   ?? ACCENT_MAP.dark
            const icon     = ICON_MAP[banner.icon]       ?? ICON_MAP.zap

            // If an image is set, it replaces the whole card content (same
            // "image replaces the styled design" convention as site-banners) —
            // only the link still applies.
            if (banner.imageUrl) {
              return (
                <Link
                  key={banner.id}
                  href={banner.href || "/search"}
                  className="relative w-full flex-shrink-0 md:w-auto rounded-2xl overflow-hidden group hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5 bg-muted"
                >
                  <img
                    src={banner.imageUrl}
                    alt={banner.title || banner.tag}
                    className="w-full h-full object-contain aspect-[4/3] md:aspect-video bg-muted"
                  />
                </Link>
              )
            }

            return (
              <Link
                key={banner.id}
                href={banner.href || "/search"}
                className={`
                  relative w-full flex-shrink-0 md:w-auto
                  bg-gradient-to-br ${gradient}
                  rounded-2xl p-4 flex flex-col gap-2 overflow-hidden
                  group hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5
                `}
              >
                <div className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full bg-white/5 pointer-events-none" />
                <div className="absolute -right-2 -bottom-2 w-16 h-16 rounded-full bg-white/5 pointer-events-none" />

                <span className={`self-start text-[10px] font-bold px-2 py-0.5 rounded-full ${accent}`}>
                  {banner.tag}
                </span>
                <div className="relative z-10 text-white">
                  {icon}
                  <p className="font-bold text-sm mt-1 leading-tight">{banner.title}</p>
                  <p className="text-white/70 text-xs mt-0.5">{banner.subtitle}</p>
                </div>
                <div className="flex items-center gap-1 text-white/80 text-xs font-medium mt-1">
                  Shop now <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            )
          })}
        </div>

        {/* Dots — only shown with more than one card, hidden on the md+ grid layout */}
        {banners.length > 1 && (
          <div className="flex md:hidden items-center justify-center gap-1.5 mt-3">
            {banners.map((banner, i) => (
              <button
                key={banner.id}
                onClick={() => goTo(i)}
                aria-label={`Go to deal ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-primary" : "w-1.5 bg-secondary/20"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
