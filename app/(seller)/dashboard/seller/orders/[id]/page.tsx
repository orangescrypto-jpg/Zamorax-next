"use client"

// app/(seller)/dashboard/seller/orders/[id]/page.tsx
// Seller order detail — full ZLA shipment timeline + transparent escrow fee breakdown.
// Fee breakdown reads live from useFeeSettings() — always reflects current admin rates.
// If admin sets any fee to 0, it is hidden from the breakdown (not shown as ₦0).

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/authStore"
import { useToast } from "@/components/ui/use-toast"
import { AdminService, serverTimestamp } from "@/src/services"
import { formatPrice } from "@/lib/utils"
import { useFeeSettings } from "@/hooks/useFeeSettings"
import { calculateFees } from "@/src/services/feeSettings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  ArrowLeft, Package, Truck, MapPin, CheckCircle, Clock,
  CreditCard, AlertTriangle, Loader2, Check, Copy, ShieldCheck, Info,
} from "lucide-react"
import Link from "next/link"

// ── ZLA status steps ──────────────────────────────────────────────────────────

const ZLA_STEPS = [
  { key: "awaiting_dropoff",     label: "Awaiting Drop-off",       icon: Clock },
  { key: "dropped_off",          label: "Dropped Off at Agent",     icon: Package },
  { key: "in_transit",           label: "In Transit",               icon: Truck },
  { key: "at_destination_agent", label: "At Destination Agent",     icon: MapPin },
  { key: "out_for_delivery",     label: "Out for Delivery",         icon: Truck },
  { key: "delivered",            label: "Delivered",                icon: CheckCircle },
]
const ZLA_STEP_KEYS = ZLA_STEPS.map(s => s.key)

const STATUS_COLORS: Record<string, string> = {
  pending:               "bg-yellow-100 text-yellow-800",
  escrow_held:           "bg-blue-100 text-blue-800",
  shipped:               "bg-purple-100 text-purple-800",
  dropped_off:           "bg-indigo-100 text-indigo-800",
  in_transit:            "bg-cyan-100 text-cyan-800",
  at_destination_agent:  "bg-teal-100 text-teal-800",
  out_for_delivery:      "bg-orange-100 text-orange-800",
  delivered:             "bg-amber-100 text-amber-800",
  completed:             "bg-emerald-100 text-emerald-800",
  cancelled:             "bg-red-100 text-red-800",
  payment_rejected:      "bg-red-100 text-red-700",
  disputed:              "bg-red-100 text-red-700",
  delivery_failed:       "bg-red-100 text-red-800",
  returned:              "bg-gray-100 text-gray-700",
}

// ── ZLA Shipment Timeline ─────────────────────────────────────────────────────

