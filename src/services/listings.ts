// src/services/listings.ts
// WAS FIREBASE → NOW CLOUDFLARE D1
import type { Listing, ListingFilters, PaginatedResult, Category } from "@/src/types"
export { ListingsService } from "@/src/services/providers/cloudflare/listings"
export interface IListingsService {
  getListings(filters?: ListingFilters, cursor?: unknown): Promise<PaginatedResult<Listing>>
  getListingById(id: string): Promise<Listing | null>
  getListingsByIds(ids: string[]): Promise<Listing[]>
  getCategories(phase?: number): Promise<Category[]>
  getCategoryBySlug(slug: string): Promise<Category | null>
  createListing(data: Partial<Listing>, sellerId: string): Promise<{ id: string }>
  updateListing(id: string, data: Partial<Listing>): Promise<void>
  deleteListing(id: string): Promise<void>
  pauseListing(id: string): Promise<void>
  resumeListing(id: string): Promise<void>
  saveListing(listingId: string, userId: string): Promise<void>
  unsaveListing(listingId: string, userId: string): Promise<void>
  getSavedListings(userId: string): Promise<Listing[]>
  createFlashDeal(listingId: string, discountPercent: number, hours: number, applyToBulk?: boolean): Promise<void>
  cancelFlashDeal(listingId: string): Promise<void>
  approveListing(listingId: string, adminUid: string): Promise<void>
  rejectListing(listingId: string, adminUid: string, reason: string): Promise<void>
  subscribeToInsurancePool(callback: (balance: number) => void): () => void
  isFlashDealActive(listing: Listing): boolean
  getFlashPrice(originalKobo: number, discountPercent: number): number
}
