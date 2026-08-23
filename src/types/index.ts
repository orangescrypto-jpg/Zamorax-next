// src/types/index.ts
// ─────────────────────────────────────────────────────────────────
// ALL shared types for Zamorax — zero Firebase/Firestore imports.
// Timestamps are plain ISO strings so every backend can satisfy them.
// ─────────────────────────────────────────────────────────────────

export type { OrderStatus, EscrowStatus, DisputeStatus, TxType, PayoutStatus } from "@/constants/status"
import type { BulkTier } from "@/lib/utils"
export type { BulkTier }

// ─── User ────────────────────────────────────────────────────────
export interface User {
  uid: string
  email: string | null
  phone: string | null
  fullName: string
  username: string
  role: "buyer" | "seller" | "both" | "admin" | "moderator"
  plan: "free" | "starter" | "pro"
  planExpiresAt: string | null          // ISO string
  verificationLevel: "none" | "phone" | "nin" | "nin_bvn"
  verificationStatus?: "pending_review" | "approved" | "rejected" | null
  proVerificationStatus?: "pending_review" | "approved" | "rejected" | null
  ninVerified: boolean
  bvnVerified: boolean
  phoneVerified: boolean
  emailVerified: boolean
  isBanned: boolean
  banReason?: string | null
  sellerRating: number
  totalSales: number
  totalRentals: number
  activeListingCount: number
  isSellerReady: boolean
  storeName?: string
  storeDescription?: string
  storeLogoUrl?: string
  storeBannerUrl?: string
  storeCategory?: string
  storeState?: string
  storeCity?: string
  storeWhatsApp?: string
  storeInstagram?: string
  // Marks this seller as an official Zamorax-owned store (e.g. "Zamorax
  // Enterprises Ltd" — bulk-sourced, locally warehoused stock). Admin-set
  // only. Listings inherit this via their seller_id, not a per-listing flag.
  isOfficial?: boolean
  profilePhoto?: string
  fcmToken?: string
  badges?: string[]
  // ── Vacation Mode ─────────────────────────────────────────────
  vacationMode?: boolean
  vacationReturnDate?: string           // ISO string
  vacationMessage?: string
  createdAt: string | FirestoreTimestamp                     // ISO string
  updatedAt: string | FirestoreTimestamp                     // ISO string
}

export interface RegisterData {
  email: string
  password: string
  fullName: string
  username: string
  phone?: string
  role?: "buyer" | "seller" | "both"
  storeName?: string
  storeDescription?: string
  nigerianState?: string
  nin?: string
  referredBy?: string
}

// ─── Listing ─────────────────────────────────────────────────────
export type ListingType      = "sale" | "rent" | "both"
export type ListingCondition = "brand_new" | "open_box" | "grade_a" | "grade_b"
export type ListingStatus    = "draft" | "pending" | "pending_fbz" | "pending_fbz_stock" | "active" | "sold" | "rented" | "paused" | "suspended" | "rejected"
export type BoostType        = "standard" | "premium" | "category_top" | null

