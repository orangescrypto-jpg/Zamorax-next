"use client"

import { AdminService, OrdersService } from "@/src/services"
// app/(buyer)/dashboard/buyer/orders/[id]/page.tsx

import { useEffect, useState, useRef } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ShipmentTracker } from "@/components/logistics/ShipmentTracker"
import { ReviewForm } from "@/components/reviews/ReviewForm"
import { ManualPaymentInstructions } from "@/components/payment/ManualPaymentInstructions"
import { formatPrice } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"
import {
  Loader2, ArrowLeft, CheckCircle, ShieldCheck,
  AlertTriangle, MessageSquare, Download, Package, Truck,
  Clock, CreditCard, Star, XCircle,
} from "lucide-react"
import Link from "next/link"

const TIMELINE_STEPS = [
  { key: "pending",     label: "Order Placed",    icon: Package,     desc: "Your order has been placed" },
  { key: "escrow_held", label: "Payment Secured", icon: CreditCard,  desc: "Funds held safely in escrow" },
  { key: "shipped",     label: "Shipped",          icon: Truck,       desc: "Seller has shipped your item" },
  { key: "delivered",   label: "Delivered",        icon: CheckCircle, desc: "Item arrived — please confirm" },
  { key: "completed",   label: "Completed",        icon: Star,        desc: "Escrow released to seller" },
]

const STATUS_ORDER = ["pending", "escrow_held", "shipped", "delivered", "inspecting", "completed"]

const statusColors: Record<string, string> = {
  pending:     "bg-gray-100 text-gray-800",
  escrow_held: "bg-blue-100 text-blue-800",
  shipped:     "bg-purple-100 text-purple-800",
  delivered:   "bg-amber-100 text-amber-800",
  inspecting:  "bg-orange-100 text-orange-800",
  completed:   "bg-emerald-100 text-emerald-800",
  disputed:    "bg-red-100 text-red-800",
  cancelled:   "bg-gray-100 text-gray-500",
  refunded:    "bg-gray-100 text-gray-500",
  payment_rejected: "bg-red-100 text-red-800",
}

