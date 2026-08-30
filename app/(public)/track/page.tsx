"use client"

import { AdminService, where } from "@/src/services"
// app/(public)/track/page.tsx
// NEW: Public tracking page — no login required

import { useState } from "react"
import { type ZamoraxShipment, SHIPMENT_STATUS_CONFIG } from "@/src/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Package, Search, Loader2, MapPin, Clock,
  CheckCircle, Truck, Phone,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

const STATUS_ICONS: Record<string, React.ReactNode> = {
  awaiting_dropoff:     <Clock className="h-4 w-4" />,
  dropped_off:          <Package className="h-4 w-4" />,
  in_transit:           <Truck className="h-4 w-4" />,
  at_destination_agent: <MapPin className="h-4 w-4" />,
  out_for_delivery:     <Truck className="h-4 w-4" />,
  delivered:            <CheckCircle className="h-4 w-4" />,
  failed_delivery:      <Package className="h-4 w-4" />,
  returned:             <Package className="h-4 w-4" />,
}

const ORDERED_STATUSES = [
  "awaiting_dropoff",
  "dropped_off",
  "in_transit",
  "at_destination_agent",
  "out_for_delivery",
  "delivered",
]

export default function PublicTrackingPage() {
  const [code, setCode]         = useState("")
  const [loading, setLoading]   = useState(false)
  const [shipment, setShipment] = useState<ZamoraxShipment | null>(null)
  const [notFound, setNotFound] = useState(false)

  const handleTrack = async () => {
    if (!code.trim()) return
    setLoading(true)
    setNotFound(false)
    setShipment(null)
    try {
      const snap = await AdminService.getCollection("shipments", [
        where("trackingCode", "==", code.trim().toUpperCase())
      ])
      if (snap.length === 0) { setNotFound(true) }
      else { setShipment({ ...snap[0] } as ZamoraxShipment) }
    } catch { setNotFound(true) }
    finally { setLoading(false) }
  }

  const currentIdx = shipment ? ORDERED_STATUSES.indexOf(shipment.status) : -1
  const cfg        = shipment ? SHIPMENT_STATUS_CONFIG[shipment.status] : null

  const getDeliveredDate = (deliveredAt: any): Date => {
    if (!deliveredAt) return new Date()
    if (typeof deliveredAt === "string") return new Date(deliveredAt)
    if (typeof deliveredAt === "object" && typeof deliveredAt.toDate === "function") return deliveredAt.toDate()
    return new Date()
  }

  return (
    <div className="min-h-[80vh] bg-gradient-to-b from-primary/5 to-background">
      <div className="container max-w-xl py-12 space-y-8">

        {/* Hero */}
        <div className="text-center space-y-3">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white mx-auto shadow-lg">
            <Package className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-heading font-bold">Track Your Parcel</h1>
          <p className="text-muted-foreground">Enter your Zamorax tracking code to see where your item is.</p>
        </div>

        {/* Search bar */}
        <div className="flex gap-2">
          <Input
            placeholder="e.g. ZML-ABC12345"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && handleTrack()}
            className="font-mono text-base h-12"
          />
          <Button
            className="bg-primary text-white hover:bg-primary/90 h-12 px-6 shrink-0"
            onClick={handleTrack}
            disabled={loading || !code.trim()}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {/* Not found */}
        {notFound && (
          <Card className="border-red-200">
            <CardContent className="p-6 text-center space-y-2">
              <Package className="h-10 w-10 mx-auto text-muted-foreground/30" />
              <p className="font-semibold">Tracking code not found</p>
              <p className="text-sm text-muted-foreground">
                Double-check the code and try again. Codes look like: <span className="font-mono">ZML-ABC12345</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Need help? Contact us at{" "}
                <a href="mailto:support@zamorax.com" className="text-primary underline">support@zamorax.com</a>
              </p>
            </CardContent>
          </Card>
        )}

        {/* Result */}
        {shipment && cfg && (
          <div className="space-y-4">
            {/* Status card */}
            <Card className="border-2 border-primary/20 overflow-hidden">
              <div className="bg-primary/5 px-5 py-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-lg truncate">{shipment.listingTitle}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{shipment.trackingCode}</p>
                </div>
                <Badge className={`${cfg.color} shrink-0`}>{cfg.label}</Badge>
              </div>

              <CardContent className="p-5 space-y-4">
                <p className="text-sm text-muted-foreground">{cfg.description}</p>

                {/* Estimated delivery */}
                {!["delivered", "returned", "failed_delivery"].includes(shipment.status) && (
                  <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2.5">
                    <Clock className="h-4 w-4 text-primary shrink-0" />
                    <p className="text-sm">
                      Estimated delivery in{" "}
                      <strong>{shipment.estimatedDeliveryDays} business day{shipment.estimatedDeliveryDays > 1 ? "s" : ""}</strong>
                    </p>
                  </div>
                )}

                {/* At agent pickup */}
                {shipment.status === "at_destination_agent" && (
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
                    <p className="text-sm font-semibold text-primary">📦 Ready for pickup!</p>
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">{shipment.destinationAgentName}</p>
                        <p className="text-xs text-muted-foreground">Bring your tracking code or phone number</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Delivered */}
                {shipment.status === "delivered" && shipment.deliveredAt && (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                    <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                    <p className="text-sm text-emerald-700">
                      Delivered{" "}
                      {formatDistanceToNow(getDeliveredDate(shipment.deliveredAt), { addSuffix: true })}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Progress timeline */}
            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="text-sm font-semibold">Shipment Timeline</p>
                {ORDERED_STATUSES.map((status, i) => {
                  const sCfg   = SHIPMENT_STATUS_CONFIG[status as keyof typeof SHIPMENT_STATUS_CONFIG]
                  const done   = i < currentIdx
                  const active = i === currentIdx
                  const icon   = STATUS_ICONS[status]

                  const event = shipment.timeline
                    ? [...(shipment.timeline as any[])].reverse().find((e: any) => e.status === status)
                    : null

                  return (
                    <div key={status} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`
                          w-8 h-8 rounded-full flex items-center justify-center border-2 shrink-0 transition-all
                          ${done   ? "bg-primary border-primary text-white"
                          : active ? "border-primary text-primary bg-primary/10"
                          :          "border-border text-muted-foreground bg-background"}
                        `}>
                          {done ? <CheckCircle className="h-4 w-4" /> : icon}
                        </div>
                        {i < ORDERED_STATUSES.length - 1 && (
                          <div className={`w-0.5 h-5 mt-0.5 ${done ? "bg-primary" : "bg-border"}`} />
                        )}
                      </div>
                      <div className="flex-1 pb-1 min-w-0">
                        <p className={`text-sm font-medium ${active ? "text-primary" : done ? "text-foreground" : "text-muted-foreground"}`}>
                          {sCfg.label}
                        </p>
                        {active && (
                          <p className="text-xs text-muted-foreground mt-0.5">{sCfg.description}</p>
                        )}
                        {event && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {event.agentName ? `${event.agentName} · ` : ""}
                            {event.timestamp
                              ? formatDistanceToNow(
                                  typeof event.timestamp === "string" ? new Date(event.timestamp) : event.timestamp?.toDate?.() || new Date(),
                                  { addSuffix: true }
                                )
                              : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {/* Route summary */}
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Route</p>
                <div className="flex items-center gap-2 text-sm">
                  <div className="text-center">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                      <Package className="h-4 w-4 text-primary" />
                    </div>
                    <p className="text-xs mt-1 text-muted-foreground">{shipment.originAgentName || "Origin"}</p>
                  </div>
                  <div className="flex-1 flex items-center gap-1">
                    <div className="flex-1 h-0.5 bg-border" />
                    <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                    <div className="flex-1 h-0.5 bg-border" />
                  </div>
                  <div className="text-center">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                      <MapPin className="h-4 w-4 text-emerald-600" />
                    </div>
                    <p className="text-xs mt-1 text-muted-foreground">{shipment.destinationAgentName || "Destination"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Support */}
            <p className="text-center text-xs text-muted-foreground">
              Need help with your shipment?{" "}
              <a href="mailto:logistics@zamorax.com" className="text-primary underline">logistics@zamorax.com</a>
              {" "}or{" "}
              <a href="tel:+2348000000000" className="text-primary underline flex-inline items-center gap-0.5">
                <Phone className="h-3 w-3 inline" /> 0800-ZAMORAX
              </a>
            </p>
          </div>
        )}

        {/* How it works */}
        {!shipment && !notFound && !loading && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-center text-muted-foreground">How Zamorax Logistics Works</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: <Package className="h-5 w-5 text-primary" />, step: "1", label: "Seller drops off", sub: "At nearest Zamorax agent" },
                { icon: <Truck className="h-5 w-5 text-primary" />,   step: "2", label: "Agent delivers",  sub: "Agent-to-agent network" },
                { icon: <CheckCircle className="h-5 w-5 text-primary" />, step: "3", label: "You receive", sub: "Pickup or doorstep" },
              ].map(s => (
                <Card key={s.step}><CardContent className="p-3 text-center space-y-2">
                  <div className="flex items-center justify-center">{s.icon}</div>
                  <p className="text-xs font-semibold">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground">{s.sub}</p>
                </CardContent></Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
