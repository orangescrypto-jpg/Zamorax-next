"use client"

// components/cart/CartDrawer.tsx
// Slide-in cart from right side. Gated by settings.multiCartEnabled.

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { X, ShoppingCart, Minus, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePlatformSettings } from "@/hooks/usePlatformSettings"
import { useCartItemsStore } from "@/store/cartStore"
import { formatPrice } from "@/lib/utils"
import { CartCheckoutModal } from "@/components/cart/CartCheckoutModal"
import type { CartItem } from "@/src/types"

interface Props {
  open: boolean
  onClose: () => void
}

export function CartDrawer({ open, onClose }: Props) {
  const { settings } = usePlatformSettings()
  const { cartItems, removeFromCart, updateQty, getCartTotal, getCartGrouped } = useCartItemsStore()
  const [checkoutOpen, setCheckoutOpen] = useState(false)

  if (!settings.multiCartEnabled) return null

  const grouped   = getCartGrouped()
  const total     = getCartTotal()
  const sellerIds = Object.keys(grouped)

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-sm z-[160] bg-background shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-foreground">
              Cart {cartItems.length > 0 && <span className="text-muted-foreground font-normal text-sm">({cartItems.length} item{cartItems.length !== 1 ? "s" : ""})</span>}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4 px-4">
          {cartItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                <ShoppingCart className="h-9 w-9 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Your cart is empty</p>
                <p className="text-sm text-muted-foreground mt-1">Add items from listings to checkout together</p>
              </div>
              <Button asChild variant="outline" onClick={onClose}>
                <Link href="/search">Browse Listings</Link>
              </Button>
            </div>
          ) : (
            sellerIds.map((sellerId) => {
              const sellerItems = grouped[sellerId]
              const sellerName  = sellerItems[0].sellerName

              return (
                <div key={sellerId} className="space-y-2">
                  {/* Seller header */}
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-primary inline-block" />
                    {sellerName}
                  </p>

                  {sellerItems.map((item: CartItem) => {
                    const displayPrice = item.agreedPrice ?? item.priceSale
                    const lineTotal    = displayPrice * item.quantity
                    const maxQty       = settings.maxQtyPerItem ?? 10

                    return (
                      <div key={item.listingId} className="flex gap-3 p-2.5 rounded-xl border border-border bg-card">
                        {/* Image */}
                        <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-muted shrink-0">
                          {item.listingImage ? (
                            <Image src={item.listingImage} alt={item.listingTitle} fill className="object-cover" sizes="56px" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">{item.listingTitle}</p>

                          {(item.selectedColor || item.selectedSize) && (
                            <p className="text-[11px] text-muted-foreground">
                              {[item.selectedColor, item.selectedSize].filter(Boolean).join(" · ")}
                            </p>
                          )}

                          {item.agreedPrice != null && (
                            <span className="inline-block bg-green-100 text-green-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                              Negotiated ✓
                            </span>
                          )}

                          <div className="flex items-center justify-between">
                            {/* Qty control */}
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => updateQty(item.listingId, item.quantity - 1)}
                                className="w-6 h-6 rounded-md border border-border flex items-center justify-center hover:bg-muted transition text-foreground"
                              >
                                <Minus className="h-2.5 w-2.5" />
                              </button>
                              <span className="text-xs font-semibold w-5 text-center">{item.quantity}</span>
                              <button
                                onClick={() => updateQty(item.listingId, item.quantity + 1)}
                                disabled={item.quantity >= maxQty}
                                className="w-6 h-6 rounded-md border border-border flex items-center justify-center hover:bg-muted transition text-foreground disabled:opacity-40"
                              >
                                <Plus className="h-2.5 w-2.5" />
                              </button>
                            </div>

                            <p className="text-xs font-bold text-primary">{formatPrice(lineTotal)}</p>
                          </div>
                        </div>

                        {/* Remove */}
                        <button
                          onClick={() => removeFromCart(item.listingId)}
                          className="self-start mt-0.5 text-muted-foreground hover:text-destructive transition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        {cartItems.length > 0 && (
          <div className="border-t border-border px-4 py-4 space-y-3 shrink-0 bg-background">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Subtotal ({cartItems.length} item{cartItems.length !== 1 ? "s" : ""})</p>
              <p className="font-bold text-foreground">{formatPrice(total)}</p>
            </div>
            <p className="text-[10px] text-muted-foreground">Delivery fees calculated at checkout</p>
            <Button
              className="w-full h-11 bg-primary text-primary-foreground"
              onClick={() => { setCheckoutOpen(true) }}
            >
              Proceed to Checkout
            </Button>
          </div>
        )}
      </div>

      {checkoutOpen && (
        <CartCheckoutModal
          open={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          onSuccess={() => { setCheckoutOpen(false); onClose() }}
        />
      )}
    </>
  )
}
