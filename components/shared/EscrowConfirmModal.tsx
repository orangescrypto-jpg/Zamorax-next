"use client"

// components/shared/EscrowConfirmModal.tsx

import { AdminService, serverTimestamp } from "@/src/services"
import { useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button }   from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Input }    from "@/components/ui/input"
import { Label }    from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, ShieldCheck, Package, MapPin } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { DeliveryMethodSelector, type DeliveryMethodMeta } from "@/components/logistics/DeliveryMethodSelector"
import { type DeliveryMethod } from "@/src/types"
import { nigerianStates } from "@/constants/nigerianStates"
import { Separator } from "@/components/ui/separator"

interface Props {
  orderId:    string
  open:       boolean
  onOpenChange: (v: boolean) => void
  onConfirm?: () => void
  sellerState?:     string
  weightKg?:        number
  isFragile?:       boolean
  shippingMethods?: DeliveryMethod[]
  // Whether this listing's stock is actually verified/held at a Zamorax
  // warehouse (listing.isFBZ, set only by admin FBZ intake — see
  // app/(admin)/admin/fbz/page.tsx handleActivate). This is the real
  // source of truth for whether "FBZ Express" should be offered; it must
  // NOT be derived from shippingMethods, which just reflects delivery
  // methods the seller opted into and says nothing about where the stock
  // physically sits.
  isFBZ?: boolean
}

export function EscrowConfirmModal({
  orderId, open, onOpenChange, onConfirm,
  sellerState = "", weightKg = 0.5, isFragile = false,
  shippingMethods, isFBZ = false,
}: Props) {
  const { toast } = useToast()

  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("meetup")
  const [deliveryMeta,   setDeliveryMeta]   = useState<DeliveryMethodMeta>({ deliveryFee: 0 })

  const [street,  setStreet]  = useState("")
  const [city,    setCity]    = useState("")
  const [state,   setState]   = useState("")
  const [lga,     setLga]     = useState("")

  const [note,     setNote]     = useState("")
  const [accepted, setAccepted] = useState(false)
  const [loading,  setLoading]  = useState(false)

  // isFBZ now comes directly from the prop (the listing's real FBZ
  // status) — no longer derived from shippingMethods.

  const handleDeliveryChange = (method: DeliveryMethod, meta: DeliveryMethodMeta) => {
    setDeliveryMethod(method)
    setDeliveryMeta(meta)
  }

  const addressValid = deliveryMethod !== "zamorax_logistics"
    || (street.trim().length > 3 && city.trim().length > 1 && state.length > 0 && lga.trim().length > 1)

  const handleConfirm = async () => {
    if (!accepted) {
      toast({ title: "Please tick the confirmation checkbox", variant: "destructive" })
      return
    }
    if (!addressValid) {
      toast({ title: "Please fill in your full delivery address", variant: "destructive" })
      return
    }

    setLoading(true)
    try {
      const orderSnap = await AdminService.getDoc("orders", orderId)
      const order = orderSnap!

      const updatePayload: Record<string, any> = {
        deliveryMethod,
        deliveryFee:   deliveryMeta.deliveryFee,
        buyerState:    state || (order as any).buyerState || "",
        updatedAt:     serverTimestamp(),
      }

      if (deliveryMethod === "zamorax_logistics") {
        updatePayload.deliveryStreet   = street
        updatePayload.deliveryCity     = city
        updatePayload.deliveryState    = state
        updatePayload.deliveryLGA      = lga
        updatePayload.zlaDeliveryType  = deliveryMeta.deliveryType ?? "agent_pickup"
        updatePayload.itemWeightKg     = weightKg
        updatePayload.itemFragile      = isFragile
        updatePayload.zlaBookingStatus = "pending_payment"
      }

      if (note) updatePayload.buyerFeedback = note

      await AdminService.updateDoc("orders", orderId, updatePayload)

      toast({
        title: "Order confirmed! 🎉",
        description: deliveryMethod === "zamorax_logistics"
          ? "Delivery details saved. Pay to activate escrow."
          : "Payment is safely in escrow.",
        variant: "success",
      })

      onOpenChange(false)
      onConfirm?.()
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="text-primary" /> Confirm Order &amp; Delivery
          </DialogTitle>
          <DialogDescription>
            Your payment goes into escrow. Choose how you want to receive the item.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">

          <DeliveryMethodSelector
            sellerState={sellerState}
            buyerState={state}
            weightKg={weightKg}
            isFragile={isFragile}
            isFBZ={isFBZ}
            value={deliveryMethod}
            onChange={handleDeliveryChange}
          />

          {deliveryMethod === "zamorax_logistics" && (
            <div className="space-y-3 p-4 border rounded-xl bg-muted/10">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Your Delivery Address</p>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                This is where your parcel will be delivered or where you'll pick it up from a nearby agent.
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs">State *</Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger><SelectValue placeholder="Select your state" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {nigerianStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">LGA *</Label>
                <Input
                  placeholder="e.g. Ikeja, Surulere, Nnewi North"
                  value={lga}
                  onChange={e => setLga(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">City / Area *</Label>
                <Input
                  placeholder="e.g. Ikeja, Lekki, Wuse 2"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Street Address *</Label>
                <Input
                  placeholder="e.g. 12 Allen Avenue, beside GTBank"
                  value={street}
                  onChange={e => setStreet(e.target.value)}
                />
              </div>

              {state && sellerState && (
                <div className="flex items-start gap-1.5 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
                  <Package className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <p>Delivery fee calculated for <strong>{sellerState} → {state}</strong>. Fee updates automatically as you change state.</p>
                </div>
              )}
            </div>
          )}

          <Separator />

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Note to seller (optional)</Label>
            <Textarea
              placeholder="Any special instructions..."
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
            <Checkbox
              checked={accepted}
              onCheckedChange={v => setAccepted(v as boolean)}
              id="confirm-check"
            />
            <label htmlFor="confirm-check" className="text-sm leading-tight cursor-pointer">
              I understand my payment will be held in escrow and only released to the seller after I confirm receipt.
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={!accepted || !addressValid || loading}
            className="bg-primary text-white hover:bg-primary/90"
          >
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : <ShieldCheck className="h-4 w-4 mr-2" />
            }
            Confirm &amp; Lock Escrow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
