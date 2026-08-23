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

  // Autoplay — only runs with more than one slide, pauses cleanly on unmount
  useEffect(() => {
    if (banners.length <= 1) return
    timerRef.current = setInterval(() => {
      setIndex(i => (i + 1) % banners.length)
    }, AUTOPLAY_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [banners.length])

  if (loading || banners.length === 0) return null

  const goTo = (i: number) => {
    setIndex(i)
    // Restart the autoplay countdown from a manual dot tap so it doesn't
    // immediately jump again right after the user picked one.
    if (timerRef.current) clearInterval(timerRef.current)
    if (banners.length > 1) {
      timerRef.current = setInterval(() => {
        setIndex(cur => (cur + 1) % banners.length)
      }, AUTOPLAY_MS)
    }
  }

  return (
    <div className="relative w-full overflow-hidden">
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {banners.map(banner => {
          const bg   = banner.bgColor   || "#FF6B00"
          const text = banner.textColor || "#FFFFFF"

          const slideInner = banner.imageUrl ? (
            <img
              src={banner.imageUrl}
              alt={banner.title || ""}
              className="w-full h-auto block"
            />
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