export interface Listing {
  id: string
  sellerId: string
  categoryId: string
  categorySlug: string
  title: string
  slug: string
  description: string
  listingType: ListingType
  condition: ListingCondition
  priceSale: number                     // kobo — 1-piece price
  // ── Bulk / quantity pricing — seller-defined tiers, e.g.
  //    1 piece: priceSale | ≥5: ₦X | ≥15: ₦Y | ≥25: ₦Z
  //    Sorted ascending by minQty. Seller can add/remove tiers freely,
  //    not fixed to any count. Absent/empty = no bulk pricing set.
  bulkPricing?: BulkTier[] | null
  // Hard floor on order size, separate from bulk pricing tiers. Optional.
  minOrderQty?: number | null
  // How this item is sold — defaults to "piece" if unset.
  unitOfSale?: string | null
  // Per-listing offer toggle. Undefined/true = offers allowed (default);
  // false = seller opted out. Admin's platform-wide toggle still wins.
  // Optional per-listing threshold for the seller dashboard's low-stock
  // widget. Defaults to 3 if unset — see checkLowStock in listings provider.
  lowStockThreshold?: number | null
  offersEnabled?: boolean
  priceRentDaily?: number
  priceRentWeekly?: number
  depositAmount?: number
  images: string[]
  verificationVideo?: string
  attributes: Record<string, any>
  isHubVerified: boolean
  /** True once admin has activated FBZ (Fulfilled by Zamorax) for this listing — the seller's stock physically arrived at, and was inspected in, a Zamorax warehouse. Shown to buyers as a stronger trust signal than a regular listing. Set by admin/fbz intake, not the seller. */
  isFBZ?: boolean
  /** Kobo — when set (including 0), overrides the calculated FBZ delivery fee for this specific listing. 0 = free delivery on this listing regardless of buyer state/weight. Undefined/null = use the normal zone-based calculation. */
  deliveryFeeOverrideKobo?: number | null
  isActive: boolean
  isBoosted: boolean
  // Admin has chosen to showcase this listing under Zamorax Direct, even
  // though it belongs to a regular (non-official) seller. Admin-only.
  // While true, the listing is hidden from normal search/store views and
  // only visible via the Zamorax Direct section/page.
  isZamoraxPick?: boolean
  // Combined official flag — true if the seller account itself is official
  // (users.is_official) OR admin picked this specific listing
  // (is_zamorax_pick). Computed server-side in /api/listings — use this for
  // the "Zamorax Enterprises Direct" badge, not isZamoraxPick alone, so
  // regular listings from an official seller show it too.
  isOfficial?: boolean
  boostType: BoostType
  boostExpiresAt?: string               // ISO string
  status: ListingStatus
  rejectionReason?: string
  nigerianState: string
  city: string
  deliveryNationwide: boolean
  weightKg?: number                     // kg — used for logistics fee calculation
  isFragile?: boolean                   // triggers fragile surcharge
  /** Delivery methods the seller has opted into. Auto-defaults to ["meetup"] if absent. */
  shippingMethods?: DeliveryMethod[]
  /** Seller-stated estimated delivery window in days, e.g. 2 or "2-4". Shown to buyers as a fast-delivery trust signal. Optional — omit if seller doesn't want to commit to a window. */
  estimatedDeliveryDays?: string
  /** Stock quantity. null/undefined = unlimited; 0 = out of stock; 1+ = available qty */
  stockQty?: number | null
  views: number
  saves: number
  inquiries: number
  sellerName?: string
  sellerPlan?: "free" | "starter" | "pro"
  sellerRating?: number
  sellerVerified?: boolean
  flashDeal?: {
    discountPercent: number
    expiresAt: string | FirestoreTimestamp                   // ISO string
    createdAt: string | FirestoreTimestamp
  } | null
  // ── Seller-set coupon code — set at listing creation, gated on
  // sub_settings.couponsEnabled. Unlike flashDeal (time-limited, admin-style),
  // a coupon has no expiry — it's a standing code buyers enter at checkout.
  coupon?: {
    code: string             // e.g. "SAVE10" — seller-chosen, stored uppercase
    discountPercent: number  // 1-90
  } | null
  // ── Vacation Mode ─────────────────────────────────────────────
  vacationMode?: boolean
  vacationReturnDate?: string           // ISO string
  createdAt: string | FirestoreTimestamp                     // ISO string
  updatedAt: string | FirestoreTimestamp                     // ISO string
}

export interface ListingFilters {
  category?: string
  listingType?: ListingType
  condition?: ListingCondition
  nigerianState?: string
  minPrice?: number
  maxPrice?: number
  verified?: boolean
  /** Restrict to official Zamorax Enterprises listings (bulk-sourced, locally warehoused). */
  official?: boolean
  q?: string
  sort?: "price_asc" | "price_desc" | "newest" | "direct_first"
  /** Restrict results to listings owned by this seller (e.g. "attach listing" pickers). */
  sellerId?: string
}

