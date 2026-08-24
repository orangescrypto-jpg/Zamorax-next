"use client"
// app/(public)/page.tsx
// Homepage — conversion-optimised section order:
// Hero → TrustBar → GroupBuy → CategoryGrid → FlashDeals → PromoStrip
//   → FeaturedListings → ZamoraxDirect → CategoryListings → RecentlyViewed
//   → HowItWorks → Blog → Seller CTA

import { Hero }               from "@/components/home/Hero"
import { HeaderBanner }        from "@/components/shared/HeaderBanner"
import { HeaderBannerSlider }  from "@/components/shared/HeaderBannerSlider"
import { TrustBar }           from "@/components/home/TrustBar"
import { CategoryGrid }       from "@/components/home/CategoryGrid"
import { HowItWorks }         from "@/components/home/HowItWorks"
import { FlashDealsSection }  from "@/components/home/FlashDealsSection"
import { PromoStrip }         from "@/components/home/PromoStrip"
import { FlashSaleListingsSection } from "@/components/home/FlashSaleListingsSection"
import { FeaturedListings }   from "@/components/home/FeaturedListings"
import { ZamoraxDirectSection } from "@/components/home/ZamoraxDirectSection"
import { FreeDeliverySection } from "@/components/home/FreeDeliverySection"
import { GroupBuySection }    from "@/components/home/GroupBuySection"
import { CategoryListings }   from "@/components/home/CategoryListings"
import { RecentlyViewedRow }  from "@/components/home/RecentlyViewedRow"
import { BlogPreview }        from "@/components/home/BlogPreview"
import { Button }             from "@/components/ui/button"
import { useRouter }          from "next/navigation"
import { useAuth }            from "@/hooks/useAuth"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"
import { Zap }                from "lucide-react"
import { useState }           from "react"

export default function HomePage() {
  const router = useRouter()
  const { isAuthenticated, isSeller } = useAuth()
  const { settings } = usePlatformSettings()
  const [featuredIds, setFeaturedIds] = useState<string[]>([])
  const [directIds, setDirectIds] = useState<string[]>([])

  const handleStartSelling = () => {
    if (!isAuthenticated()) router.push("/register")
    else if (isSeller())    router.push("/dashboard/seller/post")
    else                    router.push("/dashboard/become-seller")
  }

  return (
    <>
      {/* 0 — Site-wide header promo/CTA strip, admin-managed, renders nothing if empty */}
      <HeaderBanner />

      {/* 0.5 — Large rotating header slider (Jumia-style), admin-managed,
          separate placement from the strip above — renders nothing if no
          slides are active */}
      <HeaderBannerSlider />

      {/* 1 — Hero + search */}
      {settings.homepageHeroBannerEnabled && <Hero />}

      {/* 2 — Platform stats trust bar (replaces old icon-only TrustBar) */}
      <TrustBar />

      <main className="container py-6 space-y-8">

        {/* 2.5 — Group Buy teaser — surfaces open group buys so buyers can
            discover the feature without already knowing /group-buy exists.
            Gated on settings.groupBuyEnabled; renders nothing if no open
            groups. */}
        <GroupBuySection />

        {/* 3 — Categories — buyers want to browse immediately */}
        <CategoryGrid />

        {/* 4 — Flash Deals — urgency / time-limited offers */}
        {settings.flashDealsEnabled && <FlashDealsSection />}

        {/* 5 — Promo banners — editorial / category spotlights */}
        <PromoStrip />

        {/* 5.5 — Flash Sale — individual seller listings currently running
            a flashDeal discount (per-listing, set by the seller). Separate
            from FlashDealsSection above, which is the admin-managed banner
            row. Same data source as the /flash-deals page it links to. */}
        <FlashSaleListingsSection />

        {/* 6 — Featured / Boosted Listings */}
        {settings.homepageFeaturedListingsEnabled && <FeaturedListings onLoaded={setFeaturedIds} />}

        {/* 6.5 — Zamorax Direct: official Zamorax Enterprises listings —
            bulk-sourced, locally warehoused stock. Placed right after
            Featured Listings so it reads as another curated/trust row.
            Now a horizontal swipe carousel; these listings also appear
            further down in "All Sellers" (they're no longer hidden from
            normal search) — onLoaded feeds excludeIds below so the same
            item doesn't render twice back-to-back on the homepage. */}
        <ZamoraxDirectSection onLoaded={setDirectIds} />

        {/* 6.7 — Free Delivery — listings with delivery fee override = 0.
            Admin-toggled at /admin/sub-settings (freeDeliveryEnabled /
            freeDeliveryCount); full list always at /free-delivery. */}
        <FreeDeliverySection />

        {/* 7 — Live listings by category */}
        <CategoryListings excludeIds={[...featuredIds, ...directIds]} />

        {/* 8 — Recently Viewed — re-engage returning visitors */}
        {settings.recentlyViewedEnabled && <RecentlyViewedRow />}

        {/* 9 — Blog / content */}
        {settings.blogEnabled && <BlogPreview />}

        {/* 10 — How It Works — explainer for first-time visitors, now lower
            so returning buyers reach deals/listings faster */}
        <HowItWorks />

        {/* 11 — Seller CTA */}
        <section className="relative overflow-hidden bg-secondary rounded-2xl p-6 md:p-10 text-center">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/10 pointer-events-none" />
          <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-accent/10 pointer-events-none" />

          <div className="relative z-10 space-y-4 max-w-lg mx-auto">
            <span className="inline-block bg-primary/20 text-primary text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
              For Sellers
            </span>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">
              Start Selling Today.<br />
              <span className="text-primary">Zero listing fees.</span>
            </h2>
            <p className="text-white/60 text-sm">
              Reach millions of buyers across Nigeria. Get paid safely via escrow.
            </p>
            <Button
              onClick={handleStartSelling}
              className="bg-primary hover:bg-primary/90 text-white font-bold px-8 py-3 rounded-xl"
            >
              <Zap className="mr-1.5 h-4 w-4" />
              Start Selling Free
            </Button>
          </div>
        </section>

      </main>
    </>
  )
}
