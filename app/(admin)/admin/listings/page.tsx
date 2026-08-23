"use client"
// app/(admin)/admin/listings/page.tsx
// All-listings admin management: pending / active / rejected / all, with
// search, approve, reject (with reason), delete, and boost/unboost.
//
// FIX: this file used to be a copy-paste of listing-boosts/page.tsx (boost
// purchase history — Live/Pending Payment/Expired), so "Listings" in the
// admin nav showed the same thing as "Listing Boosts" and there was no way
// to actually review/approve/reject the listings sellers submit. The real
// backend for this already existed at /api/admin/manage-listings (list with
// status filter + search + pagination, PATCH to approve/reject/boost,
// DELETE to remove) — it just never had a page wired up to it.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { adminFetch } from "@/lib/admin-fetch"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tabs, TabsList, TabsTrigger,
} from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  Loader2, CheckCircle2, XCircle, Trash2, Zap, ZapOff,
  Search, RefreshCw, Package, ChevronLeft, ChevronRight, ShieldCheck, Truck, Pencil,
} from "lucide-react"
import { formatPrice } from "@/lib/utils"
import Image from "next/image"

interface AdminListingRow {
  id: string
  sellerId?: string
  sellerName?: string
  title: string
  description?: string
  priceSale: number
  categorySlug?: string
  condition?: string
  images: string[]
  status: string
  isBoosted?: boolean
  isZamoraxPick?: boolean
  isOfficial?: boolean
  fulfilledBy?: "seller" | "zamorax"
  isFBZ?: boolean
  deliveryFeeOverrideKobo?: number | null
  city?: string
  views?: number
  createdAt?: string
  updatedAt?: string
}

const STATUS_TABS = [
  { value: "all",               label: "All" },
  { value: "pending",           label: "Pending" },
  { value: "pending_fbz",       label: "Pending (FBZ)" },
  { value: "pending_fbz_stock", label: "Awaiting Stock" },
  { value: "active",            label: "Active" },
  { value: "rejected",          label: "Rejected" },
] as const

const statusBadge: Record<string, string> = {
  pending:            "bg-amber-100 text-amber-700",
  pending_fbz:        "bg-amber-100 text-amber-700",
  pending_fbz_stock:  "bg-blue-100 text-blue-700",
  active:             "bg-green-100 text-green-700",
  rejected:           "bg-red-100 text-red-700",
  sold:      "bg-blue-100 text-blue-700",
  rented:    "bg-blue-100 text-blue-700",
  paused:    "bg-gray-100 text-gray-600",
  suspended: "bg-red-100 text-red-700",
  draft:     "bg-gray-100 text-gray-600",
}