function OrderTimeline({ status }: { status: string }) {
  const currentIndex = STATUS_ORDER.indexOf(status)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" /> Order Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="relative">
          <div className="absolute left-[18px] top-6 bottom-6 w-0.5 bg-muted" />
          <div className="space-y-4">
            {TIMELINE_STEPS.map((step) => {
              const stepIndex = STATUS_ORDER.indexOf(step.key)
              const isDone   = stepIndex <= currentIndex && currentIndex >= 0
              const isActive = step.key === status || (status === "inspecting" && step.key === "delivered")
              const Icon     = step.icon
              return (
                <div key={step.key} className="flex items-start gap-4 relative">
                  <div className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center shrink-0 border-2 transition-all duration-300
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
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {/* "Delivered" step text was identical whether or not the buyer had
                          already confirmed receipt — looked like the click did nothing. */}
                      {step.key === "delivered" && status === "inspecting"
                        ? "Receipt confirmed — 12-hour inspection window in progress"
                        : step.desc}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── FIX: params is a Promise in Next.js App Router ───────────────
export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = useAuth()
  const router   = useRouter()
  const { toast } = useToast()

  const [orderId,    setOrderId]    = useState<string | null>(null)
  const [order,      setOrder]      = useState<any>(null)
  const [loading,    setLoading]    = useState(true)
  const [showReview, setShowReview] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [showCancelConfirm,  setShowCancelConfirm]  = useState(false)
  const [showConfirmDelivery, setShowConfirmDelivery] = useState(false)
  const [showEarlyRelease,   setShowEarlyRelease]   = useState(false)
  const [retrying,       setRetrying]       = useState(false)
  const [retryData,      setRetryData]      = useState<{ reference: string; bankDetails: any; amount: number } | null>(null)

  // D1 replica lag guard: after a write we optimistically set status locally.
  // The next poll(s) can read stale data from a replica and revert it.
  // lockedUntilRef holds the timestamp until which poll updates that would
  // downgrade status are silently ignored.
  const STATUS_RANK: Record<string, number> = {
    pending: 0, escrow_held: 1, shipped: 2,
    delivered: 3, inspecting: 3, completed: 4, refunded: 4, cancelled: 4, disputed: 4,
  }
  const lockedUntilRef = useRef<number>(0)

  // Unwrap async params — Next.js App Router
  useEffect(() => {
    params.then(p => setOrderId(p.id))
  }, [params])

  // Subscribe to order once orderId is known
  useEffect(() => {
    if (!orderId) return
    const unsub = AdminService.subscribeToDoc("orders", orderId, doc => {
      if (doc) {
        setOrder((prev: any) => {
          // If we're within a lock window and the incoming status would
          // downgrade (or equal) the current optimistic status, discard it.
          if (
            prev &&
            Date.now() < lockedUntilRef.current &&
            (STATUS_RANK[doc.status] ?? 0) <= (STATUS_RANK[prev.status] ?? 0)
          ) {
            return prev
          }
          return { ...doc, id: orderId }
        })
      }
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [orderId])

  const handleCancel = async () => {
    if (!orderId) return
    setShowCancelConfirm(false)
    setCancelling(true)
    try {
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel")
      toast({ title: "Order cancelled", variant: "success" })
    } catch (err: any) {
      toast({ title: "Could not cancel", description: err.message, variant: "destructive" })
    } finally {
      setCancelling(false)
    }
  }

  const handleRetryPayment = async () => {
    if (!orderId) return
    setRetrying(true)
    try {
      const res = await fetch("/api/payment/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? "Failed to start payment retry")

      // Show fresh bank-transfer instructions inline using the new reference
      setRetryData({
        reference:   data.reference,
        bankDetails: data.bankDetails,
        amount:      data.amount,
      })
      // Optimistically flip to pending so the rejection banner clears
      lockedUntilRef.current = Date.now() + 30_000
      setOrder((prev: any) => prev ? {
        ...prev,
        status: "pending",
        rejectionReason: null,
        rejected_at: null,
        paymentRetryCount: (prev.paymentRetryCount ?? prev.payment_retry_count ?? 0) + 1,
      } : prev)
    } catch (err: any) {
      toast({ title: "Could not retry payment", description: err.message, variant: "destructive" })
    } finally {
      setRetrying(false)
    }
  }

  const handleConfirmDelivery = async () => {
    if (!orderId || !user?.uid) return
    setShowConfirmDelivery(false)
    setConfirming(true)
    try {
      const escrowReleaseAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
      await AdminService.updateDoc("orders", orderId, {
        status: "inspecting",
        delivered_at: new Date().toISOString(),
        escrow_release_at: escrowReleaseAt,
      })
      // Lock the poller from reverting this for 30s (D1 replica lag)
      lockedUntilRef.current = Date.now() + 30_000
      // Order details poll every 15s — update local state now instead of
      // leaving the page looking unchanged until the next poll tick.
      setOrder((prev: any) => prev ? {
        ...prev,
        status: "inspecting",
        deliveredAt: new Date().toISOString(),
        escrowReleaseAt,
      } : prev)
      await AdminService.addDoc("notifications", {
        user_id: order.sellerId,
        type: "system",
        title: "📦 Buyer confirmed receipt!",
        body: `Buyer confirmed delivery of "${order.itemTitle}". Payment will auto-release in 12 hours unless a dispute is opened.`,
        link: `/dashboard/seller/orders/${orderId}`,
        is_read: false,
      })
      toast({ title: "Delivery confirmed! ✅", description: "12-hour inspection window started. Payment auto-releases after that.", variant: "success" })
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" })
    } finally {
      setConfirming(false)
    }
  }

  const handleEarlyRelease = async () => {
    if (!orderId || !user?.uid) return
    setShowEarlyRelease(false)
    setConfirming(true)
    try {
      // FIX: this used to call OrdersService.releaseEscrow(), which does the
      // wallet-credit upsert client-side via AdminService -> the D1 proxy.
      // That path throws "ON CONFLICT clause does not match any PRIMARY KEY
      // or UNIQUE constraint: SQLITE_ERROR" because the proxy row-scopes the
      // seller_wallets write to the buyer's own uid (see confirm-delivery
      // route.ts for the full explanation), so the upsert's ON CONFLICT
      // target never lines up. Use the server-side route instead, which
      // does the whole release (order update + wallet credit + wallet
      // transaction + notification) with the server's own D1 access.
      const res = await fetch("/api/orders/confirm-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? "Failed to release payment")

      // FIX: seller never received the "Escrow Released" email — only an
      // in-app notification. This route sends it server-side (the browser
      // can't hold the internal email secret). Fire-and-forget: it must
      // never block the buyer's success toast.
      fetch("/api/orders/notify-escrow-released", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      }).catch(() => { /* non-fatal — seller still has the in-app notification */ })
      // Lock poller + optimistically flip to completed immediately
      lockedUntilRef.current = Date.now() + 30_000
      setOrder((prev: any) => prev ? {
        ...prev,
        status: "completed",
        escrowStatus: "released_to_seller",
        completedAt: new Date().toISOString(),
      } : prev)
      toast({ title: "Payment released! 🎉", description: "The seller has been notified and funds credited.", variant: "success" })
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" })
    } finally {
      setConfirming(false)
    }
  }

  if (loading) return (
    <div className="container flex h-[60vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )

  if (!order) return (
    <div className="container py-16 text-center">
      <p className="text-muted-foreground">Order not found.</p>
      <Button asChild variant="outline" className="mt-4">
        <Link href="/dashboard/buyer/orders">Back to Orders</Link>
      </Button>
    </div>
  )

  const canConfirm     = ["shipped", "delivered"].includes(order.status) && order.buyerId === user?.uid
  const isInspecting   = order.status === "inspecting" && order.buyerId === user?.uid
  const escrowDeadline = order.escrow_release_at ?? order.escrowReleaseAt
  const canDispute  = ["escrow_held", "shipped", "delivered", "inspecting"].includes(order.status)
  const canCancel   = order.status === "pending" && order.buyerId === user?.uid
  const isComplete  = ["completed", "refunded"].includes(order.status)
  const isLogistics = order.deliveryMethod === "zamorax_logistics"
  const isFBZ       = order.deliveryMethod === "fbz"

  return (
    <div className="container py-8 max-w-2xl space-y-6 pb-24 md:pb-8">
      <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1 -ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to Orders
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold truncate">{order.itemTitle || "Order"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Order #{order.id.slice(0, 8).toUpperCase()}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {isLogistics && (
              <Badge className="bg-primary/10 text-primary text-xs flex items-center gap-1">
                <Package className="h-3 w-3" /> Zamorax Logistics
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
        <Badge className={statusColors[order.status] || "bg-gray-100"}>
          {order.status?.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Shipment Tracker — ZLA orders only */}
      {isLogistics && order.zlaShipmentId && order.zlaTrackingCode && (
        <ShipmentTracker shipmentId={order.zlaShipmentId} trackingCode={order.zlaTrackingCode} />
      )}

      {/* Visual Timeline */}
      {!isLogistics && !["cancelled", "disputed", "payment_rejected"].includes(order.status) && (
        <OrderTimeline status={order.status} />
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

      {/* Payment rejected — show reason + retry */}
      {order.status === "payment_rejected" && !retryData && (
        <div className="flex flex-col gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-start gap-2">
            <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700">Your payment was rejected</p>
              <p className="text-xs text-red-600 mt-0.5">
                {order.rejectionReason || order.rejection_reason || "The admin could not verify your proof of payment."}
              </p>
            </div>
          </div>
          <Button
            className="w-full bg-red-600 hover:bg-red-700 text-white"
            onClick={handleRetryPayment}
            disabled={retrying}
          >
            {retrying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
            {retrying ? "Starting retry…" : "Retry Payment"}
          </Button>
        </div>
      )}

      {/* Payment retry — fresh bank transfer instructions */}
      {retryData && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Resubmit Your Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <ManualPaymentInstructions
              amount={retryData.amount}
              reference={retryData.reference}
              bankDetails={retryData.bankDetails}
              userId={user?.uid || ""}
              purpose="order"
              onConfirmed={async () => {
                toast({ title: "Proof submitted!", description: "We'll review your new payment shortly.", variant: "success" })
                setRetryData(null)
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Order Details */}
      <Card>
        <CardHeader><CardTitle className="text-base">Order Details</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Item</span>
            <span className="font-medium truncate ml-4">{order.itemTitle}</span>
          </div>
          {/* Fashion variant — Buy Now orders carry the selection on the
              order itself. Cart orders (multi-item) show it per line below
              instead, since each line can be a different color/size. */}
          {(!order.lineItems || order.lineItems.length <= 1) && (order.selectedColor || order.selectedSize) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Option</span>
              <span className="font-medium">{[order.selectedColor, order.selectedSize].filter(Boolean).join(" · ")}</span>
            </div>
          )}
          {order.lineItems && order.lineItems.length > 1 && (
            <div className="space-y-1 border-t border-border pt-2">
              {order.lineItems.map((li, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-muted-foreground truncate pr-2">
                    {li.title}
                    {(li.selectedColor || li.selectedSize) && (
                      <span className="text-muted-foreground/70"> ({[li.selectedColor, li.selectedSize].filter(Boolean).join(", ")})</span>
                    )}
                  </span>
                  <span className="font-medium shrink-0">× {li.qty}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Type</span>
            <span className="capitalize">{order.orderType || "purchase"}</span>
          </div>
          {order.orderType === "rental" && order.rentalStart && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rental Period</span>
              <span>{new Date(order.rentalStart).toLocaleDateString()} — {new Date(order.rentalEnd).toLocaleDateString()}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Order Date</span>
            <span>{
              order.createdAt
                ? (typeof order.createdAt === "string"
                    ? new Date(order.createdAt).toLocaleDateString()
                    : order.createdAt?.toDate?.().toLocaleDateString?.() ?? "—")
                : "—"
            }</span>
          </div>
          {(order.zlaTrackingCode || order.trackingCode) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1"><Truck className="h-3 w-3" /> Tracking</span>
              <span className="font-mono text-xs">{order.zlaTrackingCode || order.trackingCode}</span>
            </div>
          )}
          {isLogistics && order.deliveryFee > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery Fee</span>
              <span>{formatPrice(order.deliveryFee)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Item Price</span>
            <span>{formatPrice(order.itemPrice || order.totalAmount || 0)}</span>
          </div>
          {(order.totalAmount - (order.itemPrice || order.totalAmount)) > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Processing Fee</span>
              <span>+{formatPrice(order.totalAmount - (order.itemPrice || order.totalAmount))}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <span>Total Paid</span>
            <span>{formatPrice(order.totalAmount || 0)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Shipped — prompt buyer to confirm */}
      {order.status === "shipped" && (
        <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <Truck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-primary">Your item is on the way!</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Once you receive it, tap <strong>"I've Received It"</strong> below to start your 12-hour inspection window.
              {(order.zlaTrackingCode || order.trackingNumber) && (
                <> Track with code: <span className="font-mono">{order.zlaTrackingCode || order.trackingNumber}</span></>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Inspecting — countdown banner */}
      {order.status === "inspecting" && escrowDeadline && (
        <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <Clock className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-orange-800">Inspection window is open</p>
            <p className="text-xs text-orange-700 mt-0.5">
              Payment auto-releases to seller at <strong>{new Date(escrowDeadline).toLocaleString()}</strong>.
              If you have an issue with the item, open a dispute before then.
            </p>
          </div>
        </div>
      )}

      {/* Escrow notice */}
      {order.status === "escrow_held" && (
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <ShieldCheck className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-700">
            Your payment is safely held in escrow. Released to seller only after you confirm receipt.
          </p>
        </div>
      )}

      {/* Review prompt */}
      {isComplete && !order.buyerReviewed && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-500 fill-amber-400" />
            <p className="text-sm font-semibold text-amber-800">How was your experience?</p>
          </div>
          <p className="text-xs text-amber-700">Rate your seller to help other buyers on Zamorax.</p>
          {!showReview ? (
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setShowReview(true)}>
              Leave a Review
            </Button>
          ) : (
            <ReviewForm
              orderId={order.id}
              sellerId={order.sellerId}
              sellerName={order.sellerStoreName || order.sellerName || "Seller"}
              onDone={() => setShowReview(false)}
            />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3">
        {canConfirm && (
          <>
            {!showConfirmDelivery ? (
              <Button
                className="w-full bg-primary text-white hover:bg-primary/90"
                onClick={() => setShowConfirmDelivery(true)}
                disabled={confirming}
              >
                <CheckCircle className="h-4 w-4 mr-2" /> I&apos;ve Received It — Start Inspection
              </Button>
            ) : (
              <div className="border border-primary/30 rounded-xl p-4 bg-primary/5 space-y-3">
                <p className="text-sm font-medium">Confirm you received this item?</p>
                <p className="text-xs text-muted-foreground">A 12-hour inspection window starts. Payment auto-releases after that unless you open a dispute.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setShowConfirmDelivery(false)}>Cancel</Button>
                  <Button className="flex-1 bg-primary text-white" onClick={handleConfirmDelivery} disabled={confirming}>
                    {confirming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {confirming ? "Confirming…" : "Yes, I received it"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {isInspecting && (
          <>
            {!showEarlyRelease ? (
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setShowEarlyRelease(true)}
                disabled={confirming}
              >
                <CheckCircle className="h-4 w-4 mr-2" /> Happy with Item — Release Payment Now
              </Button>
            ) : (
              <div className="border border-emerald-200 rounded-xl p-4 bg-emerald-50 space-y-3">
                <p className="text-sm font-medium text-emerald-800">Release payment to seller?</p>
                <p className="text-xs text-emerald-700">This cannot be undone. Only do this if you are satisfied with the item.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setShowEarlyRelease(false)}>Cancel</Button>
                  <Button className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={handleEarlyRelease} disabled={confirming}>
                    {confirming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {confirming ? "Releasing…" : "Yes, release payment"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {isComplete && (
          <Button asChild variant="outline" className="w-full">
            <a href={`/api/receipts/${orderId}`} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4 mr-2" /> Download Receipt
            </a>
          </Button>
        )}

        {canDispute && (
          <Button asChild variant="outline" className="w-full border-red-200 text-red-600 hover:bg-red-50">
            <Link href={`/dashboard/buyer/disputes/new?orderId=${orderId}`}>
              <AlertTriangle className="h-4 w-4 mr-2" /> Open a Dispute
            </Link>
          </Button>
        )}

        {order.chatId && (
          <Button asChild variant="ghost" className="w-full">
            <Link href={`/chat/${order.chatId}`}>
              <MessageSquare className="h-4 w-4 mr-2" /> Message Seller
            </Link>
          </Button>
        )}

        {canCancel && (
          <>
            {!showCancelConfirm ? (
              <Button
                variant="outline"
                className="w-full border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => setShowCancelConfirm(true)}
                disabled={cancelling}
              >
                <XCircle className="h-4 w-4 mr-2" /> Cancel Order
              </Button>
            ) : (
              <div className="border border-red-200 rounded-xl p-4 bg-red-50 space-y-3">
                <p className="text-sm font-medium text-red-700">Cancel this order?</p>
                <p className="text-xs text-red-600">This cannot be undone.</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setShowCancelConfirm(false)}>Go Back</Button>
                  <Button variant="destructive" className="flex-1" onClick={handleCancel} disabled={cancelling}>
                    {cancelling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {cancelling ? "Cancelling…" : "Yes, cancel"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