export interface PaginatedResult<T> {
  items: T[]
  nextCursor: unknown | null            // opaque — pass back to next call
  hasMore: boolean
}

// ─── Category ────────────────────────────────────────────────────
export interface Category {
  id: string
  name: string
  slug: string
  icon?: string
  phase?: number
  order: number
}

// ─── Order ───────────────────────────────────────────────────────
export type OrderType = "purchase" | "rental"

export interface Order {
  id: string
  buyerId: string
  sellerId: string
  listingId: string
  itemTitle: string
  itemImage?: string
  // Fashion variant the buyer selected at add-to-cart time, if the
  // listing offered more than one color/size (attributes.colors /
  // attributes.sizes on the listing). Carried through from CartItem
  // so sellers know exactly what to ship.
  selectedColor?: string
  selectedSize?: string
  sellerName?: string
  sellerStoreName?: string
  buyerName?: string
  totalAmount: number                   // kobo
  sellerPayout: number                  // kobo
  platformFee: number                   // kobo
  status: string
  orderType: OrderType
  escrowStatus: string
  escrowReleaseAt?: string              // ISO string
  autoReleased?: boolean
  chatId?: string
  trackingNumber?: string
  logisticsProvider?: string
  // ── Admin/moderator fulfillment override ────────────────────────
  // 'seller' (default) → only the seller can mark this order shipped.
  // 'zamorax' → an admin/moderator confirmed the goods are with Zamorax
  // and marked it shipped on the seller's behalf (official listings/sellers
  // only — see app/api/admin/orders/[id]/ship). Payout to the seller is
  // completely unaffected by this — escrow release still works the same way.
  fulfilledBy?: "seller" | "zamorax"
  markedShippedBy?: string
  markedShippedAt?: string
  // ── Buyer delivery address ────────────────────────────────────
  deliveryStreet?: string
  deliveryCity?: string
  deliveryState?: string
  deliveryLGA?: string
  // ── ZamoraxLogic delivery fields ──────────────────────────────
  deliveryMethod?: "meetup" | "zamorax_logistics" | "fbz"
  deliveryFee?: number                  // kobo — Zamorax price charged to buyer
  zlaDeliveryCost?: number              // kobo — actual ZLA rate (our cost)
  zlaMargin?: number                    // kobo — our profit (deliveryFee - zlaDeliveryCost)
  sellerState?: string
  buyerState?: string
  zlaShipmentId?: string               // ZLA shipment ID after booking
  zlaTrackingCode?: string             // ZLA tracking code
  zlaOriginAgent?: string              // agent name + address for seller
  zlaBookedAt?: string | FirestoreTimestamp
  zlaBookingStatus?: "pending" | "booked" | "failed"
  // ── Cart order fields ──────────────────────────────────────────
  lineItems?: CartLineItem[]           // for cart orders — multiple items per seller
  cartPaymentRef?: string              // links all cart orders to same payment
  paymentReference?: string             // set at creation time to avoid a second write
  paymentProvider?: string              // "manual" | "paystack" | "flutterwave"
  rentalStart?: string                  // ISO string
  rentalEnd?: string                    // ISO string
  rentalDays?: number
  disputeId?: string
  // ── Offer order fields ────────────────────────────────────────
  itemPrice?: number                    // kobo — actual price paid (offer price or listing price)
  originalPrice?: number                // kobo — original listing price before offer
  isOfferOrder?: boolean                // true if order was placed at offer price
  offerId?: string | null               // reference to the accepted offer
  createdAt: string | FirestoreTimestamp                     // ISO string
  updatedAt: string | FirestoreTimestamp                     // ISO string
  completedAt?: string
  deliveredAt?: string | FirestoreTimestamp
  refundedAt?: string
}

