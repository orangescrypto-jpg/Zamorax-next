import { Navbar } from "@/components/layout/Navbar"
import { CategoryTabBar } from "@/components/layout/CategoryTabBar"
import { Footer } from "@/components/layout/Footer"
import { BottomNav } from "@/components/layout/BottomNav"
import { FooterBanner } from "@/components/shared/FooterBanner"
import { FooterBannerSlider } from "@/components/shared/FooterBannerSlider"
import { CartAbandonmentReminder } from "@/components/cart/CartAbandonmentReminder"

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <CategoryTabBar />
      {/* pt-16 clears the fixed Navbar; CategoryTabBar is sticky (not fixed)
          and sits in normal flow right after it, so no extra offset needed
          for it specifically. */}
      <main className="flex-1 pt-16">
        {children}
      </main>
      <FooterBannerSlider />
      <FooterBanner />
      <Footer />
      <BottomNav />
      <CartAbandonmentReminder />
    </>
  )
}
