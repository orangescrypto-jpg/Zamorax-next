// app/(public)/listings/[id]/page.tsx
// Server component wrapper — handles SEO metadata + initial data fetch
// The interactive UI is in ListingDetailClient.tsx (keeps "use client")

import type { Metadata } from "next"
import { ListingDetailClient } from "@/components/listings/ListingDetailClient"
import { notFound } from "next/navigation"
import { ListingsService } from "@/src/services"
import type { Listing } from "@/src/types"

// Next.js 15: params is a Promise
interface Props {
  params: Promise<{ id: string }>
}

// ── Fetch listing server-side for metadata ────────────────────────────────────

async function getListing(id: string): Promise<Listing | null> {
  try {
    return await ListingsService.getListingById(id)
  } catch {
    return null
  }
}

// ── Dynamic metadata per listing ─────────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const listing = await getListing(id)

  if (!listing) {
    return {
      title: "Listing Not Found — Zamorax",
      description: "This listing may have been removed or sold.",
    }
  }

  const title       = `${listing.title} — ₦${((listing.priceSale || 0) / 100).toLocaleString("en-NG")} | Zamorax`
  const description = listing.description
    ? `${listing.description.slice(0, 155)}...`
    : `Buy ${listing.title} in ${listing.city || listing.nigerianState || "Nigeria"} on Zamorax. Verified seller. Escrow protected.`
  const image       = listing.images?.[0] || "https://zamorax.com/og-default.jpg"
  const url         = `https://zamorax.com/listings/${id}`
  const price       = ((listing.priceSale || 0) / 100).toFixed(2)
  const ogImageUrl  = image

  return {
    title,
    description,
    keywords: [
      listing.title,
      (listing as any).categoryName,
      listing.city,
      listing.nigerianState,
      "buy Nigeria",
      "sell Nigeria",
      "Zamorax",
      listing.condition,
    ].filter(Boolean) as string[],
    openGraph: {
      title,
      description,
      url,
      siteName: "Zamorax",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: listing.title }],
      type: "website",
      locale: "en_NG",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
      site: "@zamoraxng",
    },
    alternates: { canonical: url },
    other: {
      "product:price:amount":   price,
      "product:price:currency": "NGN",
      "product:condition":      listing.condition === "brand_new" ? "new" : "used",
      "product:availability":   listing.status === "active" ? "in stock" : "out of stock",
    },
  }
}

// ── JSON-LD structured data ───────────────────────────────────────────────────

function ListingJsonLd({ listing }: { listing: Listing }) {
  const price = ((listing.priceSale || 0) / 100).toFixed(2)
  const url   = `https://zamorax.com/listings/${listing.id}`
  // Google's Product rich-result validator rejects an empty `image` array,
  // so fall back to the site default rather than omitting the field.
  const images = listing.images && listing.images.length > 0
    ? listing.images
    : ["https://zamorax.com/og-default.jpg"]

  const schema = {
    "@context":  "https://schema.org",
    "@type":     "Product",
    name:        listing.title,
    description: listing.description || "",
    image:       images,
    url,
    offers: {
      "@type":       "Offer",
      price,
      priceCurrency: "NGN",
      availability:  listing.status === "active"
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url,
      seller: {
        "@type": "Organization",
        name:    listing.sellerName || "Zamorax Seller",
      },
    },
    ...(listing.condition === "brand_new" && {
      itemCondition: "https://schema.org/NewCondition",
    }),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ListingPage({ params }: Props) {
  const { id } = await params
  const listing = await getListing(id)
  if (!listing) notFound()

  return (
    <>
      <ListingJsonLd listing={listing!} />
      <ListingDetailClient id={id} initialListing={listing!} />
    </>
  )
}
