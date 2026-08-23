"use client"
// components/shared/FooterBanner.tsx
// Normal-sized promo/CTA banner shown above the site footer, admin-managed
// via /admin/site-banners (placement = "footer"). Renders null whenever
// there's no active banner — never leaves an empty gap.
//
// FIX: previously went through AdminService._ref_()/onSnapshot ->
// /api/d1/query, which requires a logged-in session — so logged-out
// visitors never saw this banner. Now uses the public /api/site-banners
// route instead (see HeaderBanner.tsx for the same fix).

import { useEffect, useState } from "react"
import Link from "next/link"

interface SiteBanner {
  id: string
  placement: "header" | "footer"
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

export function FooterBanner() {
  const [banner, setBanner] = useState<SiteBanner | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const res = await fetch("/api/site-banners?placement=footer", { cache: "no-store" })
        const json = await res.json()
        if (!active) return
        setBanner((json?.banners?.[0] as SiteBanner) ?? null)
      } catch {
        if (active) setBanner(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, 60_000)
    return () => { active = false; clearInterval(interval) }
  }, [])

  if (loading || !banner) return null

  const bg   = banner.bgColor   || "#FF6B00"
  const text = banner.textColor || "#FFFFFF"

  // If an image was uploaded, it replaces the title/subtitle/CTA/color card
  // entirely — the image itself is the banner, only the link still applies.
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
      />
    )
    return (
      <div className="container py-6">
        {banner.href ? (
          <Link href={banner.href} className="block">{imageInner}</Link>
        ) : imageInner}
      </div>
    )
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

  return (
    <div className="container py-6">
      {banner.href ? (
        <Link href={banner.href} className="block">{inner}</Link>
      ) : inner}
    </div>
  )
}
