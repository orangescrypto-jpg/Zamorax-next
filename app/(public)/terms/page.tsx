import type { Metadata } from "next"
import { PageContentRenderer } from "@/components/PageContentRenderer"

export const metadata: Metadata = {
  title: "Terms of Service — Zamorax",
  description: "Clear, fair rules for buying, selling, and renting on Zamorax.",
}

const DEFAULT_HTML = `
<div class="space-y-8">
  <h1 class="text-3xl md:text-4xl font-heading font-bold">Terms of Service</h1>
  <p class="text-muted-foreground">Effective Date: May 2026</p>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">1. Acceptance of Terms</h2>
    <p>By accessing or using Zamorax ("Platform"), you agree to be bound by these Terms. If you do not agree, please do not use our services. These terms apply to all visitors, buyers, sellers, and renters.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">2. Eligibility & Accounts</h2>
    <p>You must be at least 18 years old and resident in Nigeria (or an approved region) to create an account. You are responsible for all activity under your account.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">3. Escrow & Payments</h2>
    <p>All transactions on Zamorax are processed through our escrow system. Funds are held until the buyer confirms receipt. Zamorax charges a platform fee as displayed at checkout. Fees are non-refundable except in proven fraud cases.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">4. Listings & Verification</h2>
    <p>Sellers must verify their identity before listing. All listings must be accurate, legal, and compliant with our category guidelines. Zamorax reserves the right to remove listings that violate our policies.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">5. Disputes</h2>
    <p>Disputes must be filed within the inspection window. Zamorax acts as a neutral mediator. Our decisions are final after the auto-resolution period. Both parties agree to cooperate in good faith.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">6. Prohibited Conduct</h2>
    <ul class="list-disc pl-6 space-y-2 text-muted-foreground">
      <li>Listing counterfeit, illegal, or prohibited items</li>
      <li>Manipulating reviews or feedback</li>
      <li>Off-platform payments to evade escrow</li>
      <li>Impersonating other users or Zamorax staff</li>
    </ul>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">7. Changes to Terms</h2>
    <p>We may update these terms with 14 days notice via email. Continued use of the platform constitutes acceptance.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">8. Contact</h2>
    <p>Legal enquiries: legal@zamorax.com</p>
  </section>
</div>
`

export default function TermsPage() {
  return (
    <div className="container py-12 max-w-4xl">
      <PageContentRenderer slug="terms" defaultHtml={DEFAULT_HTML} />
    </div>
  )
}