// ─── Cart ─────────────────────────────────────────────────────────
export interface CartLineItem {
  listingId: string
  title: string
  qty: number
  unitPrice: number                     // kobo — original listing price
  agreedPrice?: number                  // kobo — if buyer has accepted offer
  offerId?: string | null               // reference to the accepted offer, if agreedPrice is set
  // Fashion variant selected for this specific line item — a cart order
  // can bundle several listings from the same seller, each with its own
  // color/size choice, so this lives per-line rather than on the order.
  selectedColor?: string | null
  selectedSize?: string | null
}

export interface CartItem {
  listingId: string
  listingTitle: string
  listingImage?: string
  sellerId: string
  sellerName: string
  // Zamorax Enterprises Direct listings (official seller) vs. third-party
  // seller listings. Needed at checkout so the marketplace-only Paystack
  // toggle (paystackEnabledForMarketplace) can apply correctly when a cart
  // mixes both — see CartCheckoutModal.
  sellerIsOfficial?: boolean
  sellerState: string                   // seller's nigerianState — for ZLA fee calc
  priceSale: number                     // kobo — resolved UNIT price at the quantity the item was added/last updated at
  // ── Bulk pricing passthrough — lets the cart re-resolve the correct
  // total (and unit price) whenever quantity changes, instead of the
  // stale per-unit rate captured at add-to-cart time. Undefined when the
  // listing has no bulk pricing.
  basePriceSale?: number                // kobo — undiscounted 1-piece price (pre-flash/coupon), used for below-first-tier math
  bulkPricing?: BulkTier[] | null
  minOrderQty?: number | null
  // The listing's actual stock at add-to-cart time — undefined/null means
  // unlimited/untracked stock (most listings). When set, this is the true
  // ceiling on quantity: a single-unit item (stockQty = 1) must never be
  // bumpable past 1 in the cart drawer just because the platform's generic
  // maxQtyPerItem default (e.g. 10) is higher. Not live-synced after
  // add-to-cart — if stock changes elsewhere while it's sitting in the
  // cart, checkout-time stock validation is the real backstop.
  stockQty?: number | null
  agreedPrice?: number                  // kobo — if buyer has accepted offer, use this
  offerId?: string | null               // reference to the accepted offer, if agreedPrice is set
  couponCode?: string                   // seller coupon code applied, if any (informational — priceSale already reflects the discount)
  quantity: number
  shippingMethods: DeliveryMethod[]     // methods seller supports
  // Whether this listing's stock is actually verified/held at a Zamorax
  // warehouse (listing.isFBZ, set only by admin FBZ intake). This is the
  // real source of truth for offering FBZ Express at checkout — do not
  // derive FBZ eligibility from shippingMethods alone, which just
  // reflects delivery methods the seller opted into.
  isFBZ?: boolean
  /** Kobo — carried from listing.deliveryFeeOverrideKobo. 0 = free delivery on this item regardless of buyer state/weight. */
  deliveryFeeOverrideKobo?: number | null
  weightKg?: number
  isFragile?: boolean
  // Fashion variant selection — set when the listing offers multiple
  // colors/sizes (attributes.colors / attributes.sizes) and the buyer
  // picked one of each before adding to cart. Undefined for listings
  // with no variants or only one option.
  selectedColor?: string
  selectedSize?: string
  addedAt: string                       // ISO
}

export interface CartItemGroup {
  sellerId: string
  sellerName: string
  sellerState: string
  lineItems: CartLineItem[]
  deliveryMethod: string
  deliveryFee: number                   // kobo
  subtotal: number                      // kobo
  platformFee: number                   // kobo
  sellerPayout: number                  // kobo
}

// ─── Price Alerts ─────────────────────────────────────────────────
export interface PriceAlert {
  userId: string
  listingId: string
  listingTitle: string
  listingImage?: string
  sellerId: string
  currentPrice: number                  // kobo — price when alert was set
  targetPrice: number                   // kobo — notify when priceSale drops to this or below
  status: "active" | "triggered" | "cancelled"
  createdAt: string | FirestoreTimestamp
  triggeredAt?: string | FirestoreTimestamp
}

