"use client"
// app/(admin)/admin/orders/page.tsx
// Admin: manage ALL orders regardless of status. Distinct from /admin/payments,
// which only shows pending_payments rows awaiting a manual bank-transfer
// confirmation. This page is where an admin goes to:
//   - Reverse a payment on an order that already moved money (escrow_held,
//     shipped, delivered, completed) — refunds via Paystack where possible,
//     claws back the seller's wallet if they were already paid out, and
//     marks the order "refunded" without deleting it (audit trail).
//   - Force-delete an order at ANY stage, including completed/refunded ones
//     — same money clawback as Reverse Payment, but the row is removed
//     entirely instead of kept as "refunded".

import { useEffect, useState, useCallback } from "react"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { formatPrice } from "@/lib/utils"
import { Loader2, RefreshCw, Search, Undo2, Trash2, AlertTriangle, Package } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

// Middleware requires an Authorization header on any non-GET /api/admin/*
// request (see middleware.ts "Admin API header check") — GET requests to
// this same page's list endpoint are exempted, which is why loading orders
// works without this, but POST actions like Mark Shipped were silently
// rejected before reaching the route at all. Attach the current session's
// access token so those requests pass the middleware gate.
async function authHeaders(): Promise<HeadersInit> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

interface AdminOrder {
  id:               string
  buyerId:          string
  buyerName:        string
  sellerId:         string
  sellerName:       string
  itemTitle:        string
  totalAmount:      number
  sellerPayout:     number
  status:           string
  escrowStatus:     string
  paymentProvider:  string
  paymentReference: string
  orderType:        string
  createdAt:        string | null
  // Whether the listing was admin-picked for Zamorax Direct, or the seller
  // account itself is official. Marking an order shipped on the seller's
  // behalf (fulfilledBy = "zamorax") is only allowed when this is true.
  isOfficial:       boolean
  fulfilledBy:      string
  deliveryStreet:   string
  deliveryCity:     string
  deliveryState:    string
  deliveryLGA:      string
  deliveryMethod:   string
}

const STATUS_COLOR: Record<string, string> = {
  pending:       "bg-amber-100 text-amber-800",
  escrow_held:   "bg-blue-100 text-blue-800",
  shipped:       "bg-purple-100 text-purple-800",
  delivered:     "bg-teal-100 text-teal-800",
  completed:     "bg-green-100 text-green-800",
  refunded:      "bg-gray-200 text-gray-700",
  cancelled:     "bg-red-100 text-red-700",
  disputed:      "bg-red-100 text-red-700",
}

const NOT_YET_PAID = new Set(["pending", "payment_rejected"])

