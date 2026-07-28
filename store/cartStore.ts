// store/cartStore.ts
// Zustand store for saved/wishlist state, offer selection state, AND multi-item cart.
// ─────────────────────────────────────────────────────────────────────────────
// WISHLIST (savedItems) — persisted under "zamorax-cart" (unchanged key)
// CART (cartItems)      — persisted under "zamorax-cart-v2" (new key)
// Both live in separate persist slices so they never interfere.

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { Listing, CartItem, DeliveryMethod } from "@/src/types"
import { resolveBulkPrice } from "@/lib/utils"

// Re-resolves a cart item's unit price for a given quantity using its
// carried-through bulk tiers, falling back to its existing priceSale
// unchanged when the item has no bulk pricing (plain-price / offer-priced
// items behave exactly as before).
function resolvedUnitPrice(item: CartItem, quantity: number): number {
  if (!item.bulkPricing || item.bulkPricing.length === 0 || item.basePriceSale == null) {
    return item.priceSale
  }
  const resolved = resolveBulkPrice(item.bulkPricing, item.basePriceSale, quantity)
  if (!resolved) return item.basePriceSale // below first tier — base 1-piece rate
  return Math.round(resolved.total / Math.max(1, quantity))
}

// ─── Saved items (wishlist) ───────────────────────────────────────────────
interface SavedItem {
  listingId: string
  savedAt:   string // ISO
  listing?:  Pick<Listing, "id" | "title" | "images" | "priceSale" | "nigerianState" | "sellerId">
}

interface OfferDraft {
  listingId:  string
  offeredPrice: number
  message?:   string
}

interface WishlistState {
  savedItems:  SavedItem[]
  savedIds:    Set<string>
  offerDraft: OfferDraft | null
  addSaved(item: SavedItem):    void
  removeSaved(listingId: string): void
  isSaved(listingId: string):   boolean
  hydrateSaved(items: SavedItem[]): void
  clearSaved(): void
  setOfferDraft(draft: OfferDraft | null): void
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      savedItems: [],
      savedIds:   new Set<string>(),
      offerDraft: null,

      addSaved: (item) =>
        set((s) => ({
          savedItems: [item, ...s.savedItems.filter((x) => x.listingId !== item.listingId)],
          savedIds:   new Set([...s.savedIds, item.listingId]),
        })),

      removeSaved: (listingId) =>
        set((s) => {
          const next = new Set(s.savedIds)
          next.delete(listingId)
          return {
            savedItems: s.savedItems.filter((x) => x.listingId !== listingId),
            savedIds:   next,
          }
        }),

      isSaved: (listingId) => get().savedIds.has(listingId),

      hydrateSaved: (items) =>
        set({
          savedItems: items,
          savedIds:   new Set(items.map((i) => i.listingId)),
        }),

      clearSaved: () => set({ savedItems: [], savedIds: new Set() }),

      setOfferDraft: (draft) => set({ offerDraft: draft }),
    }),
    {
      name: "zamorax-cart",
      partialize: (state) => ({ savedItems: state.savedItems, offerDraft: state.offerDraft }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.savedIds = new Set(state.savedItems.map((i) => i.listingId))
        }
      },
    }
  )
)

// ─── Backwards-compat: keep useCartStore pointing to wishlist store ────────
// Components that import useCartStore for wishlist functionality continue to work.
// New cart functionality is accessed via useCartItemsStore below.
export const useCartStore = useWishlistStore

// ─── Multi-item cart ──────────────────────────────────────────────────────
interface CartItemsState {
  cartItems: CartItem[]

  // Mutations
  addToCart(item: CartItem, maxQtyPerItem?: number, minQtyPerItem?: number): void
  removeFromCart(listingId: string): void
  updateQty(listingId: string, qty: number, minQtyPerItem?: number): void
  clearCart(): void

  // Reads
  getCartItems(): CartItem[]
  getCartGrouped(): Record<string, CartItem[]>   // keyed by sellerId
  getCartTotal(): number                          // kobo — sum without delivery
  getItemCount(): number                          // total distinct items

  // Offer hydration — call after fetching accepted offers for cart listings
  hydrateAcceptedOffers(offers: Record<string, number>): void  // listingId → agreedPrice kobo
}

