"use client"
import type { Order } from "@/src/types"

import {AdminService, serverTimestamp} from "@/src/services"
// components/orders/SellerOrderCard.tsx
// UPDATED: Adds Zamorax Logistics drop-off flow

import { useEffect, useState } from "react"
import { useAuthStore } from "@/store/authStore"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { formatPrice } from "@/lib/utils"
import { SHIPMENT_STATUS_CONFIG } from "@/src/types"
import {
  Check, X, Truck, AlertTriangle, Package, MapPin, Loader2, QrCode, Clock,
} from "lucide-react"
import Link from "next/link"

const STATUS_COLORS: Record<string, string> = {
  pending:     "bg-yellow-100 text-yellow-800",
  escrow_held: "bg-blue-100 text-blue-800",
  shipped:     "bg-purple-100 text-purple-800",
  delivered:   "bg-orange-100 text-orange-800",
  completed:   "bg-green-100 text-green-800",
  cancelled:   "bg-red-100 text-red-800",
  disputed:    "bg-red-100 text-red-700",
}

export function SellerOrderCard({ order, onSuccess }: { order: Order; onSuccess?: () => void }) {
  const uid = useAuthStore(s => s.user?.uid)
  const { toast } = useToast()
  const [tracking, setTracking] = useState(order.trackingNumber || "")
  const [loading, setLoading] = useState(false)
  // Local status mirrors DB — updates immediately on success so button disappears at once
  const [localStatus, setLocalStatus] = useState(order.status)

  // Drop-off dialog
  const [dropoffOpen, setDropoffOpen] = useState(false)
  const [agentName, setAgentName] = useState("")
  const [agentAddress, setAgentAddress] = useState("")
  const [droppingOff, setDroppingOff] = useState(false)

  const orderAny = order as any
  const isLogistics = orderAny.deliveryMethod === "zamorax_logistics"
  const shipmentStatus = orderAny.zlaLastStatus || orderAny.shipmentStatus as string | undefined
  const zlaTimeline: any[] = orderAny.zlaTimeline || []
  const trackingCode: string = orderAny.zlaTrackingCode || orderAny.trackingCode || ""
  const [showTimeline, setShowTimeline] = useState(false)
  // Zamorax (admin/moderator) is fulfilling this order — either inherited
  // from the listing's default or set per-order. Seller can't mark it
  // shipped themselves; payout is unaffected either way.
  //
  // We check BOTH the order's own frozen fulfilledBy (set at creation, or
  // by admin's "Mark Shipped (Zamorax)" action) AND a live lookup of the
  // listing's CURRENT fulfilled_by — because a listing can be switched to
  // FBZ *after* an order was already placed, and older orders never
  // retroactively picked that up. Live check applies regardless of order
  // status, so even completed/shipped older orders reflect it too.
  const [listingFulfilledBy, setListingFulfilledBy] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!order.listingId) return
    fetch(`/api/listings/${order.listingId}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setListingFulfilledBy(data?.fulfilledBy ?? null) })
      .catch(() => { if (!cancelled) setListingFulfilledBy(null) })
    return () => { cancelled = true }
  }, [order.listingId])
  const zamoraxHandling = orderAny.fulfilledBy === "zamorax" || listingFulfilledBy === "zamorax"

  const updateStatus = async (newStatus: string) => {
    if (!uid) return
    if (newStatus === "shipped" && zamoraxHandling) {
      toast({
        title: "Zamorax is handling this order",
        description: "This order is fulfilled by Zamorax — you can't mark it shipped yourself.",
        variant: "destructive",
      })
      return
    }
    setLoading(true)
    try {
      await AdminService.updateDoc("orders", order.id, {
        status: newStatus,
        trackingNumber: tracking || null,
        updatedAt: serverTimestamp(),
      })
      setLocalStatus(newStatus)
      toast({ title: "Order Updated", description: `Status set to ${newStatus.replace("_", " ")}`, variant: "success" })
      onSuccess?.()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setLoading(false) }
  }

  // Seller confirms drop-off at agent
  const handleConfirmDropoff = async () => {
    if (zamoraxHandling) {
      toast({
        title: "Zamorax is handling this order",
        description: "This order is fulfilled by Zamorax — you can't confirm drop-off yourself.",
        variant: "destructive",
      })
      return
    }
    if (!agentName.trim() || !agentAddress.trim()) {
      toast({ title: "Enter agent name and address", variant: "destructive" }); return
    }
    setDroppingOff(true)
    try {
      // Update shipment
      if (orderAny.zlaShipmentId || orderAny.shipmentId) {
        await AdminService.updateDoc("shipments", orderAny.zlaShipmentId || orderAny.shipmentId, {
          status: "dropped_off",
          originAgentName: agentName.trim(),
          currentAgentId: null,
          currentAgentName: agentName.trim(),
          updatedAt: serverTimestamp(),
          timeline: (orderAny.shipmentTimeline || []).concat([{
            status: "dropped_off",
            agentName: agentName.trim(),
            note: `Seller dropped off at: ${agentAddress.trim()}`,
            timestamp: new Date().toISOString(),
          }]),
        })
      }

      // Update order status
      await AdminService.updateDoc("orders", order.id, {
        status: "shipped",
        shipmentStatus: "dropped_off",
        updatedAt: serverTimestamp(),
      })

      // Notify buyer
      await AdminService.addDoc("notifications", {
        userId: order.buyerId,
        type: "system",
        title: "📦 Your item has been dropped off!",
        body: `"${order.itemTitle}" is now with a Zamorax agent and on its way to you. Track: ${trackingCode}`,
        link: `/dashboard/buyer/orders/${order.id}`,
        read: false,
        createdAt: serverTimestamp(),
      })

      toast({ title: "Drop-off confirmed! ✅", description: "Buyer has been notified.", variant: "success" })
      setDropoffOpen(false)
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setDroppingOff(false) }
  }

  // Order has no top-level `quantity` — single Buy Now orders are always
  // qty 1 (no field needed). Cart orders carry quantity per line item via
  // lineItems[].qty (set from the bulk-pricing tier the buyer picked on
  // the listing page). A seller's order can bundle several different
  // listings together, so we show each line's title + qty separately
  // rather than one summed number that would blur which item is which.
  const lineItems = Array.isArray(order.lineItems) ? order.lineItems : []
  const hasMultipleLines = lineItems.length > 1
  const singleLineQty = lineItems.length === 1 ? (lineItems[0]?.qty ?? 0) : 0

  return (
    <>
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium truncate">{order.itemTitle || "Untitled Item"}</h3>
              <Badge className={STATUS_COLORS[localStatus] || "bg-gray-100"}>
                {localStatus?.replace(/_/g, " ")}
              </Badge>
              {/* Delivery method badge */}
              {isLogistics && (
                <Badge className="bg-primary/10 text-primary text-[10px] flex items-center gap-0.5">
                  <Package className="h-2.5 w-2.5" /> ZML
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">
              Buyer: {order.buyerName || "N/A"} · {order.orderType === "rental" ? "Rental" : "Sale"}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-primary">{formatPrice(order.totalAmount)}</p>
              {/* Single line item at qty > 1 — e.g. one bulk-tier purchase */}
              {!hasMultipleLines && singleLineQty > 1 && (
                <Badge variant="outline" className="text-xs font-semibold border-primary/30 text-primary bg-primary/5">
                  Qty: {singleLineQty}
                </Badge>
              )}
            </div>

            {/* Fashion variant — single-listing orders (Buy Now) carry the
                selection on the order itself; cart orders carry it per line
                item below instead, so this only applies when there's just
                one line (or none, i.e. a Buy Now order). */}
            {!hasMultipleLines && (order.selectedColor || order.selectedSize) && (
              <p className="text-xs text-muted-foreground">
                {[order.selectedColor, order.selectedSize].filter(Boolean).join(" · ")}
              </p>
            )}

            {/* Multiple different listings in this order — break out each
                one's title and quantity so the seller knows exactly what
                was ordered and in what amount, instead of one blended total. */}
            {hasMultipleLines && (
              <div className="mt-1 space-y-0.5 border-l-2 border-primary/20 pl-2">
                {lineItems.map((li, i) => (
                  <p key={i} className="text-xs text-muted-foreground truncate">
                    {li.title || "Item"} <span className="font-semibold text-foreground">× {li.qty}</span>
                    {(li.selectedColor || li.selectedSize) && (
                      <span className="text-muted-foreground/70"> ({[li.selectedColor, li.selectedSize].filter(Boolean).join(", ")})</span>
                    )}
                  </p>
                ))}
              </div>
            )}


            {/* Tracking code for logistics orders */}
            {isLogistics && trackingCode && (
              <p className="text-xs text-muted-foreground font-mono">
                Track: {trackingCode}
              </p>
            )}

            {/* Shipment status */}
            {isLogistics && shipmentStatus && SHIPMENT_STATUS_CONFIG[shipmentStatus as keyof typeof SHIPMENT_STATUS_CONFIG] && (
              <Badge className={`${SHIPMENT_STATUS_CONFIG[shipmentStatus as keyof typeof SHIPMENT_STATUS_CONFIG].color} text-[10px]`}>
                {SHIPMENT_STATUS_CONFIG[shipmentStatus as keyof typeof SHIPMENT_STATUS_CONFIG].label}
              </Badge>
            )}

            {/* ZLA Timeline toggle */}
            {isLogistics && zlaTimeline.length > 0 && (
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() => setShowTimeline(v => !v)}
                  className="text-[10px] text-primary underline underline-offset-2"
                >
                  {showTimeline ? "Hide shipment timeline" : `View shipment timeline (${zlaTimeline.length} events)`}
                </button>
                {showTimeline && (
                  <div className="mt-2 space-y-1.5 border-l-2 border-primary/20 pl-3">
                    {[...zlaTimeline].reverse().map((entry: any, i: number) => (
                      <div key={i} className="text-xs">
                        <span className="font-medium capitalize">{entry.status?.replace(/_/g, " ")}</span>
                        {entry.note && <span className="text-muted-foreground"> — {entry.note}</span>}
                        {entry.agentName && <span className="text-muted-foreground"> · {entry.agentName}</span>}
                        <div className="text-[10px] text-muted-foreground">
                          {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            {zamoraxHandling && !["completed", "cancelled", "disputed"].includes(localStatus) && (
              <div className="flex items-center gap-2 text-violet-700 text-xs bg-violet-50 border border-violet-200 rounded-md px-3 py-2 max-w-[240px]">
                <Package className="h-4 w-4 shrink-0" />
                Zamorax is handling fulfillment — you'll still be paid out as normal.
              </div>
            )}

            {/* ── ZAMORAX LOGISTICS FLOW ── */}
            {!zamoraxHandling && isLogistics && (localStatus === "escrow_held" || localStatus === "pending") && (
              <Button
                className="bg-primary text-white hover:bg-primary/90"
                onClick={() => setDropoffOpen(true)}
              >
                <MapPin className="h-4 w-4 mr-2" /> Confirm Drop-off
              </Button>
            )}

            {isLogistics && localStatus === "shipped" && shipmentStatus === "dropped_off" && (
              <Button variant="outline" disabled className="opacity-70">
                <Package className="h-4 w-4 mr-2" /> In Transit…
              </Button>
            )}

            {/* View full detail for active ZLA shipments */}
            {isLogistics && !["pending", "escrow_held", "completed", "cancelled", "disputed"].includes(localStatus) && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/seller/orders/${order.id}`}>
                  <Truck className="h-3.5 w-3.5 mr-1.5" /> Track Shipment
                </Link>
              </Button>
            )}

            {/* ── STANDARD FLOW (meetup / FBZ) ── */}
            {!isLogistics && localStatus === "pending" && order.orderType === "rental" && (
              <>
                <Button onClick={() => updateStatus("escrow_held")} className="bg-primary text-white"><Check className="h-4 w-4 mr-2" /> Accept</Button>
                <Button onClick={() => updateStatus("cancelled")} variant="destructive"><X className="h-4 w-4 mr-2" /> Decline</Button>
              </>
            )}
            {!isLogistics && !zamoraxHandling && localStatus === "escrow_held" && order.orderType !== "rental" && (() => {
              const isMeetup = orderAny.deliveryMethod === "meetup"
              const trackingRequired = !isMeetup
              const canShip = !trackingRequired || tracking.trim().length > 0
              return (
                <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                  <div className="flex gap-2">
                    <Input
                      placeholder={trackingRequired ? "Tracking # (required)" : "Tracking # (optional)"}
                      value={tracking}
                      onChange={e => setTracking(e.target.value)}
                      className={`bg-background w-40 text-sm ${trackingRequired && !tracking.trim() ? "border-orange-400 focus-visible:ring-orange-400" : ""}`}
                    />
                    <Button onClick={() => updateStatus("shipped")} disabled={loading || !canShip}>
                      <Truck className="h-4 w-4 mr-2" /> {loading ? "Updating…" : "Mark Shipped"}
                    </Button>
                  </div>
                  {trackingRequired && !tracking.trim() ? (
                    <p className="text-[10px] text-orange-500 leading-tight">
                      ⚠️ Enter the tracking number from your courier. This is required for delivery orders and protects you in disputes.
                    </p>
                  ) : isMeetup ? (
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      Meetup order — no tracking needed.
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      ✅ Tracking number saved — buyer can follow their delivery.
                    </p>
                  )}
                </div>
              )
            })()}
            {/* Payment hasn't been confirmed by admin yet — shipping must wait
                until escrow is actually funded, otherwise the buyer could
                receive goods before their payment was ever verified. */}
            {!isLogistics && localStatus === "pending" && order.orderType !== "rental" && (
              <div className="flex flex-col gap-1">
                <Button variant="outline" disabled className="opacity-70">
                  <Clock className="h-4 w-4 mr-2" /> Waiting for Payment Confirmation
                </Button>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Admin is verifying the buyer's payment. You'll be able to mark this shipped once escrow is funded.
                </p>
              </div>
            )}
            {!isLogistics && localStatus === "shipped" && (
              <Button variant="outline" disabled>Waiting for Delivery</Button>
            )}

            {localStatus === "completed" && (
              <div className="flex items-center gap-2 text-emerald-600 font-medium text-sm">
                <Check className="h-4 w-4" /> Funds Released
              </div>
            )}
            {localStatus === "cancelled" && (
              <div className="flex items-center gap-2 text-red-500 font-medium text-sm">
                <AlertTriangle className="h-4 w-4" /> Cancelled
              </div>
            )}
            {order.status === "disputed" && (
              <Button asChild variant="outline" size="sm" className="border-red-200 text-red-600">
                <Link href={`/dashboard/seller/orders/${order.id}`}>
                  <AlertTriangle className="h-3.5 w-3.5 mr-1" /> View Dispute
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Drop-off confirmation dialog */}
      <Dialog open={dropoffOpen} onOpenChange={setDropoffOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" /> Confirm Agent Drop-off
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm space-y-1">
              <p className="font-medium">"{order.itemTitle}"</p>
              {trackingCode && (
                <p className="text-xs text-muted-foreground font-mono">Tracking: {trackingCode}</p>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              Confirm the agent you dropped the item off at. The buyer will be notified immediately.
            </p>

            <div className="space-y-1.5">
              <Label>Agent / Store Name</Label>
              <Input
                placeholder="e.g. Bayo Stores, Ikeja"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Agent Address</Label>
              <Input
                placeholder="e.g. 12 Allen Avenue, Ikeja, Lagos"
                value={agentAddress}
                onChange={e => setAgentAddress(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDropoffOpen(false)}>Cancel</Button>
            <Button
              className="bg-primary text-white hover:bg-primary/90"
              onClick={handleConfirmDropoff}
              disabled={droppingOff || !agentName.trim() || !agentAddress.trim()}
            >
              {droppingOff
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><Check className="h-4 w-4 mr-1.5" /> Confirm Drop-off</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

