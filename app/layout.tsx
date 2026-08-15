// app/layout.tsx
import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import { AnnouncementBar } from "@/components/shared/AnnouncementBar"
import { ReferralCapture } from "@/components/shared/ReferralCapture"
import PWARegistrar from "@/components/shared/PWARegistrar"
import ChatbotWidget from "@/components/shared/ChatbotWidget"
import InstallBanner from "@/components/shared/InstallBanner"
import PushNotificationPrompt from "@/components/shared/PushNotificationPrompt"
import { WhatsAppSupport } from "@/components/shared/WhatsAppSupport"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"

const inter = Inter({ subsets: ["latin"] })

const BASE_URL = "https://zamorax.com"

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default:  "Zamorax — Buy, Sell & Rent Across Nigeria",
    template: "%s | Zamorax",
  },
  description:
    "Nigeria's safest marketplace. Buy, sell and rent phones, laptops, fashion, cars & more. Verified sellers, escrow-protected payments, and nationwide delivery.",
  keywords: [
    "buy and sell Nigeria",
    "Nigerian marketplace",
    "sell phone Nigeria",
    "buy laptop Nigeria",
    "Zamorax",
    "escrow Nigeria",
    "verified sellers Nigeria",
    "rent Nigeria",
    "online marketplace Nigeria",
  ],
  authors:   [{ name: "Zamorax", url: BASE_URL }],
  creator:   "Zamorax",
  publisher: "Zamorax",
  robots: {
    index: true, follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    type:      "website",
    locale:    "en_NG",
    url:       BASE_URL,
    siteName:  "Zamorax",
    title:     "Zamorax — Buy, Sell & Rent Across Nigeria",
    description:
      "Nigeria's safest marketplace. Verified sellers, escrow payments, nationwide delivery.",
    images: [{
      url:    `${BASE_URL}/og-default.jpg`,
      width:  1200,
      height: 630,
      alt:    "Zamorax Marketplace",
    }],
  },
  twitter: {
    card:        "summary_large_image",
    site:        "@zamoraxng",
    creator:     "@zamoraxng",
    title:       "Zamorax — Buy, Sell & Rent Across Nigeria",
    description: "Nigeria's safest marketplace. Verified sellers, escrow payments.",
    images:      [`${BASE_URL}/og-default.jpg`],
  },
  alternates: { canonical: BASE_URL },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  verification: {
    // Add your Google Search Console verification code here when you have it
    // google: "your-google-verification-code",
  },
}

// Ensures the page renders at true mobile width instead of a shrunk-down
// desktop layout. maximumScale is capped but pinch-zoom is still allowed
// (no user-scalable: false) so the site stays accessible.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#f97316",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Zamorax" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icon-512.png" />
      </head>
      <body className={inter.className}>
        <Providers>
          <Suspense fallback={null}>
            <ReferralCapture />
          </Suspense>
          <AnnouncementBar />
          {children}
        </Providers>
        <PWARegistrar />
        <ChatbotWidget />
        <InstallBanner />
        <PushNotificationPrompt />
        <WhatsAppSupport />
      </body>
    </html>
  )
}
