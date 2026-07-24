"use client"
// app/(admin)/admin/payments/page.tsx
// Admin panel: view and confirm pending manual payments.
// Covers: orders, subscriptions, boosts, and cart_orders.

import { useEffect, useState, useCallback, useRef } from "react"
import { AdminService } from "@/src/services"
import { useAuthStore } from "@/store/authStore"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import {
  CheckCircle2, Clock, Loader2,
  ShoppingBag, Zap, CreditCard, Search,
  ImageIcon, ExternalLink, ShoppingCart, Package2, RefreshCw,
  XCircle, Ban, AlertTriangle,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import type { CartItemGroup } from "@/src/types"

// Quick-select reasons for rejecting a payment — admins reject fast, and a
// full free-text sentence every time tends to get skipped, leaving the
// buyer with no useful explanation. Free text is still available via "Other".
const REJECTION_REASON_PRESETS = [
  "Amount doesn't match the order total",
  "Screenshot is unreadable or invalid",
  "Reference number not found on our bank statement",
  "Duplicate submission — already confirmed elsewhere",
  "Other",
]

const CANCEL_REASON_PRESETS = [
  "Unable to verify payment after multiple attempts",
  "Item no longer available",
  "Suspected fraudulent order",
  "Buyer requested cancellation",
  "Other",
]

interface StuckEscrowOrder {
  id:              string
  buyerName?:      string
  sellerName?:     string
  sellerStoreName?: string
  itemTitle?:      string
  totalAmount:     number
  sellerPayout:    number
  paymentReference?: string
  flwTransactionId?: string | number
  escrowHeldAt?:   string | null
  createdAt?:      string | null
  alreadyConfirmed?: boolean
}

const ESCROW_STUCK_DAYS = 7

interface PendingPayment {
  id:             string
  reference:      string
  purpose:        "order" | "subscription" | "boost" | "cart_order"
  amount:         number
  userId:         string
  provider?:      string
  metadata?:      Record<string, any>
  cartItems?:     CartItemGroup[]    // only present for cart_order
  status:         string
  adminConfirmed: boolean
  proofUrl?:      string
  buyerName?:     string
  createdAt:      string | null
  rejectionReason?: string
  rejectedAt?:      string | null
}

const PURPOSE_ICON = {
  order:        <ShoppingBag className="h-4 w-4" />,
  subscription: <CreditCard  className="h-4 w-4" />,
  boost:        <Zap         className="h-4 w-4" />,
  cart_order:   <ShoppingCart className="h-4 w-4" />,
}

const PURPOSE_COLOR = {
  order:        "bg-blue-100 text-blue-800",
  subscription: "bg-purple-100 text-purple-800",
  boost:        "bg-yellow-100 text-yellow-800",
  cart_order:   "bg-emerald-100 text-emerald-800",
}

function formatKobo(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG")}`
}

function formatDate(ts: string | null | undefined) {
  if (!ts) return "—"
  return new Date(ts).toLocaleString("en-NG", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

export default function AdminPaymentsPage() {
  const { user }   = useAuthStore()
  const { toast }  = useToast()

  const [payments,       setPayments]       = useState<PendingPayment[]>([])
  const [loading,        setLoading]        = useState(true)
  const [confirming,     setConfirming]     = useState<string | null>(null)
  const [filterStatus,   setFilterStatus]   = useState<"all" | "pending" | "confirmed" | "rejected">("pending")
  const [filterPurpose,  setFilterPurpose]  = useState<"all" | "order" | "subscription" | "boost" | "cart_order">("all")
  const [search,         setSearch]         = useState("")
  const [proofOpen,      setProofOpen]      = useState(false)
  const [proofImageUrl,  setProofImageUrl]  = useState<string | null>(null)
  const [expandedCart,   setExpandedCart]   = useState<string | null>(null)

  // ── Stuck escrow orders ───────────────────────────────────────────────
  const [stuckOrders,    setStuckOrders]    = useState<StuckEscrowOrder[]>([])
  const [stuckLoading,   setStuckLoading]   = useState(true)
  const [releaseTarget,  setReleaseTarget]  = useState<StuckEscrowOrder | null>(null)
  const [releasing,      setReleasing]      = useState(false)

  // ── Reject payment dialog ────────────────────────────────────────────
  const [rejectTarget,   setRejectTarget]   = useState<PendingPayment | null>(null)
  const [rejectPreset,   setRejectPreset]   = useState(REJECTION_REASON_PRESETS[0])
  const [rejectCustom,   setRejectCustom]   = useState("")
  const [rejecting,      setRejecting]      = useState(false)

  // ── Cancel order dialog ──────────────────────────────────────────────
  const [cancelTarget,   setCancelTarget]   = useState<PendingPayment | null>(null)
  const [cancelPreset,   setCancelPreset]   = useState(CANCEL_REASON_PRESETS[0])
  const [cancelCustom,   setCancelCustom]   = useState("")
  const [cancelling,     setCancelling]     = useState(false)

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    try {
      // AdminService.getCollection polls D1 directly — no Firestore/onSnapshot
      const rows = await AdminService.getCollection("pending_payments") as Record<string, any>[]
      const mapped: PendingPayment[] = rows.map(r => ({
        id:             String(r.id ?? ""),
        reference:      String(r.reference ?? ""),
        purpose:        (r.purpose ?? "order") as PendingPayment["purpose"],
        amount:         Number(r.amount ?? 0),
        userId:         String(r.userId ?? r.user_id ?? ""),
        provider:       String(r.provider ?? ""),
        status:         String(r.status ?? ""),
        adminConfirmed: Boolean(r.adminConfirmed ?? r.admin_confirmed),
        proofUrl:       r.proofUrl ?? r.proof_url ?? undefined,
        buyerName:      r.buyerName ?? r.buyer_name ?? undefined,
        createdAt:      r.createdAt ?? r.created_at ?? null,
        rejectionReason: r.rejectionReason ?? r.rejection_reason ?? undefined,
        rejectedAt:      r.rejectedAt ?? r.rejected_at ?? null,
        metadata:       (() => {
          try { return typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata ?? {}) }
          catch { return {} }
        })(),
        cartItems:      (() => {
          try { return typeof r.cartItems === "string" ? JSON.parse(r.cartItems) : (r.cartItems ?? undefined) }
          catch { return undefined }
        })(),
        isOfferOrder:   Boolean(r.isOfferOrder ?? r.is_offer_order ?? r.metadata?.isOfferOrder),
        offerId:        r.offerId ?? r.offer_id ?? r.metadata?.offerId ?? undefined,
        originalPrice:  Number(r.originalPrice ?? r.original_price ?? r.metadata?.originalPrice ?? 0),
      }))
      // Sort by createdAt desc
      mapped.sort((a, b) => {
        if (!a.createdAt) return 1
        if (!b.createdAt) return -1
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      setPayments(mapped)
    } catch (err: any) {
      toast({ title: "Failed to load payments", description: err.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  const fetchStuckOrders = useCallback(async () => {
    setStuckLoading(true)
    try {
      const rows = await AdminService.getCollection("orders") as Record<string, any>[]
      const cutoff = Date.now() - ESCROW_STUCK_DAYS * 24 * 60 * 60 * 1000
      const stuck = rows
        .filter(r => {
          const status = String(r.status ?? "")
          const escrowStatus = String(r.escrowStatus ?? r.escrow_status ?? "")
          const provider = String(r.paymentProvider ?? r.payment_provider ?? "")
          if (provider !== "flutterwave") return false

          // Case 1: buyer never confirmed delivery — still sitting held,
          // past the grace period (give buyers a week before nagging admin).
          if (status === "escrow_held") {
            const heldAt = r.escrowHeldAt ?? r.escrow_held_at ?? r.createdAt ?? r.created_at
            if (!heldAt) return false
            const t = new Date(heldAt).getTime()
            return Number.isFinite(t) && t <= cutoff
          }

          // Case 2: buyer already confirmed, order is "completed" in our
          // ledger, but the real Flutterwave settle call failed at that
          // moment (see app/api/orders/confirm-delivery/route.ts) — show
          // these immediately, no waiting period, since the seller's
          // wallet already shows the money and they'll be asking for it.
          if (status === "completed" && escrowStatus === "release_pending") return true

          return false
        })
        .map(r => ({
          id:               String(r.id ?? ""),
          buyerName:        r.buyerName ?? r.buyer_name ?? undefined,
          sellerName:       r.sellerName ?? r.seller_name ?? undefined,
          sellerStoreName:  r.sellerStoreName ?? r.seller_store_name ?? undefined,
          itemTitle:        r.itemTitle ?? r.item_title ?? undefined,
          totalAmount:      Number(r.totalAmount ?? r.total_amount ?? 0),
          sellerPayout:     Number(r.sellerPayout ?? r.seller_payout ?? 0),
          paymentReference: r.paymentReference ?? r.payment_reference ?? undefined,
          flwTransactionId: r.flwTransactionId ?? r.flw_transaction_id ?? undefined,
          escrowHeldAt:     r.escrowHeldAt ?? r.escrow_held_at ?? null,
          createdAt:        r.createdAt ?? r.created_at ?? null,
          alreadyConfirmed: String(r.status ?? "") === "completed",
        }))
        .sort((a, b) => new Date(a.escrowHeldAt ?? a.createdAt ?? 0).getTime() - new Date(b.escrowHeldAt ?? b.createdAt ?? 0).getTime())
      setStuckOrders(stuck)
    } catch (err: any) {
      toast({ title: "Failed to load stuck escrow orders", description: err.message, variant: "destructive" })
    } finally {
      setStuckLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchPayments()
    fetchStuckOrders()
  }, [fetchPayments, fetchStuckOrders])

  const releasingRef = useRef<Set<string>>(new Set())

  const handleReleaseEscrow = async () => {
    if (!releaseTarget) return
    if (releasingRef.current.has(releaseTarget.id)) return
    releasingRef.current.add(releaseTarget.id)
    setReleasing(true)
    try {
      const res  = await fetch("/api/payment/release-escrow", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId: releaseTarget.id, adminId: user?.uid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setStuckOrders(prev => prev.filter(o => o.id !== releaseTarget.id))
      toast({
        title:       "✅ Escrow Released",
        description: `Funds released to ${releaseTarget.sellerName ?? "seller"} for "${releaseTarget.itemTitle ?? "order"}".`,
        variant:     "success",
      })
      setReleaseTarget(null)
    } catch (err: any) {
      toast({ title: "Release failed", description: err.message, variant: "destructive" })
    } finally {
      releasingRef.current.delete(releaseTarget.id)
      setReleasing(false)
    }
  }

  const filtered = payments.filter(p => {
    // This page is for confirming manual bank transfers only. Paystack /
    // Flutterwave payments are verified automatically with the gateway
    // (see create-pending-orders / activate-paystack) and never need — or
    // get — a manual confirm button here. Once verified, their
    // pending_payments row is also flipped to adminConfirmed so this is
    // mostly a safety net for any older/unmigrated rows.
    const isOnlineProvider = p.provider === "paystack" || p.provider === "flutterwave"
    if (isOnlineProvider && !p.adminConfirmed && p.status !== "rejected") return false

    const isRejected = p.status === "rejected"
    if (filterStatus === "pending"   && (p.adminConfirmed || isRejected)) return false
    if (filterStatus === "confirmed" && !p.adminConfirmed) return false
    if (filterStatus === "rejected"  && !isRejected) return false
    if (filterPurpose !== "all" && p.purpose !== filterPurpose) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        p.reference.toLowerCase().includes(s) ||
        p.userId.toLowerCase().includes(s)    ||
        p.metadata?.orderId?.toLowerCase().includes(s) ||
        p.buyerName?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const confirmingRef = useRef<Set<string>>(new Set())

  const handleConfirm = async (payment: PendingPayment) => {
    // Synchronous guard — React state updates aren't instant, so a fast
    // double-tap can fire this twice before `disabled` takes effect.
    if (confirmingRef.current.has(payment.id) || payment.adminConfirmed) return
    confirmingRef.current.add(payment.id)
    setConfirming(payment.id)
    try {
      // Cart orders go to /api/cart/confirm; everything else to /api/payment/confirm
      const isCart   = payment.purpose === "cart_order"
      const endpoint = isCart ? "/api/cart/confirm" : "/api/payment/confirm"

      const body = isCart
        ? { reference: payment.reference, adminId: user?.uid }
        : {
            reference:      payment.reference,
            adminId:        user?.uid,
            purpose:        payment.purpose,
            orderId:        payment.metadata?.orderId,
            boostId:        payment.metadata?.boostId,
            adBoostId:      payment.metadata?.adBoostId,
            subscriptionId: payment.metadata?.subscriptionId,
          }

      const res  = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      // Mark confirmed in local state immediately — button disappears without needing a refresh
      setPayments(prev =>
        prev.map(p => p.id === payment.id ? { ...p, adminConfirmed: true, status: "confirmed" } : p)
      )

      toast({
        title:       "✅ Payment Confirmed",
        description: `${payment.reference} — ${isCart ? "cart order" : payment.purpose} activated.`,
        variant:     "success",
      })
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" })
    } finally {
      confirmingRef.current.delete(payment.id)
      setConfirming(null)
    }
  }

  const openProof = (url: string) => {
    setProofImageUrl(url)
    setProofOpen(true)
  }

  const rejectingRef = useRef<Set<string>>(new Set())

  const handleReject = async () => {
    if (!rejectTarget) return
    if (rejectingRef.current.has(rejectTarget.id)) return
    const reason = rejectPreset === "Other" ? rejectCustom.trim() : rejectPreset
    if (!reason) {
      toast({ title: "Please provide a reason", variant: "destructive" })
      return
    }
    rejectingRef.current.add(rejectTarget.id)
    setRejecting(true)
    try {
      const res  = await fetch("/api/payment/reject", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reference: rejectTarget.reference, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setPayments(prev =>
        prev.map(p => p.id === rejectTarget.id ? { ...p, status: "rejected", rejectionReason: reason } : p)
      )
      toast({
        title:       "Payment Rejected",
        description: "Buyer and seller have been notified.",
        variant:     "success",
      })
      setRejectTarget(null)
      setRejectPreset(REJECTION_REASON_PRESETS[0])
      setRejectCustom("")
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" })
    } finally {
      rejectingRef.current.delete(rejectTarget.id)
      setRejecting(false)
    }
  }

  const cancellingRef = useRef<Set<string>>(new Set())

  const handleCancelOrder = async () => {
    if (!cancelTarget) return
    const orderId = cancelTarget.metadata?.orderId
    if (!orderId) {
      toast({ title: "No order linked to this payment", variant: "destructive" })
      return
    }
    if (cancellingRef.current.has(orderId)) return
    const reason = cancelPreset === "Other" ? cancelCustom.trim() : cancelPreset
    if (!reason) {
      toast({ title: "Please provide a reason", variant: "destructive" })
      return
    }
    cancellingRef.current.add(orderId)
    setCancelling(true)
    try {
      const res  = await fetch("/api/orders/cancel-admin", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      // Order is permanently deleted — buyer and seller will never see it
      // again, so remove this payment row entirely rather than marking it.
      setPayments(prev => prev.filter(p => p.id !== cancelTarget.id))
      toast({
        title:       "Order Cancelled",
        description: "Order deleted. Buyer and seller have been notified by email.",
        variant:     "success",
      })
      setCancelTarget(null)
      setCancelPreset(CANCEL_REASON_PRESETS[0])
      setCancelCustom("")
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" })
    } finally {
      cancellingRef.current.delete(orderId)
      setCancelling(false)
    }
  }

  return (
    <div className="container max-w-5xl py-8 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pending Payments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Confirm manual bank transfers from buyers
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3.5 w-3.5" />
          {payments.filter(p => !p.adminConfirmed && p.status !== "rejected" && p.provider !== "paystack" && p.provider !== "flutterwave").length} pending
        </Badge>
        <Button variant="outline" size="sm" onClick={fetchPayments} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stuck Escrow Orders */}
      {!stuckLoading && stuckOrders.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 overflow-hidden">
          <div className="px-5 py-3 border-b border-orange-200 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
            <h2 className="font-semibold text-orange-900">
              Stuck Escrow ({stuckOrders.length})
            </h2>
          </div>
          <p className="px-5 pt-3 text-sm text-orange-800">
            Real funds are still held at Flutterwave for these orders — either the buyer hasn't confirmed
            delivery after {ESCROW_STUCK_DAYS}+ days, or they confirmed but the automatic release failed.
            Release manually once you've confirmed the order should be paid out.
          </p>
          <div className="divide-y divide-orange-200">
            {stuckOrders.map(order => (
              <div key={order.id} className="px-5 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium truncate">{order.itemTitle ?? "Order"}</p>
                  <p className="text-sm text-muted-foreground">
                    Seller: {order.sellerStoreName || order.sellerName || "—"} · Buyer: {order.buyerName ?? "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Payout: {formatKobo(order.sellerPayout || order.totalAmount)} · Held since {formatDate(order.escrowHeldAt ?? order.createdAt)}
                  </p>
                  {order.alreadyConfirmed && (
                    <p className="text-xs text-amber-700 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Buyer already confirmed delivery — seller's wallet was credited, but the real Flutterwave payout failed and is still pending.
                    </p>
                  )}
                  {!order.flwTransactionId && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> No Flutterwave transaction id on file — release will fail; settle manually via the Flutterwave dashboard instead.
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  className="bg-orange-600 hover:bg-orange-700 text-white shrink-0"
                  onClick={() => setReleaseTarget(order)}
                >
                  Release Escrow
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by reference, user, or buyer name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={filterStatus}
          onValueChange={v => setFilterStatus(v as "all" | "pending" | "confirmed")}
        >
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filterPurpose}
          onValueChange={v => setFilterPurpose(v as any)}
        >
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="order">Orders</SelectItem>
            <SelectItem value="cart_order">Cart Orders 🛒</SelectItem>
            <SelectItem value="subscription">Subscriptions</SelectItem>
            <SelectItem value="boost">Boosts</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-500" />
          <p className="font-medium">No pending payments</p>
          <p className="text-sm mt-1">All payments are confirmed.</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden divide-y divide-border">
          {filtered.map(payment => {
            const isCart = payment.purpose === "cart_order"
            const cartItems = payment.cartItems ?? []
            const totalItems = cartItems.reduce((s, g) => s + g.lineItems.reduce((ss, l) => ss + l.qty, 0), 0)
            const isExpanded = expandedCart === payment.id

            return (
              <div key={payment.id} className="px-5 py-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-1.5">

                    {/* Reference + badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold truncate">{payment.reference}</span>
                      <Badge className={`gap-1 text-xs ${PURPOSE_COLOR[payment.purpose]}`}>
                        {PURPOSE_ICON[payment.purpose]}
                        {isCart ? "Cart Order 🛒" : payment.purpose}
                      </Badge>
                      {payment.adminConfirmed && (
                        <Badge className="bg-green-100 text-green-800 text-xs gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Confirmed
                        </Badge>
                      )}
                      {(payment as any).isOfferOrder && (
                        <Badge className="bg-orange-100 text-orange-800 text-xs gap-1">
                          🏷️ Offer Price
                        </Badge>
                      )}
                      {payment.proofUrl ? (
                        <Badge className="bg-sky-100 text-sky-800 text-xs gap-1">
                          <ImageIcon className="h-3 w-3" /> Proof attached
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
                          <ImageIcon className="h-3 w-3" /> No proof
                        </Badge>
                      )}
                    </div>

                    {/* Amount + date + summary */}
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                      <span className="font-semibold text-foreground">{formatKobo(payment.amount)}</span>
                      <span>·</span>
                      <span>{formatDate(payment.createdAt)}</span>
                      {payment.buyerName && (
                        <><span>·</span><span>{payment.buyerName}</span></>
                      )}
                      {isCart && cartItems.length > 0 && (
                        <><span>·</span>
                        <button
                          onClick={() => setExpandedCart(isExpanded ? null : payment.id)}
                          className="text-primary text-xs hover:underline"
                        >
                          {totalItems} item{totalItems !== 1 ? "s" : ""} from {cartItems.length} seller{cartItems.length !== 1 ? "s" : ""} {isExpanded ? "▲" : "▼"}
                        </button>
                        </>
                      )}
                      {payment.metadata?.orderId && (
                        <><span>·</span><span>Order: {payment.metadata.orderId.slice(-6).toUpperCase()}</span></>
                      )}
                    </div>

                    {/* Cart order breakdown */}
                    {isCart && isExpanded && cartItems.length > 0 && (
                      <div className="mt-2 rounded-xl border border-border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold">Seller</th>
                              <th className="text-left px-3 py-2 font-semibold">Items</th>
                              <th className="text-right px-3 py-2 font-semibold">Subtotal</th>
                              <th className="text-right px-3 py-2 font-semibold">Delivery</th>
                              <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Platform Fee</th>
                              <th className="text-right px-3 py-2 font-semibold text-green-700">Seller Payout</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {cartItems.map((group, i) => (
                              <tr key={i} className="hover:bg-muted/30">
                                <td className="px-3 py-2 font-medium">{group.sellerName}</td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {group.lineItems.map(l => `${l.title} ×${l.qty}`).join(", ")}
                                </td>
                                <td className="px-3 py-2 text-right">{formatKobo(group.subtotal)}</td>
                                <td className="px-3 py-2 text-right">{group.deliveryFee === 0 ? "Free" : formatKobo(group.deliveryFee)}</td>
                                <td className="px-3 py-2 text-right text-muted-foreground">{formatKobo(group.platformFee)}</td>
                                <td className="px-3 py-2 text-right text-green-700 font-semibold">{formatKobo(group.sellerPayout)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Proof thumbnail */}
                    {payment.proofUrl && (
                      <button
                        onClick={() => openProof(payment.proofUrl!)}
                        className="mt-1 flex items-center gap-2 group"
                        title="View payment proof"
                      >
                        <img
                          src={payment.proofUrl}
                          alt="Payment proof thumbnail"
                          className="h-14 w-20 object-cover rounded-lg border border-border group-hover:border-primary transition"
                        />
                        <span className="text-xs text-primary flex items-center gap-1 group-hover:underline">
                          <ExternalLink className="h-3 w-3" /> View full proof
                        </span>
                      </button>
                    )}
                    {/* Rejection reason, if this payment was rejected */}
                    {payment.status === "rejected" && payment.rejectionReason && (
                      <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5">
                        <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                        <span className="text-xs text-red-700">
                          <span className="font-semibold">Rejected:</span> {payment.rejectionReason}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {!payment.adminConfirmed && payment.status !== "rejected" && (
                    <div className="flex flex-col gap-1.5 shrink-0 mt-0.5">
                      <Button
                        size="sm"
                        onClick={() => handleConfirm(payment)}
                        disabled={confirming === payment.id}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {confirming === payment.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                        }
                        Confirm Received
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRejectTarget(payment)}
                        className="border-red-300 text-red-600 hover:bg-red-50"
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1.5" />
                        Reject
                      </Button>
                      {payment.metadata?.orderId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setCancelTarget(payment)}
                          className="border-gray-300 text-gray-600 hover:bg-gray-50"
                        >
                          <Ban className="h-3.5 w-3.5 mr-1.5" />
                          Cancel Order
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Reject payment dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" />
              Reject Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Reference <span className="font-mono">{rejectTarget?.reference}</span> will be rejected.
              The buyer can resubmit payment on the same order — no new order is created.
              Both buyer and seller will be emailed this reason.
            </p>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={rejectPreset} onValueChange={setRejectPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REJECTION_REASON_PRESETS.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {rejectPreset === "Other" && (
              <div className="space-y-1.5">
                <Label>Describe the reason</Label>
                <Textarea
                  value={rejectCustom}
                  onChange={e => setRejectCustom(e.target.value)}
                  placeholder="e.g. Transfer was made from a different account name"
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectTarget(null)} disabled={rejecting}>
              Cancel
            </Button>
            <Button
              onClick={handleReject}
              disabled={rejecting || (rejectPreset === "Other" && !rejectCustom.trim())}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <XCircle className="h-4 w-4 mr-1.5" />}
              Reject Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel order dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-gray-700" />
              Cancel Order
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                This permanently deletes the order. The buyer and seller will not see it in their
                dashboards again — they will only learn about it through the email sent below. This
                cannot be undone.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={cancelPreset} onValueChange={setCancelPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CANCEL_REASON_PRESETS.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {cancelPreset === "Other" && (
              <div className="space-y-1.5">
                <Label>Describe the reason</Label>
                <Textarea
                  value={cancelCustom}
                  onChange={e => setCancelCustom(e.target.value)}
                  placeholder="e.g. Listing was removed for policy violation"
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelTarget(null)} disabled={cancelling}>
              Back
            </Button>
            <Button
              onClick={handleCancelOrder}
              disabled={cancelling || (cancelPreset === "Other" && !cancelCustom.trim())}
              className="bg-gray-800 hover:bg-gray-900 text-white"
            >
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Ban className="h-4 w-4 mr-1.5" />}
              Delete Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release escrow confirmation */}
      <Dialog open={!!releaseTarget} onOpenChange={(open) => { if (!open) setReleaseTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              Release Escrow
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                This calls Flutterwave's escrow settlement API and pays the seller immediately. Only do
                this once you've independently confirmed the order was actually fulfilled — this cannot
                be reversed from here.
              </p>
            </div>
            {releaseTarget && (
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Item:</span> {releaseTarget.itemTitle ?? "—"}</p>
                <p><span className="text-muted-foreground">Seller:</span> {releaseTarget.sellerStoreName || releaseTarget.sellerName || "—"}</p>
                <p><span className="text-muted-foreground">Payout:</span> {formatKobo(releaseTarget.sellerPayout || releaseTarget.totalAmount)}</p>
                <p><span className="text-muted-foreground">Held since:</span> {formatDate(releaseTarget.escrowHeldAt ?? releaseTarget.createdAt)}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReleaseTarget(null)} disabled={releasing}>
              Back
            </Button>
            <Button
              onClick={handleReleaseEscrow}
              disabled={releasing}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {releasing ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
              Confirm Release
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Proof lightbox */}
      <Dialog open={proofOpen} onOpenChange={setProofOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" />
              Payment Proof
            </DialogTitle>
          </DialogHeader>
          {proofImageUrl && (
            <div className="space-y-3">
              <img
                src={proofImageUrl}
                alt="Full payment proof"
                className="w-full rounded-xl border border-border object-contain max-h-[60vh]"
              />
              <a
                href={proofImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open original image
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}
