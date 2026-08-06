// src/services/index.ts
// ─────────────────────────────────────────────────────────────────
// WAS FIREBASE → NOW SUPABASE (auth) + CLOUDFLARE D1 (data) + R2 (files)
// Single import point for all app services.
// ─────────────────────────────────────────────────────────────────

export { AuthService }           from "./auth"
export { ListingsService }       from "./listings"
export { OrdersService }         from "./orders"
export { UsersService }          from "./users"
export { StorageService }        from "./storage"
export { ChatService }           from "./chat"
export { DisputesService }       from "./disputes"
export { OffersService }         from "./offers"
export { WalletService }         from "./wallet"
export { NotificationsService }  from "./notifications"
export { ReferralsService }      from "./referrals"
export { LogisticsService }      from "./logistics"
export { ShippingService }       from "./shipping"
export { PriceAlertsService }    from "./priceAlerts"
export { RecentlyViewedService } from "./recentlyViewed"
export { SellerFollowsService }  from "./sellerFollows"
export { BlogService }           from "./blog"
export { AdminService }          from "./admin"

export type { IAuthService }          from "./auth"
export type { IListingsService }      from "./listings"
export type { IOrdersService }        from "./orders"
export type { IUsersService }         from "./users"
export type { IStorageService }       from "./storage"
export type { IChatService }          from "./chat"
export type { IDisputesService }      from "./disputes"
export type { IOffersService }        from "./offers"
export type { IWalletService }        from "./wallet"
export type { INotificationsService } from "./notifications"
export type { IReferralsService }     from "./referrals"
export type { IBlogService }          from "./blog"
export type { IAdminService, FeaturedBanner } from "./admin"
export type { DeliveryFeeBreakdown, LogisticsPricingSnapshot, DeliveryZone } from "./logistics"
export type { ShippingMethodConfig, ShippingMethodKey, FBZWarehouseAvailability } from "./shipping"

// ── D1 shim helpers (Firestore-compatible API over D1) ────────────
// Used by any component still calling Firestore-style helpers during migration.
// These re-exports come from lib/db/shims.ts which routes all calls to AdminService.
export {
  where, orderBy, limit, query,
  serverTimestamp, Timestamp,
  arrayUnion, arrayRemove, increment,
  onSnapshot, collection, doc,
  getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  writeBatch,
} from "@/lib/db/shims"

export type { QueryConstraint, DocumentSnapshot, DocumentData } from "@/lib/db/shims"
