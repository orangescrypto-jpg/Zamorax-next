"use client"
// components/shared/HeaderBanner.tsx
// Long horizontal promo/CTA strip for the homepage header, admin-managed via
// /admin/site-banners (placement = "header"). Renders null (no empty space,
// no placeholder) whenever there's no active banner — never assume one exists.
//
// FIX: this used to go through AdminService._ref_()/onSnapshot, which calls
// /api/d1/query — a proxy that requires a logged-in session on every
// request. Logged-out visitors (most of a public homepage's traffic) got a
// silent 401, so the banner never showed unless you were signed in. Now
// fetches from the public, unauthenticated /api/site-banners route instead.

import { useEffect, useState } from "react"
import Link from "next/link"
import { X } from "lucide-react"

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

export function HeaderBanner() {
  const [banner, setBanner]     = useState<SiteBanner | null>(null)
  const [loading, setLoading]   = useState(true)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const res = await fetch("/api/site-banners?placement=header", { cache: "no-store" })
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

  // Re-show a newly-changed banner even if a previous one (different id) was dismissed this session
  useEffect(() => { setDismissed(false) }, [banner?.id])

  if (loading || !banner || dismissed) return null

  const bg   = banner.bgColor   || "#FF6B00"
  const text = banner.textColor || "#FFFFFF"

  // If an image was uploaded, it replaces the title/subtitle/color layout
  // entirely — the image itself is the banner, only the link + dismiss
  // button still apply.
  if (banner.imageUrl) {
    const imageContent = (
      <div className="w-full relative">
        {banner.mediaType === "video" ? (
          <video src={banner.imageUrl} className="w-full h-auto block" autoPlay muted loop playsInline />
        ) : (
          <img src={banner.imageUrl} alt={banner.title || ""} className="w-full h-auto block" />
        )}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDismissed(true) }}
          className="absolute top-1/2 -translate-y-1/2 right-3 p-1 rounded-full bg-black/40 hover:bg-black/60 transition-colors"
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4 text-white" />
        </button>
      </div>
    )
    return banner.href ? (
      <Link href={banner.href} className="block">{imageContent}</Link>
    ) : imageContent
  }

  const content = (
    <div
      className="w-full flex items-center justify-center gap-3 px-4 py-2.5 text-sm sm:text-base font-medium relative"
      style={{ backgroundColor: bg, color: text }}
    >
      <div className="flex items-center gap-2 flex-wrap justify-center text-center">
        {banner.title && <span className="font-bold">{banner.title}</span>}
        {banner.subtitle && <span className="opacity-90">{banner.subtitle}</span>}
        {banner.ctaLabel && (
          <span className="underline underline-offset-2 font-semibold ml-1">
            {banner.ctaLabel} →
          </span>
        )}
      </div>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDismissed(true) }}
        className="absolute right-3 p-1 rounded-full hover:bg-black/10 transition-colors"
        aria-label="Dismiss banner"
      >
        <X className="h-4 w-4" style={{ color: text }} />
      </button>
    </div>
  )

  return banner.href ? (
    <Link href={banner.href} className="block">{content}</Link>
  ) : content
}
