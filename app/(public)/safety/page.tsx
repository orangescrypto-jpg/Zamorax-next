import type { Metadata } from "next"
import { PageContentRenderer } from "@/components/PageContentRenderer"

export const metadata: Metadata = {
  title: "Safety Guidelines — Zamorax",
  description: "Learn how Zamorax protects you with escrow, verification, category-specific checks, and our insurance pool.",
}

const DEFAULT_HTML = `
<div class="space-y-8">
  <h1 class="text-3xl md:text-4xl font-heading font-bold">Safety Guidelines</h1>
  <p class="text-muted-foreground">Your safety is our top priority. Here's how we protect every transaction.</p>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">🔒 Escrow Protection</h2>
    <p>Your payment is held securely until you confirm the item matches the listing. Never release funds before inspecting your order.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">✅ Identity Verification</h2>
    <p>All sellers must complete NIN + BVN verification before listing. Verified badges indicate identity has been confirmed by our system.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">📦 Category-Specific Checks</h2>
    <ul class="list-disc pl-6 space-y-2 text-muted-foreground">
      <li><strong>Electronics:</strong> IMEI verification for phones, boot video for laptops</li>
      <li><strong>Fashion Rentals:</strong> Hygiene seal required before dispatch</li>
      <li><strong>Groceries/Perishables:</strong> Expiry date validation at listing stage</li>
      <li><strong>Vehicles:</strong> Plate number and ownership document verification</li>
    </ul>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">🛡️ Community Insurance Pool</h2>
    <p>0.5% of every transaction contributes to our community insurance pool, which covers verified losses from fraud or item-not-received disputes.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">⚠️ Red Flags to Avoid</h2>
    <ul class="list-disc pl-6 space-y-2 text-muted-foreground">
      <li>Sellers asking to pay outside the platform</li>
      <li>Prices that seem too good to be true</li>
      <li>Unverified sellers with new accounts and no reviews</li>
      <li>Requests to share OTPs or bank PINs</li>
    </ul>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">Report a Problem</h2>
    <p>See something suspicious? Use the "Report" button on any listing or contact us at safety@zamorax.com</p>
  </section>
</div>
`

export default function SafetyPage() {
  return (
    <div className="container py-12 max-w-4xl">
      <PageContentRenderer slug="safety" defaultHtml={DEFAULT_HTML} />
    </div>
  )
}