// ─── Recently Viewed ──────────────────────────────────────────────
export interface RecentlyViewedItem {
  listingId: string
  title: string
  images: string[]
  priceSale: number                     // kobo
  sellerId: string
  nigerianState: string
  viewedAt: string | FirestoreTimestamp
}

// ─── Seller Follows ───────────────────────────────────────────────
export interface SellerFollow {
  followerId: string
  sellerId: string
  followerName?: string
  createdAt: string | FirestoreTimestamp
}

// ─── Dispute ─────────────────────────────────────────────────────
export type DisputeReason =
  | "item_not_received" | "item_not_as_described" | "wrong_item_sent"
  | "damaged_item" | "seller_unresponsive" | "other"

export type DisputeVerdict =
  | "refund_buyer" | "release_seller" | "partial_refund" | "escalate"

export interface Dispute {
  id: string
  orderId: string
  buyerId: string
  sellerId: string
  raisedBy: "buyer" | "seller"
  reason: DisputeReason
  description: string
  evidence?: string[]
  sellerEvidence?: string[]
  status: string
  verdict?: DisputeVerdict
  refundPercent?: number
  sellerResponse?: string
  sellerRespondedAt?: string            // ISO string
  moderatorId?: string
  moderatorNotes?: string
  autoResolved?: boolean
  autoResolvedAt?: string
  autoResolvedBy?: string
  autoResolvedNotes?: string
  createdAt: string | FirestoreTimestamp                     // ISO string
  updatedAt: string | FirestoreTimestamp
  resolvedAt?: string | FirestoreTimestamp
}

// ─── Offer ───────────────────────────────────────────────────────
export type OfferStatus = "pending" | "accepted" | "rejected" | "expired" | "countered" | "declined"

export interface Offer {
  id: string
  listingId: string
  listingTitle: string
  listingImage?: string
  buyerId: string
  buyerName?: string
  sellerId: string
  sellerName?: string
  originalPrice: number                 // kobo
  offerAmount: number                   // kobo
  counterAmount?: number
  /** Units this offer applies to. Defaults to 1 when absent (legacy offers). */
  quantity?: number
  message?: string
  status: OfferStatus
  /** If set, this offer was initiated from chat and the chatId is stored here */
  chatId?: string
  expiresAt: string | FirestoreTimestamp                     // ISO string
  createdAt: string | FirestoreTimestamp                     // ISO string
  updatedAt: string | FirestoreTimestamp                     // ISO string
  respondedAt?: string
}

// ─── Wallet ──────────────────────────────────────────────────────
export interface SellerWallet {
  userId: string
  balance: number                       // kobo
  pendingBalance: number                // kobo
  totalEarned: number                   // kobo
  updatedAt: string | FirestoreTimestamp                     // ISO string
}

export interface WalletTransaction {
  id: string
  userId: string
  type: string
  amount: number                        // kobo
  balanceAfter: number                  // kobo
  description: string
  orderId?: string
  reference?: string
  createdAt: string | FirestoreTimestamp                     // ISO string
}

export interface PayoutRequest {
  id: string
  userId: string
  amount: number                        // kobo
  bankName: string
  accountNumber: string
  accountName: string
  status: string
  paystackRecipientCode?: string
  paystackReference?: string
  failureReason?: string
  createdAt: string | FirestoreTimestamp                     // ISO string
  processedAt?: string
}

// ─── Notification ────────────────────────────────────────────────
export type NotificationType =
  | "order_update" | "dispute_update" | "dispute_auto_resolved"
  | "offer_received" | "offer_accepted" | "offer_rejected"
  | "listing_approved" | "listing_rejected" | "search_alert"
  | "badge_earned" | "payout_update" | "verification_update" | "system"

export interface Notification {
  id: string
  userId: string
  type: NotificationType
  title: string
  body: string
  link?: string
  listingImage?: string
  isRead: boolean
  createdAt: string | FirestoreTimestamp                     // ISO string
}

