"use client"
// components/shared/HeaderBannerSlider.tsx
// Large rotating homepage slider (Jumia-style), admin-managed via
// /admin/site-banners (placement = "header_slider"). Separate from
// HeaderBanner.tsx (the single-banner text/color strip) — this one shows
// every active slide for the placement and auto-rotates between them with
// dots, instead of only ever rendering banners[0]. Renders null whenever
// there are no active slides — never leaves an empty gap.

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

interface SiteBanner {
  id: string
  placement: "header" | "header_slider" | "footer"
  title?: string
  subtitle?: string
  ctaLabel?: string
  href?: string
  imageUrl?: string
  mediaType?: "image" | "video"
  bgColor?: string
  textColor?: string
  active: boolean
  order: number
}

const AUTOPLAY_MS = 5000

export function HeaderBannerSlider() {
  const [banners, setBanners] = useState<SiteBanner[]>([])
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const dragStartX = useRef(0)
  const dragDeltaX = useRef(0)
  const isDragging = useRef(false)
  const suppressClick = useRef(false)
  const [dragOffsetPct, setDragOffsetPct] = useState(0)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const res = await fetch("/api/site-banners?placement=header_slider", { cache: "no-store" })
        const json = await res.json()
        if (!active) return
        setBanners((json?.banners as SiteBanner[]) ?? [])
      } catch {
        if (active) setBanners([])
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    const pollInterval = setInterval(load, 60_000)
    return () => { active = false; clearInterval(pollInterval) }
  }, [])

  // Clamp index if the banner list shrinks (e.g. admin deactivates one)
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

  // Autoplay — only runs with more than one slide, pauses cleanly on unmount
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

  // Pause autoplay while dragging, resume a beat after release.
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

    if (Math.abs(dragDeltaX.current) > 5) {
      suppressClick.current = true
    }

    if (draggedPct <= -0.15 && index < banners.length - 1) {
      setIndex(i => i + 1)
    } else if (draggedPct >= 0.15 && index > 0) {
      setIndex(i => i - 1)
    } else if (draggedPct <= -0.15 && index === banners.length - 1) {
      setIndex(0)
    } else if (draggedPct >= 0.15 && index === 0) {
      setIndex(banners.length - 1)
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

  if (loading || banners.length === 0) return null

  return (
    <div className="relative w-full overflow-hidden">
      <div
        ref={trackRef}
        className={`flex select-none touch-pan-y ${isDragging.current ? "" : "transition-transform duration-500 ease-out"}`}
        style={{ transform: `translateX(calc(-${index * 100}% + ${dragOffsetPct}%))` }}
        onTouchStart={e => onDragStart(e.touches[0].clientX)}
        onTouchMove={e => onDragMove(e.touches[0].clientX)}
        onTouchEnd={onDragEnd}
        onMouseDown={e => onDragStart(e.clientX)}
        onMouseMove={e => { if (isDragging.current) onDragMove(e.clientX) }}
        onMouseUp={onDragEnd}
        onMouseLeave={() => { if (isDragging.current) onDragEnd() }}
        onClickCapture={onTrackClickCapture}
      >
        {banners.map(banner => {
          const bg   = banner.bgColor   || "#FF6B00"
          const text = banner.textColor || "#FFFFFF"

          const slideInner = banner.imageUrl ? (
            banner.mediaType === "video" ? (
              <video
                src={banner.imageUrl}
                className="w-full h-auto block"
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              <img
                src={banner.imageUrl}
                alt={banner.title || ""}
                className="w-full h-auto block"
              />
            )
          ) : (
            <div
              className="w-full flex flex-col items-center justify-center gap-2 px-6 py-10 sm:py-14 text-center"
              style={{ backgroundColor: bg, color: text }}
            >
              {banner.title && <h2 className="text-xl sm:text-2xl font-extrabold">{banner.title}</h2>}
              {banner.subtitle && <p className="opacity-90 text-sm sm:text-base">{banner.subtitle}</p>}
              {banner.ctaLabel && (
                <span
                  className="mt-1 inline-flex items-center justify-center px-5 py-2.5 rounded-full font-semibold text-sm bg-white/95"
                  style={{ color: bg }}
                >
                  {banner.ctaLabel}
                </span>
              )}
            </div>
          )

          return (
            <div key={banner.id} className="w-full shrink-0">
              {banner.href ? (
                <Link href={banner.href} className="block">{slideInner}</Link>
              ) : slideInner}
            </div>
          )
        })}
      </div>

      {/* Dots — only shown with more than one slide */}
      {banners.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          {banners.map((banner, i) => (
            <button
              key={banner.id}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-5 bg-white" : "w-1.5 bg-white/50"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
