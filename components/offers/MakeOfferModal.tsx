"use client"

import { OffersService } from "@/src/services"

import { useState } from "react"
import Image from "next/image"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/components/ui/use-toast"
import { formatPrice } from "@/lib/utils"
import { Tag, Loader2 } from "lucide-react"

interface Props {
  open: boolean
  onClose: () => void
  listing: {
    id: string
    title: string
    images: string[]
    priceSale: number
    sellerId: string
    sellerName: string
  }
}

export function MakeOfferModal({ open, onClose, listing }: Props) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [amount, setAmount] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  const originalPrice = listing.priceSale // kobo
  const offerKobo = Math.round(parseFloat(amount || "0") * 100)
  const discount = originalPrice > 0 ? Math.round((1 - offerKobo / originalPrice) * 100) : 0

  const handleSubmit = async () => {
    if (!user || offerKobo <= 0) return
    if (offerKobo > originalPrice) {
      toast({ title: "Offer too high", description: "Your offer can't exceed the asking price.", variant: "destructive" })
      return
    }
    if (offerKobo < originalPrice * 0.3) {
      toast({ title: "Offer too low", description: "Offer must be at least 30% of asking price.", variant: "destructive" })
      return
    }
    setLoading(true)
    try {
      await OffersService.makeOffer({
        listingId: listing.id,
        listingTitle: listing.title,
        listingImage: listing.images[0] || "",
        originalPrice,
        offerAmount: offerKobo,
        buyerId: user.uid,
        buyerName: user.fullName || "Buyer",
        sellerId: listing.sellerId,
        sellerName: listing.sellerName || "Seller",
        message: message.trim() || undefined,
      })
      toast({ title: "Offer Sent! 🎉", description: "The seller will respond within 24 hours.", variant: "success" })
      onClose()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" /> Make an Offer
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Listing preview */}
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
            {listing.images[0] && (
              <Image src={listing.images[0]} alt="" width={48} height={48} className="h-12 w-12 rounded object-cover" />
            )}
            <div>
              <p className="text-sm font-medium line-clamp-1">{listing.title}</p>
              <p className="text-xs text-muted-foreground">Asking: <span className="font-semibold text-secondary">{formatPrice(originalPrice)}</span></p>
            </div>
          </div>

          {/* Offer amount */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Your Offer (₦)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">₦</span>
              <Input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="pl-7"
              />
            </div>
            {offerKobo > 0 && discount > 0 && (
              <p className="text-xs text-primary font-medium">
                {discount}% below asking price
              </p>
            )}
          </div>

          {/* Quick offer buttons */}
          <div className="grid grid-cols-3 gap-2">
            {[0.9, 0.8, 0.7].map(pct => (
              <button
                key={pct}
                onClick={() => setAmount(((originalPrice * pct) / 100).toFixed(0))}
                className="text-xs p-2 border rounded-lg hover:border-primary hover:bg-primary/5 transition text-center"
              >
                <span className="font-semibold">{Math.round((1 - pct) * 100)}% off</span>
                <br />
                <span className="text-muted-foreground">{formatPrice(originalPrice * pct)}</span>
              </button>
            ))}
          </div>

          {/* Optional message */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Message (optional)</label>
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="e.g. I can pay immediately, pickup today"
              className="resize-none h-16 text-sm"
            />
          </div>

          <p className="text-xs text-muted-foreground">Offer expires in 24 hours. Seller can accept, decline, or counter.</p>

          <Button className="w-full bg-primary text-white" onClick={handleSubmit} disabled={loading || offerKobo <= 0}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Send Offer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
