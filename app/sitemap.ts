// app/sitemap.ts
// WAS FIREBASE ADMIN → NOW CLOUDFLARE D1 via AdminService
import { AdminService } from "@/src/services/admin"
import type { MetadataRoute } from "next"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://zamorax.com"
  const now  = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/listings`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/blog`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ]

  try {
    const listings = await AdminService.getCollection("listings") as { id: string; updated_at?: string; updatedAt?: string }[]
    const listingRoutes: MetadataRoute.Sitemap = listings
      .filter(l => (l as any).is_active || (l as any).isActive)
      .slice(0, 5000)
      .map(l => ({
        url: `${base}/listings/${l.id}`,
        lastModified: new Date(l.updated_at ?? l.updatedAt ?? now),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      }))
    return [...staticRoutes, ...listingRoutes]
  } catch {
    return staticRoutes
  }
}