function ZLATimeline({ order }: { order: any }) {
  const timeline     = order.zlaTimeline || []
  const currentStatus = order.zlaLastStatus || order.shipmentStatus || "awaiting_dropoff"
  const currentIdx   = ZLA_STEP_KEYS.indexOf(currentStatus)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Truck className="h-4 w-4 text-primary" /> ZLA Shipment Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2 space-y-4">
        <div className="relative">
          <div className="absolute left-[18px] top-6 bottom-6 w-0.5 bg-muted" />
          <div className="space-y-4">
            {ZLA_STEPS.map((step, i) => {
              const isDone   = i <= currentIdx && currentIdx >= 0
              const isActive = step.key === currentStatus
              const Icon     = step.icon
              return (
                <div key={step.key} className="flex items-start gap-4 relative">
                  <div className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center shrink-0 border-2 transition-all
                    ${isDone
                      ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                      : "bg-background border-muted text-muted-foreground"
                    }`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 pt-1.5 min-w-0">
                    <p className={`text-sm font-semibold leading-tight ${isDone ? "text-foreground" : "text-muted-foreground"}`}>
                      {step.label}
                      {isActive && (
                        <span className="ml-2 text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                          Current
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {timeline.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Event Log
              </p>
              <div className="space-y-2 border-l-2 border-primary/20 pl-3">
                {[...timeline].reverse().map((entry: any, i: number) => (
                  <div key={i} className="text-xs">
                    <span className="font-medium capitalize">
                      {entry.status?.replace(/_/g, " ")}
                    </span>
                    {entry.note && <span className="text-muted-foreground"> — {entry.note}</span>}
                    {entry.agentName && <span className="text-muted-foreground"> · {entry.agentName}</span>}
                    <div className="text-[10px] text-muted-foreground">
                      {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Escrow Fee Breakdown card ─────────────────────────────────────────────────
// Reads live from useFeeSettings() — reflects current admin rates, not rates at time of order.
// Falls back to values stored on the order document if available (more accurate for historical orders).

function EscrowBreakdown({ order }: { order: any }) {
  const { fees } = useFeeSettings()

  // Prefer values stored on the order (set at checkout time) for accuracy.
  // Fall back to live calculation if not stored.
  const itemPriceKobo = order.itemPrice || order.totalAmount || 0
  const orderType     = order.orderType === "rental" ? "rental" : "sale"

  // Use stored values if available, else calculate live
  const stored = {
    commissionKobo:   order.platformFee     ?? null,
    insuranceKobo:    order.arbitrationFee  ?? null,
    withdrawalKobo:   order.withdrawalFee   ?? null,
  }

  const live       = calculateFees(itemPriceKobo, orderType, fees)
  const commission = stored.commissionKobo  ?? live.commissionKobo
  const insurance  = stored.insuranceKobo   ?? live.insuranceKobo
  const withdrawal = stored.withdrawalKobo  ?? live.withdrawalFeeKobo
  const netPayout  = order.sellerPayout     ?? (itemPriceKobo - commission - insurance - withdrawal)

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" /> Escrow & Fee Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">

        <div className="flex justify-between">
          <span className="text-muted-foreground">Buyer paid (item price)</span>
          <span className="font-medium">{formatPrice(itemPriceKobo)}</span>
        </div>

        <Separator />

        {/* Only show fee lines if > 0 */}
        {commission > 0 && (
          <div className="flex justify-between text-destructive">
            <span>
              Platform commission ({live.commissionPct.toFixed(1)}%)
            </span>
            <span>-{formatPrice(commission)}</span>
          </div>
        )}
        {insurance > 0 && (
          <div className="flex justify-between text-destructive">
            <span>
              Arbitration pool ({live.insurancePct.toFixed(1)}%)
            </span>
            <span>-{formatPrice(insurance)}</span>
          </div>
        )}
        {withdrawal > 0 && (
          <div className="flex justify-between text-destructive">
            <span>Withdrawal fee (on payout)</span>
            <span>-{formatPrice(withdrawal)}</span>
          </div>
        )}

        {commission === 0 && insurance === 0 && withdrawal === 0 && (
          <p className="text-xs text-emerald-600 font-medium">
            🎉 No fees on this order — you keep 100% of the sale price.
          </p>
        )}

        <Separator />

        <div className="flex justify-between font-bold text-base">
          <span>Your net payout</span>
          <span className="text-primary">{formatPrice(netPayout)}</span>
        </div>

        {order.status === "escrow_held" && (
          <div className="flex items-start gap-1.5 pt-1">
            <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Funds are held in escrow and will be released to your wallet once the buyer confirms receipt.
              The arbitration pool is held separately and released if no dispute is raised.
            </p>
          </div>
        )}

        {order.status === "completed" && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 pt-1">
            <CheckCircle className="h-3.5 w-3.5 shrink-0" />
            Net payout has been credited to your wallet.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SellerOrderDetailPage({ params }: { params: { id: string } }) {
  const uid       = useAuthStore(s => s.user?.uid)
  const router    = useRouter()
  const { toast } = useToast()

  const [order,       setOrder]       = useState<any>(null)
  const [loading,     setLoading]     = useState(true)
  const [tracking,    setTracking]    = useState("")
  const [updating,    setUpdating]    = useState(false)
  const [dropoffOpen, setDropoffOpen] = useState(false)
  const [agentName,   setAgentName]   = useState("")
  const [agentAddr,   setAgentAddr]   = useState("")
  const [droppingOff, setDroppingOff] = useState(false)
  const [copied,      setCopied]      = useState(false)

  useEffect(() => {
    const unsub = AdminService.subscribeToDoc("orders", params.id, doc => {
      if (doc) {
        const o = { id: params.id, ...doc.data() } as any
        if (uid && o.sellerId && o.sellerId !== uid) {
          router.replace("/dashboard/seller/orders"); return
        }
        setOrder(o)
        setTracking(o.trackingNumber || "")
      }
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [params.id, uid])

  const isLogistics  = order?.deliveryMethod === "zamorax_logistics"
  const isFBZ        = order?.deliveryMethod === "fbz"
  const trackingCode = order?.zlaTrackingCode || order?.trackingCode || ""
  // Admin/moderator confirmed the goods are with Zamorax and marked this
  // order shipped on the seller's behalf (official listings/sellers only).
  // Seller still sees the full flow below — just can't take the shipping
  // action themselves on this order. Payout is unaffected either way.
  const zamoraxHandling = order?.fulfilledBy === "zamorax"

  const copyTracking = () => {
    if (!trackingCode) return
    navigator.clipboard.writeText(trackingCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const updateStatus = async (newStatus: string) => {
    if (!uid) return
    // Guard: shipping can only happen after admin has confirmed payment and
    // escrow is active — never from "pending". This mirrors the UI gating
    // above, but is enforced here too in case of a stale page/race so a
    // buyer can never be told "shipped" before payment is actually confirmed.
    if (newStatus === "shipped" && order?.status !== "escrow_held") {
      toast({
        title: "Payment not confirmed yet",
        description: "Admin must confirm the buyer's payment before you can mark this order shipped.",
        variant: "destructive",
      })
      return
    }
    if (newStatus === "shipped" && zamoraxHandling) {
      toast({
        title: "Zamorax is handling this order",
        description: "This order is fulfilled by Zamorax — you can't mark it shipped yourself.",
        variant: "destructive",
      })
      return
    }
    setUpdating(true)
    try {
      await AdminService.updateDoc("orders", params.id, {
        status: newStatus,
        trackingNumber: tracking || null,
        updatedAt: serverTimestamp(),
      })
      toast({ title: "Order updated", variant: "success" })
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setUpdating(false) }
  }

  const handleConfirmDropoff = async () => {
    if (zamoraxHandling) {
      toast({
        title: "Zamorax is handling this order",
        description: "This order is fulfilled by Zamorax — you can't confirm drop-off yourself.",
        variant: "destructive",
      })
      return
    }
    if (order?.status !== "escrow_held") {
      toast({
        title: "Payment not confirmed yet",
        description: "Admin must confirm the buyer's payment before you can drop off this order.",
        variant: "destructive",
      })
      return
    }
    if (!agentName.trim() || !agentAddr.trim()) {
      toast({ title: "Enter agent name and address", variant: "destructive" }); return
    }
    setDroppingOff(true)
    try {
      const shipmentId = order?.zlaShipmentId || order?.shipmentId
      if (shipmentId) {
        await AdminService.updateDoc("shipments", shipmentId, {
          status: "dropped_off",
          originAgentName: agentName.trim(),
          currentAgentName: agentName.trim(),
          updatedAt: serverTimestamp(),
          timeline: (order?.shipmentTimeline || []).concat([{
            status: "dropped_off",
            agentName: agentName.trim(),
            note: `Seller dropped off at: ${agentAddr.trim()}`,
            timestamp: new Date().toISOString(),
          }]),
        })
      }
      await AdminService.updateDoc("orders", params.id, {
        status: "shipped",
        shipmentStatus: "dropped_off",
        updatedAt: serverTimestamp(),
      })
      await AdminService.addDoc("notifications", {
        userId: order.buyerId,
        type: "system",
        title: "📦 Your item has been dropped off!",
        body: `"${order.itemTitle}" is now with a Zamorax agent.${trackingCode ? ` Track: ${trackingCode}` : ""}`,
        link: `/dashboard/buyer/orders/${params.id}`,
        is_read: false,
        createdAt: serverTimestamp(),
      })
      toast({ title: "Drop-off confirmed! ✅", description: "Buyer notified.", variant: "success" })
      setDropoffOpen(false)
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setDroppingOff(false) }
  }

  if (loading) return (
    <div className="container flex h-[60vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )

  if (!order) return (
    <div className="container py-16 text-center space-y-4">
      <p className="text-muted-foreground">Order not found.</p>
      <Button asChild variant="outline">
        <Link href="/dashboard/seller/orders">Back to Orders</Link>
      </Button>
    </div>
  )

  return (
    <>
      <div className="container py-8 max-w-2xl space-y-6 pb-24 md:pb-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1 -ml-2">
          <ArrowLeft className="h-4 w-4" /> Back to Orders
        </Button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold truncate">{order.itemTitle || "Order"}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Order #{params.id.slice(0, 8).toUpperCase()}</p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {isLogistics && (
                <Badge className="bg-primary/10 text-primary text-xs flex items-center gap-1">
                  <Package className="h-3 w-3" /> ZamoraxLogic
                </Badge>
              )}
              {isFBZ && (
                <Badge className="bg-amber-100 text-amber-800 text-xs">⚡ FBZ Express</Badge>
              )}
              {!isLogistics && !isFBZ && (
                <Badge variant="outline" className="text-xs">Safe Meetup</Badge>
              )}
            </div>
          </div>
          <Badge className={STATUS_COLORS[order.status] || "bg-gray-100"}>
            {order.status?.replace(/_/g, " ")}
          </Badge>
        </div>

        {/* Tracking code */}
        {isLogistics && trackingCode && (
          <div className="flex items-center gap-2 bg-muted/40 border rounded-lg px-3 py-2.5">
            <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Tracking Code</p>
              <p className="font-mono text-sm font-medium">{trackingCode}</p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copyTracking}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}

        {/* ZLA Shipment Timeline */}
        {isLogistics && <ZLATimeline order={order} />}

        {/* Payment rejected banner — informational, buyer is the one who retries */}
        {order.status === "payment_rejected" && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700">Order on hold — payment not confirmed</p>
              <p className="text-xs text-red-600 mt-0.5">
                The buyer's payment could not be confirmed. This order will resume once they resubmit a valid payment.
              </p>
            </div>
          </div>
        )}

        {/* Dispute banner */}
        {order.status === "disputed" && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700">This order is under dispute</p>
              <p className="text-xs text-red-600 mt-0.5">Our team will review and respond within 48 hours.</p>
            </div>
          </div>
        )}

        {/* Order Details */}
        <Card>
          <CardHeader><CardTitle className="text-base">Order Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Buyer</span>
              <span className="font-medium">{order.buyerName || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery Address</span>
              <span className="text-right max-w-[60%]">
                {[order.deliveryStreet ?? (order as any).delivery_street,
                  order.deliveryLGA ?? (order as any).delivery_lga,
                  order.deliveryCity ?? (order as any).delivery_city,
                  order.buyerState || order.deliveryState || (order as any).delivery_state]
                  .filter(Boolean).join(", ") || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="capitalize">{order.orderType || "purchase"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Order Date</span>
              <span>{order.createdAt?.toDate?.().toLocaleDateString() || "—"}</span>
            </div>
            {order.deliveryAddress && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Delivery Address</span>
                <span className="text-right text-xs">{order.deliveryAddress}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Escrow & Fee Breakdown — the main transparent section ── */}
        <EscrowBreakdown order={order} />

        {/* Escrow status notices */}
        {order.status === "escrow_held" && (
          <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <CreditCard className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-700">
              Payment is secured in escrow. It will be released to you once the buyer confirms delivery.
            </p>
          </div>
        )}

        {order.status === "completed" && (
          <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
            <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
            <p className="text-sm text-emerald-700">
              Funds have been released to your wallet.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {zamoraxHandling && (
            <div className="flex items-start gap-2 p-3 bg-violet-50 border border-violet-200 rounded-lg">
              <Package className="h-4 w-4 text-violet-600 mt-0.5 shrink-0" />
              <p className="text-sm text-violet-700">
                Zamorax is handling fulfillment for this order — it's been marked shipped on your
                behalf. You'll still be paid out as normal once delivery is confirmed.
              </p>
            </div>
          )}

          {!zamoraxHandling && isLogistics && order.status === "escrow_held" && (
            <Button
              className="w-full bg-primary text-white hover:bg-primary/90 h-11"
              onClick={() => setDropoffOpen(true)}
            >
              <MapPin className="h-4 w-4 mr-2" /> Confirm Drop-off at Agent
            </Button>
          )}

          {isLogistics && order.status === "pending" && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <CreditCard className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-700">
                Waiting for admin to confirm the buyer's payment before you can ship. You'll be notified once escrow is active.
              </p>
            </div>
          )}

          {isLogistics && order.status === "shipped" && (
            <Button variant="outline" disabled className="w-full opacity-70">
              <Package className="h-4 w-4 mr-2" /> Shipment In Transit — ZamoraxLogic handling delivery
            </Button>
          )}

          {!zamoraxHandling && !isLogistics && order.status === "escrow_held" && order.orderType !== "rental" && (
            <div className="flex gap-2">
              <Input
                placeholder="Tracking number (optional)"
                value={tracking}
                onChange={e => setTracking(e.target.value)}
                className="bg-background"
              />
              <Button
                className="bg-primary text-white hover:bg-primary/90 shrink-0"
                onClick={() => updateStatus("shipped")}
                disabled={updating}
              >
                {updating
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><Truck className="h-4 w-4 mr-2" />Mark Shipped</>
                }
              </Button>
            </div>
          )}

          {!isLogistics && order.status === "pending" && order.orderType !== "rental" && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <CreditCard className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-700">
                Waiting for admin to confirm the buyer's payment. You'll be able to mark this shipped once escrow is active.
              </p>
            </div>
          )}

          {order.status === "pending" && order.orderType === "rental" && (
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-primary text-white"
                onClick={() => updateStatus("escrow_held")}
                disabled={updating}
              >
                <Check className="h-4 w-4 mr-2" /> Accept Rental
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => updateStatus("cancelled")}
                disabled={updating}
              >
                Decline
              </Button>
            </div>
          )}

          {order.status === "completed" && (
            <div className="flex items-center justify-center gap-2 text-emerald-600 font-medium text-sm py-2">
              <CheckCircle className="h-4 w-4" /> Order Completed — Funds Released
            </div>
          )}
        </div>
      </div>

      {/* Drop-off dialog */}
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
              Tell us which ZamoraxLogic agent you dropped the item off at. The buyer will be notified immediately.
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
                value={agentAddr}
                onChange={e => setAgentAddr(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDropoffOpen(false)}>Cancel</Button>
            <Button
              className="bg-primary text-white hover:bg-primary/90"
              onClick={handleConfirmDropoff}
              disabled={droppingOff || !agentName.trim() || !agentAddr.trim()}
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
