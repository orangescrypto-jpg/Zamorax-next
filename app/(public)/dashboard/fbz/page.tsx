"use client"

import {AdminService, query, orderBy, onSnapshot, where, serverTimestamp} from "@/src/services"
// app/(public)/dashboard/fbz/page.tsx
// Seller picks their nearest FBZ warehouse from admin-managed list

import { useEffect, useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue
} from "@/components/ui/select"
import type { FBZWarehouse } from "@/components/admin/FBZWarehouseLocations"
import {
  Zap, Package, Truck, Shield, CheckCircle, Clock,
  Loader2, Warehouse, BarChart3, MapPin, Phone, ArrowLeft
} from "lucide-react"
import { formatPrice } from "@/lib/utils"
import { useRouter } from "next/navigation"
import Link from "next/link"

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:  { label: "Awaiting Drop-off", color: "bg-amber-100 text-amber-700" },
  received: { label: "Received at Hub",   color: "bg-blue-100 text-blue-700" },
  active:   { label: "FBZ Live ⚡",       color: "bg-emerald-100 text-emerald-700" },
  depleted: { label: "Out of Stock",      color: "bg-gray-100 text-gray-600" },
  rejected: { label: "Rejected",          color: "bg-red-100 text-red-700" } }

export default function SellerFBZPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { toast } = useToast()

  const [shipments, setShipments] = useState<any[]>([])
  const [listings, setListings] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<FBZWarehouse[]>([])
  const [settings, setSettings] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [selectedListingId, setSelectedListingId] = useState("")
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [notes, setNotes] = useState("")

  // Load platform FBZ settings
  useEffect(() => {
    AdminService.getDoc("config", "platform").then(docs => {
      if (docs) setSettings(docs)
    })
  }, [])

  // Load active FBZ warehouses
  useEffect(() => {
    const q = AdminService._ref_("fbzWarehouses", [where("isActive", "==", true)])
    const unsub = onSnapshot(q, docs => {
      setWarehouses(docs.docs.map((d: any) => ({ id: d.id, ...d.data() } as FBZWarehouse)))
    })
    return unsub
  }, [])

  // Load seller's active listings not yet in FBZ. isFBZ is NULL for any
  // listing created before the is_fbz column existed (or simply never
  // touched by FBZ), and SQL's "!= true" silently excludes NULL rows
  // instead of matching them — which made every pre-existing active
  // listing invisible here even though none of them are FBZ yet. Filter
  // client-side on the "not truthy" listings instead of relying on the
  // DB-level "!=" to catch NULL.
  useEffect(() => {
    if (!user?.uid) return
    const q = AdminService._ref_("listings", [where("sellerId", "==", user.uid), where("status", "==", "active")])
    const unsub = onSnapshot(q, docs => {
      const all = docs.docs.map((d: any) => ({ id: d.id, ...d.data() }))
      setListings(all.filter((l: any) => !l.isFBZ))
    })
    return unsub
  }, [user?.uid])

  // Load seller's FBZ shipments
  useEffect(() => {
    if (!user?.uid) return
    const q = AdminService._ref_("fbzShipments", [where("sellerId", "==", user.uid), orderBy("createdAt", "desc")])
    const unsub = onSnapshot(q, docs => {
      setShipments(docs.docs.map((d: any) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [user?.uid])

  const selectedWarehouse = warehouses.find(w => w.id === selectedWarehouseId)

  const handleSubmit = async () => {
    if (!selectedListingId) { toast({ title: "Select a listing", variant: "destructive" }); return }
    if (!selectedWarehouseId) { toast({ title: "Select a drop-off location", variant: "destructive" }); return }
    const qty = parseInt(quantity)
    if (!qty || qty < 1) { toast({ title: "Enter a valid quantity", variant: "destructive" }); return }

    const maxQty = settings.fbzMaxStockPerSeller || 20
    if (qty > maxQty) {
      toast({ title: `Max ${maxQty} units per shipment`, variant: "destructive" }); return
    }

    const listing = listings.find(l => l.id === selectedListingId)
    if (!listing) return

    if (settings.fbzEnabled === false) {
      toast({ title: "FBZ is currently paused", description: settings.fbzPauseReason || "Check back soon.", variant: "destructive" })
      return
    }

    setSubmitting(true)
    try {
      const ref = await AdminService.addDoc("fbzShipments", {
        sellerId: user?.uid,
        sellerName: user?.fullName || user?.email,
        sellerPhone: user?.phone || null,
        listingId: selectedListingId,
        listingTitle: listing.title,
        listingImage: listing.images?.[0] || null,
        listingPrice: listing.priceSale,
        quantity: qty,
        quantityAvailable: 0,
        notes: notes.trim(),
        status: "pending",
        // Warehouse details saved on shipment for reference
        warehouseId: selectedWarehouseId,
        warehouseName: selectedWarehouse?.name,
        warehouseAddress: selectedWarehouse?.address,
        warehousePhone: selectedWarehouse?.phone,
        warehouseCity: selectedWarehouse?.city,
        warehouseState: selectedWarehouse?.state,
        createdAt: serverTimestamp() })

      await AdminService.addDoc("notifications", {
        userId: "admin",
        type: "system",
        title: "📦 New FBZ Shipment",
        body: `${user?.fullName} → ${qty}x "${listing.title}" to ${selectedWarehouse?.name}`,
        link: "/admin/fbz",
        isRead: false,
        createdAt: serverTimestamp() })

      toast({
        title: "FBZ Request submitted! 📦",
        description: `Drop off at ${selectedWarehouse?.name}. ID: ${ref.id.slice(0, 8).toUpperCase()}`,
        variant: "success" })
      setShowForm(false)
      setSelectedListingId("")
      setSelectedWarehouseId("")
      setQuantity("1")
      setNotes("")
    } catch {
      toast({ title: "Error submitting request", variant: "destructive" })
    }
    setSubmitting(false)
  }

  const activeShipments = shipments.filter(s => s.status === "active")
  const pendingShipments = shipments.filter(s => ["pending","received"].includes(s.status))
  const totalStock = activeShipments.reduce((sum, s) => sum + (s.quantityAvailable || 0), 0)

  if (loading) return (
    <div className="flex h-60 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )

  return (
    <div className="container max-w-2xl py-6 pb-24 space-y-5">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="-ml-2 mb-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-primary to-emerald-500 rounded-xl flex items-center justify-center">
            <Zap className="h-5 w-5 text-white fill-white" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold">Fulfilled by Zamorax</h1>
            <p className="text-xs text-muted-foreground">We store, pack & ship. You just sell.</p>
          </div>
        </div>
      </div>

      {/* FBZ disabled */}
      {settings.fbzEnabled === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <p className="font-semibold">FBZ is temporarily paused</p>
          <p className="text-xs mt-0.5">{settings.fbzPauseReason || "Check back soon."}</p>
        </div>
      )}

      {/* Stats */}
      {shipments.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "In warehouse", value: totalStock, color: "text-primary" },
            { label: "FBZ active",   value: activeShipments.length,  color: "text-emerald-600" },
            { label: "Pending",      value: pendingShipments.length, color: "text-amber-600" },
          ].map(({ label, value, color }) => (
            <Card key={label}><CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* How it works — first time */}
      {shipments.length === 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">How FBZ works</h2>
            {[
              { icon: Package, text: "Submit your items and choose the nearest drop-off hub" },
              { icon: Truck,   text: "Drop off items at your chosen Zamorax hub" },
              { icon: Shield,  text: "We inspect, photograph, and activate your FBZ listing" },
              { icon: CheckCircle, text: "We pack and ship every order. You get paid after delivery." },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <p className="text-sm text-secondary leading-snug pt-0.5">{text}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Enroll button */}
      {!showForm && settings.fbzEnabled !== false && (
        <Button
          className="w-full bg-gradient-to-r from-primary to-emerald-500 text-white h-12 text-base"
          onClick={() => setShowForm(true)}
          disabled={listings.length === 0 || warehouses.length === 0}
        >
          <Warehouse className="h-5 w-5 mr-2" />
          {warehouses.length === 0
            ? "No FBZ hubs available yet"
            : listings.length === 0
            ? "No eligible listings"
            : "Send Stock to Zamorax Hub"
          }
        </Button>
      )}

      {/* Enrollment form */}
      {showForm && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" /> New FBZ Shipment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Listing */}
            <div className="space-y-1.5">
              <Label>Select listing to enroll</Label>
              <Select value={selectedListingId} onValueChange={setSelectedListingId}>
                <SelectTrigger><SelectValue placeholder="Choose a listing..." /></SelectTrigger>
                <SelectContent>
                  {listings.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.title} — {formatPrice(l.priceSale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Warehouse picker */}
            <div className="space-y-1.5">
              <Label>Choose nearest drop-off location</Label>
              <div className="grid gap-2">
                {warehouses.map(w => {
                  const selected = selectedWarehouseId === w.id
                  const full = (w.currentStock || 0) >= w.capacity
                  return (
                    <button
                      key={w.id}
                      type="button"
                      disabled={full}
                      onClick={() => setSelectedWarehouseId(w.id)}
                      className={`text-left w-full border rounded-xl px-4 py-3 transition-all ${
                        selected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : full
                          ? "border-border opacity-50 cursor-not-allowed"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{w.name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" /> {w.address}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Phone className="h-3 w-3" /> {w.phone}
                            <span className="mx-1">·</span>
                            <Clock className="h-3 w-3" /> {w.hours}
                          </p>
                        </div>
                        <div className="shrink-0">
                          {full ? (
                            <Badge className="bg-red-100 text-red-600 border-0 text-xs">Full</Badge>
                          ) : (
                            <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">
                              {w.currentStock || 0}/{w.capacity} units
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Quantity */}
            <div className="space-y-1.5">
              <Label>Quantity to send</Label>
              <Input
                type="number" min="1"
                max={settings.fbzMaxStockPerSeller || 20}
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Max {settings.fbzMaxStockPerSeller || 20} units per shipment
              </p>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>Notes for warehouse team (optional)</Label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. All items are sealed, accessories included..."
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1 bg-primary text-white"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Shipment"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shipments list */}
      {shipments.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold">Your FBZ Shipments</h2>
          {shipments.map(s => {
            const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.pending
            return (
              <Card key={s.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-14 h-14 rounded-lg bg-muted overflow-hidden shrink-0">
                    {s.listingImage
                      ? <img src={s.listingImage} alt="" className="w-full h-full object-cover" />
                      : <Package className="h-6 w-6 m-4 text-muted-foreground" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{s.listingTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      ID: {s.id.slice(0, 8).toUpperCase()} · Qty: {s.quantity}
                    </p>
                    {s.warehouseName && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3" /> {s.warehouseName}
                      </p>
                    )}
                    {s.status === "active" && (
                      <p className="text-xs text-emerald-600 font-medium">{s.quantityAvailable} in stock</p>
                    )}
                  </div>
                  <Badge className={`${cfg.color} border-0 text-xs shrink-0`}>{cfg.label}</Badge>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