export function AdminOrdersPage() {
  const { toast } = useToast()
  const [orders, setOrders]   = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch("/api/admin/orders?limit=200", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrders(data.orders ?? [])
    } catch (err: any) {
      toast({ title: "Failed to load orders", description: err.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const filtered = orders.filter(o => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        o.id.toLowerCase().includes(s) ||
        o.itemTitle.toLowerCase().includes(s) ||
        o.buyerName.toLowerCase().includes(s) ||
        o.sellerName.toLowerCase().includes(s) ||
        o.paymentReference.toLowerCase().includes(s)
      )
    }
    return true
  })

  // ── Reverse Payment dialog ────────────────────────────────────────────
  const [reverseTarget, setReverseTarget] = useState<AdminOrder | null>(null)
  const [reverseReason, setReverseReason] = useState("")
  const [reversing, setReversing]         = useState(false)

  const submitReverse = async () => {
    if (!reverseTarget) return
    const reason = reverseReason.trim()
    if (!reason) {
      toast({ title: "Please provide a reason", variant: "destructive" })
      return
    }
    setReversing(true)
    try {
      const res  = await fetch("/api/orders/reverse-payment", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId: reverseTarget.id, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const bits: string[] = []
      if (data.walletReversed) bits.push("seller wallet debited")
      if (data.paystackRefund?.attempted) {
        bits.push(data.paystackRefund.ok ? "Paystack refund issued" : `Paystack refund failed: ${data.paystackRefund.error}`)
      }
      toast({
        title: "Payment reversed",
        description: bits.length ? bits.join(" · ") : "Order marked as refunded.",
        variant: "success",
      })
      setReverseTarget(null)
      setReverseReason("")
      fetchOrders()
    } catch (err: any) {
      toast({ title: "Failed to reverse payment", description: err.message, variant: "destructive" })
    } finally {
      setReversing(false)
    }
  }

  // ── Mark Shipped (Zamorax handling) ─────────────────────────────────────
  // Only available for official orders (listing was admin-picked, or the
  // seller account is official) with escrow already active. Does NOT touch
  // payout — the seller is still credited via the normal escrow-release flow
  // once delivery is confirmed; this only records that Zamorax is the one
  // physically shipping it, for both admin/moderator and seller visibility.
  const [shippingId, setShippingId] = useState<string | null>(null)

  const markShippedByZamorax = async (order: AdminOrder) => {
    setShippingId(order.id)
    try {
      const res  = await fetch(`/api/admin/orders/${order.id}/ship`, {
        method: "POST",
        headers: await authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = data.got ? ` (your role: ${data.got}, needs: ${data.required})` : ""
        throw new Error((data.error ?? "Failed") + detail)
      }
      toast({
        title: "Marked as shipped",
        description: "Zamorax is now shown as handling fulfillment. Seller payout is unaffected.",
        variant: "success",
      })
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "shipped", fulfilledBy: "zamorax" } : o))
    } catch (err: any) {
      toast({ title: "Failed to mark shipped", description: err.message, variant: "destructive" })
    } finally {
      setShippingId(null)
    }
  }

  // ── Force Delete dialog ───────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<AdminOrder | null>(null)
  const [deleteReason, setDeleteReason] = useState("")
  const [deleting, setDeleting]         = useState(false)

  const submitDelete = async () => {
    if (!deleteTarget) return
    const reason = deleteReason.trim()
    if (!reason) {
      toast({ title: "Please provide a reason", variant: "destructive" })
      return
    }
    setDeleting(true)
    try {
      const alreadyPaid = !NOT_YET_PAID.has(deleteTarget.status)
      const res  = await fetch("/api/orders/cancel-admin", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId: deleteTarget.id, reason, forceDelete: alreadyPaid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const bits: string[] = []
      if (data.walletReversed) bits.push("seller wallet debited")
      if (data.paystackRefund?.attempted) {
        bits.push(data.paystackRefund.ok ? "Paystack refund issued" : `Paystack refund failed: ${data.paystackRefund.error}`)
      }
      toast({
        title: "Order deleted",
        description: bits.length ? bits.join(" · ") : "Order removed. Buyer and seller notified.",
        variant: "success",
      })
      setDeleteTarget(null)
      setDeleteReason("")
      setOrders(prev => prev.filter(o => o.id !== deleteTarget.id))
    } catch (err: any) {
      toast({ title: "Failed to delete order", description: err.message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-heading font-bold">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Every order, any status — reverse a payment or delete an order outright.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchOrders} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by order id, item, buyer, seller, reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="escrow_held">Escrow held</SelectItem>
            <SelectItem value="shipped">Shipped</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="disputed">Disputed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No orders match.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => {
            const alreadyPaid = !NOT_YET_PAID.has(o.status)
            return (
              <Card key={o.id}>
                <CardContent className="p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{o.itemTitle}</p>
                      <p className="text-xs text-muted-foreground">
                        #{o.id.slice(0, 8).toUpperCase()} · {o.buyerName || "Buyer"} → {o.sellerName || "Seller"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {o.paymentProvider || "—"} {o.paymentReference && `· ${o.paymentReference}`}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {o.deliveryMethod === "fbz" ? "FBZ Express — " : o.deliveryMethod ? "Meetup — " : ""}
                        {[o.deliveryStreet, o.deliveryLGA, o.deliveryCity, o.deliveryState].filter(Boolean).join(", ") || "No address on file"}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <p className="font-semibold text-sm">{formatPrice(o.totalAmount)}</p>
                      <div className="flex gap-1 justify-end flex-wrap">
                        <Badge className={STATUS_COLOR[o.status] ?? "bg-gray-100 text-gray-700"}>{o.status}</Badge>
                        {o.isOfficial && (
                          <Badge variant="outline" className="border-violet-300 text-violet-700">Official</Badge>
                        )}
                        {o.fulfilledBy === "zamorax" && (
                          <Badge variant="outline" className="border-blue-300 text-blue-700">Zamorax handling</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end flex-wrap">
                    {o.isOfficial && o.status === "escrow_held" && o.fulfilledBy !== "zamorax" && (
                      <Button
                        variant="outline" size="sm" className="gap-1.5 text-violet-700 border-violet-200 hover:bg-violet-50 whitespace-normal h-auto py-1.5"
                        onClick={() => markShippedByZamorax(o)}
                        disabled={shippingId === o.id}
                      >
                        {shippingId === o.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Package className="h-3.5 w-3.5" />}
                        Mark Shipped (Zamorax)
                      </Button>
                    )}
                    {alreadyPaid && o.status !== "refunded" && (
                      <Button
                        variant="outline" size="sm" className="gap-1.5"
                        onClick={() => { setReverseTarget(o); setReverseReason("") }}
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Reverse Payment
                      </Button>
                    )}
                    <Button
                      variant="outline" size="sm"
                      className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { setDeleteTarget(o); setDeleteReason("") }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete Order
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Reverse Payment dialog */}
      <Dialog open={!!reverseTarget} onOpenChange={(open) => { if (!open) setReverseTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Undo2 className="h-4 w-4" /> Reverse Payment</DialogTitle>
            <DialogDescription>
              This refunds the buyer via Paystack where possible, debits the seller&apos;s wallet if they were
              already paid out, and marks the order as refunded. This does not delete the order.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium">{reverseTarget?.itemTitle}</p>
            <p className="text-xs text-muted-foreground">{reverseTarget && formatPrice(reverseTarget.totalAmount)}</p>
            <Textarea
              placeholder="Reason for reversing this payment..."
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseTarget(null)} disabled={reversing}>Cancel</Button>
            <Button onClick={submitReverse} disabled={reversing} className="gap-1.5">
              {reversing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Reverse Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-4 w-4" /> Delete Order
            </DialogTitle>
            <DialogDescription>
              {deleteTarget && !NOT_YET_PAID.has(deleteTarget.status)
                ? "This order already moved money — deleting it will first debit the seller's wallet and attempt a Paystack refund, then permanently remove the order. This cannot be undone."
                : "This permanently removes the order and restores stock. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium">{deleteTarget?.itemTitle}</p>
            <p className="text-xs text-muted-foreground">{deleteTarget && formatPrice(deleteTarget.totalAmount)}</p>
            <Textarea
              placeholder="Reason for deleting this order..."
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={submitDelete} disabled={deleting} className="gap-1.5">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default AdminOrdersPage
