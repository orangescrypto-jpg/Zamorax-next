import type { Metadata } from "next"
import { PageContentRenderer } from "@/components/PageContentRenderer"

export const metadata: Metadata = {
  title: "Privacy Policy — Zamorax",
  description: "Learn how Zamorax collects, secures, and protects your data. NDPR compliant.",
}

const DEFAULT_HTML = `
<div class="space-y-8">
  <h1 class="text-3xl md:text-4xl font-heading font-bold">Privacy Policy</h1>
  <p class="text-muted-foreground">Last Updated: May 2026</p>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">1. Who We Are</h2>
    <p>Zamorax is a Nigerian-first marketplace built on trust, transparency, and secure transactions. We connect buyers, sellers, and renters across Nigeria with verified identities, protected payments, and clear dispute resolution. This policy explains how we collect, use, store, and protect your personal data in compliance with the Nigeria Data Protection Regulation (NDPR).</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">2. Information We Collect</h2>
    <ul class="list-disc pl-6 space-y-2 text-muted-foreground">
      <li><strong>Account Data:</strong> Name, email, phone number, profile photo, and state of residence.</li>
      <li><strong>Verification Data:</strong> NIN, BVN (hashed and transmitted securely — never stored in plain text).</li>
      <li><strong>Transaction Data:</strong> Order history, escrow details, payment references, dispute records.</li>
      <li><strong>Device & Usage Data:</strong> IP address, browser type, pages visited, and interaction logs for security and analytics.</li>
    </ul>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">3. How We Use Your Data</h2>
    <p>We use your data to provide, secure, and improve the Zamorax marketplace. This includes verifying your identity, processing transactions, resolving disputes, sending platform notifications, and detecting fraud.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">4. Data Sharing</h2>
    <p>We do not sell your data. We share data only with: (a) payment processors for transaction completion, (b) logistics partners for delivery fulfillment, and (c) regulatory authorities when legally required.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">5. Your Rights</h2>
    <p>Under NDPR, you have the right to access, correct, or delete your data. Contact us at privacy@zamorax.com to exercise your rights.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">6. Contact</h2>
    <p>Data Controller: Zamorax Enterprises Limited (RC9678731), Ibadan, Nigeria. Email: privacy@zamorax.com</p>
  </section>
</div>
`

export default function PrivacyPage() {
  return (
    <div className="container py-12 max-w-4xl">
      <PageContentRenderer slug="privacy" defaultHtml={DEFAULT_HTML} />
    </div>
  )
}
