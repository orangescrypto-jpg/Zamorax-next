"use client"

import {AdminService, query, onSnapshot, where, serverTimestamp} from "@/src/services"
// app/(moderator)/moderator/listings/page.tsx

import { useEffect, useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { formatPrice } from "@/lib/utils"
import { CheckCircle, XCircle, Loader2, Package, ExternalLink, Eye, Pencil } from "lucide-react"
import Link from "next/link"
import {DocumentData} from "@/src/services"

type Listing = {
  id: string
  title?: string
  sellerName?: string
  priceSale?: number
  categorySlug?: string
  status?: string
  images?: string[]
  rejectionReason?: string
  [key: string]: unknown
}

export default function ModeratorListingsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  useEffect(() => {
    const q = AdminService._ref_("listings", [where("status", "in", ["pending", "active", "rejected"])])
    return onSnapshot(q, docs => {
      setListings(docs.docs.map((d: any) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  const handleApprove = async (listing: Listing) => {
    setProcessing(listing.id)
    try {
      await AdminService.updateDoc("listings", listing.id, {
        status: "active",
        approvedBy: user?.uid,
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp() })
      toast({ title: "Listing Approved ✅", description: `"${listing.title}" is now live.`, variant: "success" })
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcessing(null) }
  }

  const handleRejectSubmit = async () => {
    if (!rejectingId || !rejectReason.trim()) return
    const listing = listings.find(l => l.id === rejectingId)
    setProcessing(rejectingId)
    try {
      await AdminService.updateDoc("listings", rejectingId, {
        status: "rejected",
        rejectionReason: rejectReason.trim(),
        rejectedBy: user?.uid,
        rejectedAt: serverTimestamp(),
        updatedAt: serverTimestamp() })
      setRejectOpen(false); setRejectReason(""); setRejectingId(null)
      toast({ title: "Listing Rejected", description: "Seller has been notified.", variant: "destructive" })
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setProcessing(null) }
  }

  const pending = listings.filter(l => l.status === "pending")
  const approved = listings.filter(l => l.status === "active")
  const rejected = listings.filter(l => l.status === "rejected")

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>

  const ListingRow = ({ listing, tab }: { listing: Listing; tab: string }) => (
    <Card>
      <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-4">
        <div className="w-16 h-16 rounded-xl bg-muted overflow-hidden shrink-0">
          {listing.images?.[0]
            ? <img src={listing.images?.[0]} alt="" className="w-full h-full object-cover" />
            : <Package className="h-6 w-6 m-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{listing.title}</p>
          <p className="text-xs text-muted-foreground">
            {listing.sellerName} · {formatPrice(listing.priceSale || 0)} · {listing.categorySlug}
          </p>
          {listing.rejectionReason && (
            <p className="text-xs text-red-600 mt-1">Rejected: {listing.rejectionReason}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/listings/${listing.id}`} target="_blank"><ExternalLink className="h-4 w-4" /></Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/dashboard/seller/listings/${listing.id}/edit`}><Pencil className="h-4 w-4" /></Link>
          </Button>
          {tab === "pending" && (
            <>
              <Button size="sm" className="bg-accent hover:bg-accent/90 text-white" onClick={() => handleApprove(listing)} disabled={processing === listing.id}>
                {processing === listing.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve</>}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => { setRejectingId(listing.id); setRejectOpen(true) }} disabled={processing === listing.id}>
                <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
            </>
          )}
          {tab !== "pending" && (
            <Badge className={tab === "active" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
              {tab === "active" ? "Live" : "Rejected"}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="container py-8 max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Eye className="h-6 w-6" /> Listings Queue
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {pending.length > 0 ? <strong className="text-amber-600">{pending.length} listings waiting for review.</strong> : "All caught up!"}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/moderator/listings/post">Post Listing</Link>
        </Button>
      </div>

      <Tabs defaultValue={pending.length > 0 ? "pending" : "active"}>
        <TabsList className="mb-4">
          <TabsTrigger value="pending">
            Pending {pending.length > 0 && <span className="ml-1 bg-amber-500 text-white text-xs px-1.5 rounded-full">{pending.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="active">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
        </TabsList>
        {([ ["pending", pending], ["active", approved], ["rejected", rejected] ] as [string, Listing[]][]).map(([tab, list]) => (
          <TabsContent key={tab as string} value={tab as string} className="space-y-3">
            {(list as Listing[]).length === 0
              ? <div className="border border-dashed rounded-xl py-12 text-center text-muted-foreground">No {tab} listings.</div>
              : (list as Listing[]).map(l => <ListingRow key={l.id} listing={l} tab={tab as string} />)}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Listing</DialogTitle>
            <DialogDescription>The seller will see this reason and can edit and resubmit.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="e.g., Price missing, prohibited item, blurry photos, incomplete description..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectOpen(false); setRejectReason("") }}>Cancel</Button>
            <Button variant="destructive" onClick={handleRejectSubmit} disabled={!rejectReason.trim() || !!processing}>
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
