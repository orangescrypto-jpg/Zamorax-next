"use client"
// components/shared/FooterBannerSlider.tsx
// Sliding carousel of footer-placement site banners, admin-managed via
// /admin/site-banners. Renders above FooterBanner. Auto-advances every
// 5s and pauses on hover/touch; dots below allow manual navigation.
// Renders null when there are 0 or 1 active banners (nothing to slide).

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"

interface SiteBanner {
  id: string
  placement: "header" | "header_slider" | "footer" | "footer_slider"
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

const AUTO_SLIDE_MS = 3000

function BannerSlide({ banner }: { banner: SiteBanner }) {
  const bg   = banner.bgColor   || "#FF6B00"
  const text = banner.textColor || "#FFFFFF"

  if (banner.imageUrl) {
    const imageInner = banner.mediaType === "video" ? (
      <video
        src={banner.imageUrl}
        className="w-full h-auto rounded-2xl block"
        autoPlay
        muted
        loop
        playsInline
      />
    ) : (
      <img
        src={banner.imageUrl}
        alt={banner.title || ""}
        className="w-full h-auto rounded-2xl block"
        draggable={false}
      />
    )
    return banner.href ? (
      <Link href={banner.href} className="block">{imageInner}</Link>
    ) : imageInner
  }

  const inner = (
    <div
      className="relative overflow-hidden rounded-2xl px-6 py-8 sm:px-10 sm:py-10 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left"
      style={{ backgroundColor: bg, color: text }}
    >
      <div className="flex-1 min-w-0">
        {banner.title && <h3 className="text-xl sm:text-2xl font-extrabold mb-1">{banner.title}</h3>}
        {banner.subtitle && <p className="opacity-90 text-sm sm:text-base">{banner.subtitle}</p>}
      </div>
      {banner.ctaLabel && (
        <span
          className="shrink-0 inline-flex items-center justify-center px-6 py-3 rounded-full font-semibold text-sm bg-white/95 hover:bg-white transition-colors"
          style={{ color: bg }}
        >
          {banner.ctaLabel}
        </span>
      )}
    </div>
  )

  return banner.href ? <Link href={banner.href} className="block">{inner}</Link> : inner
}

export function FooterBannerSlider() {
  const [banners, setBanners] = useState<SiteBanner[]>([])
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)

  const dragStartX = useRef(0)
  const dragStartY = useRef(0)
  const dragDeltaX = useRef(0)
  const isDragging = useRef(false)
  const suppressClick = useRef(false)
  // Once a touch sequence is confirmed horizontal, we call preventDefault()
  // on subsequent touchmoves so the browser stops trying to vertically
  // scroll the page mid-swipe — see the manual non-passive listener below.
  const horizontalLock = useRef(false)
  const [dragOffsetPct, setDragOffsetPct] = useState(0)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const res = await fetch("/api/site-banners?placement=footer_slider", { cache: "no-store" })
        const json = await res.json()
        if (!active) return
        const list = Array.isArray(json?.banners) ? (json.banners as SiteBanner[]) : []
        setBanners(list)
      } catch {
        if (active) setBanners([])
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    const refreshInterval = setInterval(load, 60_000)
    return () => { active = false; clearInterval(refreshInterval) }
  }, [])

  // Clamp index if the banner list shrinks
  useEffect(() => {
    if (index >= banners.length) setIndex(0)
  }, [banners.length, index])

  const goTo = useCallback((i: number) => {
    if (banners.length === 0) return
    setIndex(((i % banners.length) + banners.length) % banners.length)
  }, [banners.length])

  const next = useCallback(() => goTo(index + 1), [goTo, index])

  // Auto-slide
  useEffect(() => {
    if (banners.length <= 1 || paused) return
    const timer = setInterval(next, AUTO_SLIDE_MS)
    return () => clearInterval(timer)
  }, [banners.length, paused, next])

  const onDragStart = (clientX: number, clientY = 0) => {
    isDragging.current = true
    dragStartX.current = clientX
    dragStartY.current = clientY
    dragDeltaX.current = 0
    horizontalLock.current = false
    setPaused(true)
  }

  const onDragMove = (clientX: number, clientY = 0) => {
    if (!isDragging.current || !trackRef.current) return
    dragDeltaX.current = clientX - dragStartX.current
    const deltaY = clientY - dragStartY.current

    // Decide direction once, after a few px of movement, so a tap doesn't
    // false-trigger and a genuine vertical scroll isn't hijacked.
    if (!horizontalLock.current && (Math.abs(dragDeltaX.current) > 8 || Math.abs(deltaY) > 8)) {
      horizontalLock.current = Math.abs(dragDeltaX.current) > Math.abs(deltaY)
    }

    const widthPx = trackRef.current.clientWidth || 1
    setDragOffsetPct((dragDeltaX.current / widthPx) * 100)
  }

  const onDragEnd = () => {
    if (!isDragging.current) return
    isDragging.current = false
    horizontalLock.current = false
    const widthPx = trackRef.current?.clientWidth || 1
    const draggedPct = dragDeltaX.current / widthPx

    if (Math.abs(dragDeltaX.current) > 5) {
      suppressClick.current = true
    }

    if (draggedPct <= -0.15) {
      goTo(index + 1)
    } else if (draggedPct >= 0.15) {
      goTo(index - 1)
    }

    setDragOffsetPct(0)
    setPaused(false)
  }

  const onTrackClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault()
      e.stopPropagation()
      suppressClick.current = false
    }
  }

  // React binds touchmove as a passive listener by default, which silently
  // ignores preventDefault(). Bind it manually as non-passive so we can
  // actually stop the page's vertical scroll once a horizontal swipe is
  // detected — otherwise the browser wins the gesture on most mobile
  // browsers and the drag never visibly moves the slider on touch devices.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      onDragMove(touch.clientX, touch.clientY)
      if (horizontalLock.current && e.cancelable) e.preventDefault()
    }
    el.addEventListener("touchmove", handleTouchMove, { passive: false })
    return () => el.removeEventListener("touchmove", handleTouchMove)
  }, [banners.length])

  if (loading || banners.length === 0) return null

  return (
    <div className="container py-6">
      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => { setPaused(false); if (isDragging.current) onDragEnd() }}
      >
        <div ref={trackRef} className="overflow-hidden rounded-2xl">
          <div
            className={`flex select-none touch-pan-y ${isDragging.current ? "" : "transition-transform duration-500 ease-out"}`}
            style={{ transform: `translateX(calc(-${index * 100}% + ${dragOffsetPct}%))` }}
            onTouchStart={e => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchEnd={onDragEnd}
            onMouseDown={e => onDragStart(e.clientX)}
            onMouseMove={e => { if (isDragging.current) onDragMove(e.clientX) }}
            onMouseUp={onDragEnd}
            onClickCapture={onTrackClickCapture}
          >
            {banners.map((banner) => (
              <div key={banner.id} className="w-full shrink-0">
                <BannerSlide banner={banner} />
              </div>
            ))}
          </div>
        </div>

        {banners.length > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            {banners.map((banner, i) => (
              <button
                key={banner.id}
                type="button"
                aria-label={`Go to banner ${i + 1}`}
                aria-current={i === index}
                onClick={() => goTo(i)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === index ? "w-6 bg-primary" : "w-2 bg-secondary-foreground/20 hover:bg-secondary-foreground/40"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