// ─── Chat ────────────────────────────────────────────────────────

/**
 * A regular text message — type is absent or "text".
 */
export interface ChatMessage {
  id: string
  senderId: string
  text: string
  createdAt: string | FirestoreTimestamp                     // ISO string
  isBlocked: boolean
  /** Distinguishes offer messages from regular text. Absent = regular text. */
  type?: "text" | "offer"
  /** Present only when type === "offer" */
  offerData?: ChatOfferData
}

/**
 * Payload embedded in a chat message of type "offer".
 * Mirrors the fields written to the offers collection so the bubble
 * can render amount + accept/decline without an extra Firestore read.
 */
export interface ChatOfferData {
  offerId: string
  offerAmount: number                   // kobo
  originalPrice: number                 // kobo
  listingTitle: string
  listingId: string
  /** Units this offer applies to. Defaults to 1 when absent (legacy offers). */
  quantity?: number
  /** Tracks whether the seller has already responded via this bubble */
  status: "pending" | "accepted" | "declined" | "countered"
}

export interface Chat {
  id: string
  participants: string[]
  participantNames?: Record<string, string>   // uid → display name
  buyerId?: string
  sellerId?: string
  buyerName?: string
  sellerName?: string
  listingId?: string
  listingTitle?: string
  listingImage?: string
  orderId?: string
  isLocked: boolean                     // true = escrow not yet funded
  lastMessage?: string
  lastMessageAt?: string | FirestoreTimestamp
  buyerLastReadAt?: string | null
  sellerLastReadAt?: string | null
  createdAt: string | FirestoreTimestamp
}

// ─── Agent / Referral wallets ────────────────────────────────────
export interface AgentWallet {
  balance: number
  totalEarned: number
  ownerId?: string
  agentId?: string
  agentUserId?: string
  createdAt?: string | FirestoreTimestamp
}

export interface AgentWalletTransaction {
  id: string
  amount: number
  type: string
  reason: string
  fromUserId?: string
  shipmentId?: string
  createdAt: string | FirestoreTimestamp
}

// ─── Storage ─────────────────────────────────────────────────────
export interface UploadResult {
  url: string
  path: string
}

// ─── Blog ─────────────────────────────────────────────────────────
export type { BlogPost, BlogFilters, BlogStatus, BlogEditorMode, BlogCategory, PaginatedBlogResult } from "./blog"
export { BLOG_CATEGORIES } from "./blog"


// ─── Delivery / Shipping ──────────────────────────────────────────
export type DeliveryMethod = "meetup" | "zamorax_logistics" | "fbz"

export type ShipmentStatus =
  | "pending"               // awaiting seller action
  | "seller_confirmed"      // seller confirmed the order
  | "dropped_off"           // seller dropped at origin agent
  | "picked_up_by_zla"      // ZLA agent collected item
  | "in_warehouse"          // item at Zamorax warehouse
  | "in_transit"            // moving between agents
  | "at_destination_agent"  // arrived at buyer's nearest agent
  | "out_for_delivery"      // agent on the way to buyer (doorstep)
  | "delivered"             // buyer confirmed receipt
  | "failed_delivery"       // could not deliver — returned to agent
  | "disputed"              // dispute opened
  | "returned"              // returned to seller's agent

export type AgentLocationType = "zamorax_agent" | "partner_hub" | "warehouse"

export interface AgentLocation {
  id: string
  name: string                   // e.g. "Ikeja Agent — Bayo Stores"
  agentUserId: string            // uid of the Zamorax agent user
  agentName: string
  agentPhone: string
  address: string
  state: string
  city: string
  lga: string
  lat: number
  lng: number
  type: AgentLocationType
  isActive: boolean
  operatingHours: string         // e.g. "Mon–Sat 8am–6pm"
  maxCapacity: number            // max parcels they can hold
  currentLoad: number            // current parcels in custody
  createdAt: string | FirestoreTimestamp
}
export interface ZamoraxShipment {
  id: string
  orderId: string
  listingId: string
  listingTitle: string
  listingImage?: string

