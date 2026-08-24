"use client"
import type { Listing } from "@/src/types"
import { useEffect, useState } from "react"
import { Zap, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ListingsService } from "@/src/services"
import { formatPrice } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"

// Buyer-facing countdown badge shown on listing card/detail
export function FlashDealBadge({ listing }: { listing: Listing }) {
  const [timeLeft, setTimeLeft] = useState("")
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!ListingsService.isFlashDealActive(listing) || !listing.flashDeal) return
    setActive(true)
    const exp = typeof listing.flashDeal.expiresAt === "string"
      ? new Date(listing.flashDeal.expiresAt)
      : listing.flashDeal.expiresAt.toDate()
    const tick = () => {
      const diff = exp.getTime() - Date.now()
      if (diff <= 0) { setActive(false); clearInterval(t); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setTimeLeft(`${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [listing])

  if (!active || !listing.flashDeal) return null
  const flashPrice = ListingsService.getFlashPrice(listing.priceSale, listing.flashDeal.discountPercent)

  return (
    <div className="bg-red-600 text-white rounded-xl p-3 space-y-1">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 fill-white" />
        <span className="font-bold text-sm">FLASH DEAL — {listing.flashDeal.discountPercent}% OFF</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <span className="line-through text-red-200 text-sm mr-2">{formatPrice(listing.priceSale)}</span>
          <span className="text-xl font-bold">{formatPrice(flashPrice)}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-red-200">Ends in</p>
          <p className="font-mono font-bold text-sm">{timeLeft}</p>
        </div>
      </div>
    </div>
  )
}

// Seller: Create/cancel flash deal modal
export function CreateFlashDealModal({ listing, open, onClose }: { listing: Listing; open: boolean; onClose: () => void }) {
  const [discount, setDiscount] = useState("10")
  const [hours, setHours] = useState("24")
  const [applyToBulk, setApplyToBulk] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const alreadyActive = ListingsService.isFlashDealActive(listing)
  const hasBulkPricing = Array.isArray(listing.bulkPricing) && listing.bulkPricing.length > 0
  // Guard against a missing/undefined price so the modal shows ₦0 instead of
  // NaN if listing data is ever incomplete, rather than silently breaking.
  const price = listing.priceSale || 0
  const flashPrice = ListingsService.getFlashPrice(price, Number(discount))

  const handleCreate = async () => {
    setLoading(true)
    try {
      await ListingsService.createFlashDeal(listing.id, Number(discount), Number(hours), applyToBulk)
      toast({ title: "Flash Deal Live! ⚡", description: `${discount}% off for ${hours} hours.`, variant: "success" })
      onClose()
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }) }
    finally { setLoading(false) }
  }

  const handleCancel = async () => {
    setLoading(true)
    try {
      await ListingsService.cancelFlashDeal(listing.id)
      toast({ title: "Flash Deal Cancelled" })
      onClose()
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }) }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-red-500" /> Flash Deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 bg-muted/30 rounded-lg text-sm">
            <p className="font-medium truncate">{listing.title}</p>
            <p className="text-muted-foreground">Original: {formatPrice(price)}</p>
          </div>
          {alreadyActive && listing.flashDeal ? (
            <div className="space-y-3">
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                ⚡ Flash deal active — {listing.flashDeal.discountPercent}% off
                {hasBulkPricing && (
                  <span className="block text-xs mt-1 text-red-600/80">
                    {listing.flashDeal.applyToBulk ? "Also applied to bulk pricing tiers." : "Not applied to bulk pricing tiers."}
                  </span>
                )}
              </div>
              <Button variant="destructive" className="w-full" onClick={handleCancel} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><X className="h-4 w-4 mr-2" />Cancel Flash Deal</>}
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Discount</label>
                <Select value={discount} onValueChange={setDiscount}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[5,10,15,20,25,30,40,50,60,70].map((d: any) => (
                      <SelectItem key={d} value={String(d)}>{d}% off → {formatPrice(ListingsService.getFlashPrice(price, d))}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Duration</label>
                <Select value={hours} onValueChange={setHours}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1,3,6,12,24,48].map(h => <SelectItem key={h} value={String(h)}>{h} hour{h>1?"s":""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Only shown when this listing actually has bulk pricing
                  tiers set — otherwise there's nothing for the toggle to
                  affect. Off by default: a bulk tier is often already a
                  negotiated bundle price the seller may not want stacked
                  with this flash discount. */}
              {hasBulkPricing && (
                <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                  <div className="pr-3">
                    <p className="text-sm font-medium">Apply to bulk pricing too</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Also discount your bulk-price tiers by {discount}%, not just the single-piece price.
                    </p>
                  </div>
                  <Switch checked={applyToBulk} onCheckedChange={setApplyToBulk} />
                </div>
              )}

              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-center">
                <p className="text-xs text-red-600">Flash Price</p>
                <p className="text-2xl font-bold text-red-600">{formatPrice(flashPrice)}</p>
                <p className="text-xs text-muted-foreground">Save {formatPrice(price - flashPrice)}</p>
              </div>
              <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={handleCreate} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Zap className="h-4 w-4 mr-2" />Start Flash Deal</>}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