export const useCartItemsStore = create<CartItemsState>()(
  persist(
    (set, get) => ({
      cartItems: [],

      addToCart: (item, maxQtyPerItem = 10, minQtyPerItem = 1) => {
        set((s) => {
          const existing = s.cartItems.find((c) => c.listingId === item.listingId)
          if (existing) {
            return {
              cartItems: s.cartItems.map((c) => {
                if (c.listingId !== item.listingId) return c

                // An offer price is for exactly 1 unit — always overwrite
                // quantity to 1 in that case rather than adding to whatever
                // was already in the cart. Otherwise (regular re-add),
                // accumulate as before, clamped between the listing's min
                // and max order qty. Also clamp against the listing's real
                // stock (if tracked) — accumulating two adds of a
                // single-unit item must never push quantity above 1.
                const stockCeiling = (item.stockQty ?? c.stockQty) ?? undefined
                const effectiveMax = stockCeiling != null ? Math.min(maxQtyPerItem, stockCeiling) : maxQtyPerItem
                const nextQty = item.agreedPrice != null
                  ? 1
                  : Math.min(Math.max(c.quantity + item.quantity, minQtyPerItem), effectiveMax)

                // Refresh bulk-pricing fields from the latest add (seller
                // may have changed tiers) and re-resolve the unit price at
                // the new accumulated quantity — otherwise a second add
                // that crosses into a new tier would keep the first add's
                // stale rate.
                const merged: CartItem = {
                  ...c,
                  quantity: nextQty,
                  agreedPrice: item.agreedPrice ?? c.agreedPrice,
                  offerId: item.offerId ?? c.offerId,
                  bulkPricing: item.bulkPricing ?? c.bulkPricing,
                  basePriceSale: item.basePriceSale ?? c.basePriceSale,
                  minOrderQty: item.minOrderQty ?? c.minOrderQty,
                  stockQty: stockCeiling,
                }
                return merged.agreedPrice != null
                  ? merged
                  : { ...merged, priceSale: resolvedUnitPrice(merged, nextQty) }
              }),
            }
          }
          const initialMax = item.stockQty != null ? Math.min(maxQtyPerItem, item.stockQty) : maxQtyPerItem
          const initialQty = item.agreedPrice != null
            ? 1
            : Math.min(Math.max(item.quantity, minQtyPerItem), initialMax)
          return {
            cartItems: [
              ...s.cartItems,
              {
                ...item,
                quantity: initialQty,
                // item.priceSale already carries the caller's resolved rate
                // for its original quantity — only re-resolve if clamping
                // above actually changed the quantity.
                priceSale: item.agreedPrice != null || initialQty === item.quantity
                  ? item.priceSale
                  : resolvedUnitPrice(item, initialQty),
              },
            ],
          }
        })
      },

      removeFromCart: (listingId) =>
        set((s) => ({ cartItems: s.cartItems.filter((c) => c.listingId !== listingId) })),

      updateQty: (listingId, qty, minQtyPerItem = 1) =>
        set((s) => ({
          cartItems:
            qty <= 0
              ? s.cartItems.filter((c) => c.listingId !== listingId)
              : s.cartItems.map((c) => {
                  if (c.listingId !== listingId) return c
                  // The listing's own minOrderQty (carried on the item) is
                  // the true floor — callers may also pass one explicitly,
                  // so respect whichever is stricter.
                  const floor = Math.max(minQtyPerItem, c.minOrderQty ?? 1)
                  // The listing's own stock (if tracked) is a hard ceiling
                  // enforced here in the store, not just via a disabled
                  // button in the drawer UI — a single-unit item
                  // (stockQty = 1) must never end up with quantity > 1 in
                  // the cart no matter how updateQty gets called.
                  const ceiling = c.stockQty != null ? Math.max(floor, c.stockQty) : Infinity
                  const nextQty = Math.min(Math.max(qty, floor), ceiling)
                  // Offer-priced items have a fixed negotiated total for a
                  // fixed quantity — never re-resolve or let qty drift.
                  if (c.agreedPrice != null) return { ...c, quantity: nextQty }
                  return { ...c, quantity: nextQty, priceSale: resolvedUnitPrice(c, nextQty) }
                }),
        })),

      clearCart: () => set({ cartItems: [] }),

      getCartItems: () => get().cartItems,

      getCartGrouped: () => {
        const grouped: Record<string, CartItem[]> = {}
        for (const item of get().cartItems) {
          if (!grouped[item.sellerId]) grouped[item.sellerId] = []
          grouped[item.sellerId].push(item)
        }
        return grouped
      },

      getCartTotal: () =>
        get().cartItems.reduce((sum, item) => {
          if (item.agreedPrice != null) return sum + item.agreedPrice * item.quantity
          if (item.bulkPricing && item.bulkPricing.length > 0 && item.basePriceSale != null) {
            const resolved = resolveBulkPrice(item.bulkPricing, item.basePriceSale, item.quantity)
            // Exact-tier totals are flat bundle prices, not unit×qty — use
            // resolved.total directly so we never drift from rounding the
            // per-piece rate back out and re-multiplying.
            if (resolved) return sum + resolved.total
            return sum + item.basePriceSale * item.quantity
          }
          return sum + item.priceSale * item.quantity
        }, 0),

      getItemCount: () => get().cartItems.length,

      hydrateAcceptedOffers: (offers) =>
        set((s) => ({
          cartItems: s.cartItems.map((item) =>
            offers[item.listingId] != null
              ? { ...item, agreedPrice: offers[item.listingId] }
              : item
          ),
        })),
    }),
    {
      name: "zamorax-cart-v2",
      storage: createJSONStorage(() => localStorage),
    }
  )
)
