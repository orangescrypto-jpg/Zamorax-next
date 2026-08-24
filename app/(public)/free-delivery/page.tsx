"use client"

import { useEffect, useState } from "react"
import { ListingCard } from "@/components/listings/ListingCard"
import { Truck, Loader2 } from "lucide-react"
import type { Listing } from "@/src/types"

export default function FreeDeliveryPage() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/listings/free-delivery?limit=100")
      .then(r => r.json())
      .then((data: { listings?: Listing[] }) => setListings(data.listings ?? []))
      .catch(() => setListings([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="container py-6 pb-24 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-full bg-blue-50">
          <Truck className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold">Free Delivery</h1>
          <p className="text-sm text-muted-foreground">No delivery fee on these listings.</p>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      )}

      {!loading && listings.length === 0 && (
        <div className="text-center py-24 space-y-3">
          <Truck className="h-12 w-12 mx-auto opacity-20" />
          <p className="text-muted-foreground">No free delivery listings right now. Check back soon!</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {listings.map(listing => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </main>
  )
}