  sellerId: string
  sellerName: string
  sellerPhone: string

  buyerId: string
  buyerName: string
  buyerPhone: string
  buyerAddress: string           // for doorstep delivery
  buyerState: string
  buyerCity: string

  originAgentId: string          // agent where seller drops off
  originAgentName: string
  destinationAgentId: string     // agent nearest to buyer
  destinationAgentName: string

  deliveryType: "agent_pickup" | "doorstep"  // buyer picks up OR we deliver to door
  deliveryFee: number            // kobo — paid by buyer at checkout

  trackingCode: string           // e.g. "ZML-ABC123"
  status: ShipmentStatus
  timeline: ShipmentEvent[]

  currentAgentId?: string        // which agent currently holds the parcel
  currentAgentName?: string

  estimatedDeliveryDays: number
  weight?: number                // kg, optional
  notes?: string

  createdAt: string | FirestoreTimestamp
  updatedAt: string | FirestoreTimestamp
  deliveredAt?: string | FirestoreTimestamp
}
export interface ShipmentEvent {
  status: ShipmentStatus
  agentId?: string
  agentName?: string
  note: string
  timestamp: string | FirestoreTimestamp
  scannedBy?: string             // agent uid who scanned
}
// ─── ZLA Logistics Pricing (Firestore-backed, admin-controlled) ──────────────
// Fetched from config/platform — never hardcoded here.
// Use LogisticsService.getDeliveryFee(sellerState, buyerState) at runtime.
export interface ZLALogisticsPricing {
  // State-to-state matrix key format: "Lagos-Abuja"
  matrix:                Record<string, number>   // kobo values
  weightThreshold:       number                   // kg
  weightSurchargeRate:   number                   // kobo per extra kg
  insuranceThreshold:    number                   // kobo declared value
  insuranceSurchargeRate: number                  // decimal e.g. 0.01
  doorstepFee:           number                   // kobo
  fragileFee:            number                   // kobo
}

export function generateTrackingCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  const rand  = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  return `ZMX-${rand(4)}-${rand(6)}`
}

export const SHIPMENT_STATUS_CONFIG: Record<ShipmentStatus, { label: string; color: string; description: string }> = {
  pending:           { label: "Pending",          color: "bg-gray-100 text-gray-700",     description: "Awaiting seller action" },
  seller_confirmed:  { label: "Confirmed",        color: "bg-blue-100 text-blue-700",     description: "Seller confirmed the order" },
  in_transit:        { label: "In Transit",      color: "bg-blue-100 text-blue-600",    description: "Moving between agents" },
  at_destination_agent: { label: "At Agent",      color: "bg-teal-100 text-teal-700",    description: "Arrived at buyer agent" },
  failed_delivery:   { label: "Failed Delivery", color: "bg-red-100 text-red-600",      description: "Could not deliver" },
  dropped_off:       { label: "Dropped Off",      color: "bg-indigo-100 text-indigo-700", description: "Item at ZLA agent" },
  picked_up_by_zla:  { label: "Picked Up",        color: "bg-purple-100 text-purple-700", description: "ZLA agent collected item" },
  in_warehouse:      { label: "In Warehouse",     color: "bg-yellow-100 text-yellow-700", description: "Item at Zamorax warehouse" },
  out_for_delivery:  { label: "Out for Delivery", color: "bg-orange-100 text-orange-700", description: "On the way to buyer" },
  delivered:         { label: "Delivered",        color: "bg-green-100 text-green-700",   description: "Delivered to buyer" },
  disputed:          { label: "Disputed",         color: "bg-red-100 text-red-700",       description: "Dispute opened" },
  returned:          { label: "Returned",         color: "bg-gray-100 text-gray-600",     description: "Item returned to seller" },
}

export type FirestoreTimestamp = { toDate: () => Date; seconds: number; nanoseconds: number }
export type FirestoreDoc = { id: string; [key: string]: any }