export default function AdminListingsPage() {
  const { toast } = useToast()

  const [status, setStatus]     = useState<string>("pending")
  const [search, setSearch]     = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [page, setPage]         = useState(0)
  const [listings, setListings] = useState<AdminListingRow[]>([])
  const [total, setTotal]       = useState(0)
  const [hasMore, setHasMore]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)

  const [rejectOpen, setRejectOpen]     = useState(false)
  const [rejectingId, setRejectingId]   = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ status, page: String(page) })
      if (search.trim()) qs.set("search", search.trim())
      const res  = await adminFetch(`/api/admin/manage-listings?${qs.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load listings")
      const data = await res.json()
      setListings(data.listings ?? [])
      setTotal(data.total ?? 0)
      setHasMore(!!data.hasMore)
    } catch (e: any) {
      toast({ title: "Failed to load listings", description: e.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [status, page, search, toast])

  useEffect(() => { load() }, [load])

  // Reset to page 0 whenever the filter or search term changes
  useEffect(() => { setPage(0) }, [status, search])

  const runAction = async (id: string, action: "approve" | "reject" | "boost" | "unboost" | "zamorax_pick" | "zamorax_unpick" | "set_fulfilled_by_seller" | "set_fulfilled_by_zamorax" | "set_fbz_free_delivery" | "unset_fbz_free_delivery", reason?: string) => {
    setProcessingId(id)
    try {
      const res = await adminFetch("/api/admin/manage-listings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Action failed")

      const labels: Record<string, string> = {
        approve:        "Listing approved ✅",
        reject:         "Listing rejected",
        boost:          "Listing boosted ⚡",
        unboost:        "Boost removed",
        zamorax_pick:   "Added to Zamorax Enterprises Direct 🛡️",
        zamorax_unpick: "Removed from Zamorax Enterprises Direct",
        set_fulfilled_by_zamorax: "Zamorax will fulfill this listing's orders 📦",
        set_fulfilled_by_seller:  "Seller will fulfill this listing's orders again",
        set_fbz_free_delivery:    "Free delivery enabled for this listing 🚚",
        unset_fbz_free_delivery:  "Free delivery removed — normal FBZ fee applies",
      }
      toast({ title: labels[action], variant: action === "reject" ? "default" : "success" })
      await load()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally {
      setProcessingId(null)
    }
  }

  const handleDelete = async (listing: AdminListingRow) => {
    if (!confirm(`Permanently delete "${listing.title}"? This cannot be undone.`)) return
    setProcessingId(listing.id)
    try {
      const res = await adminFetch(`/api/admin/manage-listings?id=${encodeURIComponent(listing.id)}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Delete failed")
      toast({ title: "Listing deleted", variant: "default" })
      await load()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally {
      setProcessingId(null)
    }
  }

  const openReject = (id: string) => {
    setRejectingId(id)
    setRejectReason("")
    setRejectOpen(true)
  }

  const confirmReject = async () => {
    if (!rejectingId) return
    await runAction(rejectingId, "reject", rejectReason.trim())
    setRejectOpen(false)
    setRejectingId(null)
  }

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Listings</h1>
          <p className="text-sm text-muted-foreground">
            Review, approve, reject, or manage every listing on the platform.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Tabs value={status} onValueChange={setStatus}>
        <TabsList>
          {STATUS_TABS.map(t => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <form
        className="flex gap-2"
        onSubmit={e => { e.preventDefault(); setSearch(searchInput) }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by title or seller name…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : listings.length === 0 ? (
        <div className="border border-dashed rounded-xl py-16 flex flex-col items-center gap-2 text-muted-foreground">
          <Package className="h-8 w-8" />
          <p>No listings match this filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map(listing => (
            <Card key={listing.id}>
              <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0 relative">
                  {listing.images?.[0] ? (
                    <Image src={listing.images[0]} alt={listing.title} fill className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold truncate">{listing.title}</p>
                    <Badge className={`text-[10px] capitalize ${statusBadge[listing.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {listing.status}
                    </Badge>
                    {listing.isBoosted && (
                      <Badge className="text-[10px] bg-purple-100 text-purple-700">
                        <Zap className="h-2.5 w-2.5 mr-0.5" /> Boosted
                      </Badge>
                    )}
                    {listing.isZamoraxPick && (
                      <Badge className="text-[10px] bg-emerald-100 text-emerald-700">
                        <ShieldCheck className="h-2.5 w-2.5 mr-0.5" /> Zamorax Enterprises Direct
                      </Badge>
                    )}
                    {listing.isOfficial && listing.fulfilledBy === "zamorax" && (
                      <Badge className="text-[10px] bg-blue-100 text-blue-700">
                        <Package className="h-2.5 w-2.5 mr-0.5" /> Fulfilled by Zamorax
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground">{formatPrice(listing.priceSale)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {listing.sellerName ?? "Unknown seller"} · {listing.city ?? "—"} · {listing.views ?? 0} views
                  </p>
                </div>

                <div className="flex flex-row flex-wrap sm:flex-col gap-1.5 sm:flex-shrink-0 sm:w-auto">
                  <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                    <Link href={`/dashboard/seller/listings/${listing.id}/edit`}>
                      <Pencil className="h-3 w-3 mr-1" />Edit
                    </Link>
                  </Button>
                  {(listing.status === "pending" || listing.status === "pending_fbz") && (
                    <>
                      <Button
                        size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                        disabled={processingId === listing.id}
                        onClick={() => runAction(listing.id, "approve")}
                      >
                        {processingId === listing.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle2 className="h-3 w-3 mr-1" />Approve</>}
                      </Button>
                      <Button
                        size="sm" variant="destructive" className="h-7 text-xs"
                        disabled={processingId === listing.id}
                        onClick={() => openReject(listing.id)}
                      >
                        <XCircle className="h-3 w-3 mr-1" />Reject
                      </Button>
                    </>
                  )}
                  {listing.status === "active" && (
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs"
                      disabled={processingId === listing.id}
                      onClick={() => runAction(listing.id, listing.isBoosted ? "unboost" : "boost")}
                    >
                      {processingId === listing.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : listing.isBoosted ? (
                        <><ZapOff className="h-3 w-3 mr-1" />Unboost</>
                      ) : (
                        <><Zap className="h-3 w-3 mr-1" />Boost</>
                      )}
                    </Button>
                  )}
                  {listing.status === "active" && (
                    <Button
                      size="sm"
                      variant={listing.isZamoraxPick ? "secondary" : "outline"}
                      className="h-7 text-xs"
                      disabled={processingId === listing.id}
                      onClick={() => runAction(listing.id, listing.isZamoraxPick ? "zamorax_unpick" : "zamorax_pick")}
                      title={listing.isZamoraxPick
                        ? "Remove from Zamorax Enterprises Direct — restores normal store/search visibility"
                        : "Showcase under Zamorax Enterprises Direct — hides it from the seller's normal store/search while picked"}
                    >
                      {processingId === listing.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : listing.isZamoraxPick ? (
                        <><ShieldCheck className="h-3 w-3 mr-1" />Unpick</>
                      ) : (
                        <><ShieldCheck className="h-3 w-3 mr-1" />Zamorax Enterprises Direct</>
                      )}
                    </Button>
                  )}
                  {listing.status === "active" && listing.isOfficial && (
                    <Button
                      size="sm"
                      variant={listing.fulfilledBy === "zamorax" ? "secondary" : "outline"}
                      className="h-7 text-xs"
                      disabled={processingId === listing.id}
                      onClick={() => runAction(listing.id, listing.fulfilledBy === "zamorax" ? "set_fulfilled_by_seller" : "set_fulfilled_by_zamorax")}
                      title={listing.fulfilledBy === "zamorax"
                        ? "Hand fulfillment back to the seller — they'll be able to mark future orders shipped again"
                        : "Zamorax will fulfill orders for this listing — seller loses the ability to mark them shipped, but still gets paid out as normal"}
                    >
                      {processingId === listing.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : listing.fulfilledBy === "zamorax" ? (
                        <><Package className="h-3 w-3 mr-1" />Hand Back to Seller</>
                      ) : (
                        <><Package className="h-3 w-3 mr-1" />Fulfill by Zamorax</>
                      )}
                    </Button>
                  )}
                  {listing.status === "active" && (listing.isFBZ || listing.isZamoraxPick || listing.isOfficial) && (
                    <Button
                      size="sm"
                      variant={listing.deliveryFeeOverrideKobo === 0 ? "default" : "outline"}
                      className={listing.deliveryFeeOverrideKobo === 0
                        ? "h-7 text-xs bg-blue-600 text-white hover:bg-blue-700 border-blue-600"
                        : "h-7 text-xs"}
                      disabled={processingId === listing.id}
                      onClick={() => runAction(listing.id, listing.deliveryFeeOverrideKobo === 0 ? "unset_fbz_free_delivery" : "set_fbz_free_delivery")}
                      title={listing.deliveryFeeOverrideKobo === 0
                        ? "Remove free delivery — buyers will see the normal calculated delivery fee again"
                        : "Buyers will see Free Delivery on this listing, regardless of their state or delivery method"}
                    >
                      {processingId === listing.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : listing.deliveryFeeOverrideKobo === 0 ? (
                        <><Truck className="h-3 w-3 mr-1" />Remove Free Delivery</>
                      ) : (
                        <><Truck className="h-3 w-3 mr-1" />Make Free Delivery</>
                      )}
                    </Button>
                  )}
                  <Button
                    size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                    disabled={processingId === listing.id}
                    onClick={() => handleDelete(listing)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} · {total} total
          </p>
          <div className="flex gap-2">
            <Button
              size="sm" variant="outline"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />Prev
            </Button>
            <Button
              size="sm" variant="outline"
              disabled={!hasMore}
              onClick={() => setPage(p => p + 1)}
            >
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject listing</DialogTitle>
            <DialogDescription>
              Tell the seller why this listing is being rejected. This is shown to them so they can fix and resubmit.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="e.g. Photos are blurry, please re-upload clearer images."
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmReject} disabled={processingId === rejectingId}>
              {processingId === rejectingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject listing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
