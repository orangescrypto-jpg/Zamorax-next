// app/api/site-banners/route.ts
// Public, unauthenticated read for the header/footer promo banners.
// HeaderBanner/FooterBanner were going through AdminService._ref_() ->
// /api/d1/query, which requires a valid Supabase session on every request
// (by design, since it's the shared proxy for all authenticated app data).
// That meant logged-out visitors — most of the traffic on a public
// homepage — got a silent 401, swallowed into an empty snapshot by the
// onSnapshot shim, so the banner just never showed for anyone not logged in.
// This route is a dedicated public GET so banners work for every visitor,
// matching the pattern used by /api/config and /api/admin/settings.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

export async function GET(req: NextRequest, context: RouteContext) {
  const nativeDB = (context as any)?.env?.DB
  const placement = req.nextUrl.searchParams.get("placement") // "header" | "footer" | null (both)

  try {
    const sql = placement
      ? `SELECT id, placement, title, subtitle, cta_label, href, image_url, media_type, bg_color, text_color, active, "order"
         FROM site_banners WHERE active = 1 AND placement = ? ORDER BY "order" ASC`
      : `SELECT id, placement, title, subtitle, cta_label, href, image_url, media_type, bg_color, text_color, active, "order"
         FROM site_banners WHERE active = 1 ORDER BY "order" ASC`
    const result = await d1Query(sql, placement ? [placement] : [], nativeDB)
    const rows = (result as any)?.results ?? []

    const banners = rows.map((r: any) => ({
      id:         r.id,
      placement:  r.placement,
      title:      r.title,
      subtitle:   r.subtitle,
      ctaLabel:   r.cta_label,
      href:       r.href,
      imageUrl:   r.image_url,
      mediaType:  r.media_type || "image",
      bgColor:    r.bg_color,
      textColor:  r.text_color,
      active:     !!r.active,
      order:      r.order,
    }))

    return NextResponse.json({ banners })
  } catch (err: any) {
    return NextResponse.json({ banners: [], error: err.message }, { status: 200 })
  }
}
