import type { Metadata } from "next"
import { PageContentRenderer } from "@/components/PageContentRenderer"

export const metadata: Metadata = {
  title: "Cookie Policy — Zamorax",
  description: "How Zamorax uses cookies and tracking technologies.",
}

const DEFAULT_HTML = `
<div class="space-y-8">
  <h1 class="text-3xl md:text-4xl font-heading font-bold">Cookie Policy</h1>
  <p class="text-muted-foreground">Last Updated: May 2026</p>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">What Are Cookies?</h2>
    <p>Cookies are small text files stored on your device when you visit a website. They help us remember your preferences, keep you logged in, and understand how you use Zamorax.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">Cookies We Use</h2>
    <ul class="list-disc pl-6 space-y-2 text-muted-foreground">
      <li><strong>Essential Cookies:</strong> Required for login sessions and security. Cannot be disabled.</li>
      <li><strong>Analytics Cookies:</strong> Help us understand page traffic and improve the platform (e.g. Google Analytics).</li>
      <li><strong>Preference Cookies:</strong> Remember your language, currency, and display settings.</li>
    </ul>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">Managing Cookies</h2>
    <p>You can disable non-essential cookies via your browser settings. Note that disabling cookies may affect platform functionality, including staying logged in.</p>
  </section>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">Contact</h2>
    <p>Questions about cookies? Email us at privacy@zamorax.com</p>
  </section>
</div>
`

export default function CookiePolicyPage() {
  return (
    <div className="container py-12 max-w-4xl">
      <PageContentRenderer slug="cookies" defaultHtml={DEFAULT_HTML} />
    </div>
  )
}
