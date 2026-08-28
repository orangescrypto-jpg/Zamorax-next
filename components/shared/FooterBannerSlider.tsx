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

  if (loading || banners.length === 0) return null

  return (
    <div className="container py-6">
      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}
      >
        <div className="overflow-hidden rounded-2xl">
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
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
