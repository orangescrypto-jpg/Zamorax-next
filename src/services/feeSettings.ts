// src/services/feeSettings.ts
// Fee-specific settings split out from the main platformSettings.ts.
// All values stored in Firestore at config/fees.
// AdminService is the ONLY way to read/write Firestore — no direct Firebase imports.
//
// STORAGE FORMAT (Firestore):
//   commissionSale:        4      → 4%  (whole number, NOT decimal)
//   commissionRental:      6      → 6%
//   insuranceRate:         0.5    → 0.5%
//   withdrawalFee:         15000  → ₦150 (kobo)
//   sellerEscrowFeeCapKobo:200000 → ₦2,000 cap on seller commission — 0 = uncapped
//   buyerEscrowFeePercent: 0.6    → 0.6% escrow fee charged to the buyer
//   buyerEscrowFeeCapKobo: 200000 → ₦2,000 cap on buyer escrow fee — 0 = uncapped
//   buyerFeeEnabled:       true
//   buyerFeeLabel:         "Buyer Protection & Escrow Fee"
//
// USAGE IN COMPONENTS:
//   import { useFeeSettings } from "@/hooks/useFeeSettings"
//   const { fees } = useFeeSettings()
//   const commissionDecimal = fees.commissionSale / 100   // → 0.04
//
// WHY SEPARATE?
//   platformSettings.ts was getting very large. Fees change independently
//   and are read by many components (FeeBreakdown, FeeCalculator, BuyNowModal,
//   checkout, seller dashboard). This file owns that single concern.
//
// ESCROW FEE SPLIT (added):
//   The total escrow/platform fee on a transaction can now be split between
//   buyer and seller instead of sitting entirely on the seller's commission.
//   Each side has its own percentage AND its own optional cap:
//     - Seller side:  commissionSale / commissionRental (%) + sellerEscrowFeeCapKobo
//     - Buyer side:   buyerEscrowFeePercent (%)           + buyerEscrowFeeCapKobo
//   A cap of 0 (kobo) means "no cap" for that side — the fee grows unbounded
//   with the percentage. Any positive cap means the fee never exceeds that
//   amount, no matter how large the order is (same model as Kusnap's
//   "1.5%, capped at ₦2,000" escrow fee).

import { AdminService } from "@/src/services"

// ─── Fee settings type ────────────────────────────────────────────────────────

export interface FeeSettings {
  // ── Seller-side fees ──────────────────────────────────────────────────────
  // Stored as whole numbers: 4 = 4%. Divide by 100 for math.
  commissionSale:   number   // % of item price deducted from seller payout
  commissionRental: number   // % of rental value deducted from seller payout
  insuranceRate:    number   // % added to arbitration/dispute fund (from seller payout)
  // Cap on the seller commission, in kobo. 0 = uncapped (pure percentage).
  // Any positive value means the commission never exceeds this amount,
  // regardless of order size.
  sellerEscrowFeeCapKobo: number

  // Fixed fee deducted when seller requests a withdrawal (kobo)
  withdrawalFee: number

  // ── Buyer-side fee ────────────────────────────────────────────────────────
  // Percentage-based escrow fee added to the buyer's checkout total —
  // the buyer-side counterpart to the seller's commission above. Framed as
  // "Buyer Protection & Escrow Fee", not a generic platform fee.
  buyerEscrowFeePercent:  number   // whole number %, e.g. 0.6 = 0.6%
  // Cap on the buyer escrow fee, in kobo. 0 = uncapped.
  buyerEscrowFeeCapKobo:  number
  buyerFeeEnabled:        boolean  // master toggle — false = ₦0 charged to buyer
  buyerFeeLabel:          string   // text shown at checkout

  // ── Deprecated (kept for backward compatibility with old stored docs) ────
  // No longer used by calculateFees() — buyerEscrowFeePercent/CapKobo above
  // replaced this flat-fee model. Left here so existing Firestore docs and
  // any code still reading it don't break; new admin edits write the fields
  // above instead.
  buyerConvenienceFee?: number
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  // Seller fees — stored as whole % numbers
  commissionSale:   4,      // 4% — competitive, sustainable, covers Paystack costs
  commissionRental: 6,      // 6% — higher risk + service for rentals
  insuranceRate:    0.5,    // 0.5% — feeds the dispute/arbitration pool (AdminService)
  sellerEscrowFeeCapKobo: 0, // uncapped by default — admin can cap it, e.g. at ₦2,000
  withdrawalFee:    0,      // ₦0 — withdrawal fee removed

  // Buyer escrow fee — off by default, admin can enable + set the split later
  buyerEscrowFeePercent: 0,      // 0% until admin sets a split, e.g. 0.6
  buyerEscrowFeeCapKobo: 0,      // uncapped by default
  buyerFeeEnabled:       false,  // off at launch
  buyerFeeLabel:         "Buyer Protection & Escrow Fee",
}

// ─── Firestore path ───────────────────────────────────────────────────────────

const COLLECTION = "config"
const DOC_ID     = "fees"

// ─── Module-level cache ───────────────────────────────────────────────────────

let _cached: FeeSettings | null = null

// ─── Service methods ──────────────────────────────────────────────────────────

/**
 * One-time fetch of fee settings.
 * Falls back to DEFAULT_FEE_SETTINGS if Firestore doc doesn't exist yet.
 */
export async function getFeeSettings(): Promise<FeeSettings> {
  if (_cached) return _cached
  try {
    const snap = await AdminService.getDoc(COLLECTION, DOC_ID)
    if (snap) {
      _cached = { ...DEFAULT_FEE_SETTINGS, ...(snap as Partial<FeeSettings>) }
      return _cached
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_FEE_SETTINGS
}

/**
 * Save fee settings to Firestore.
 * Called from admin/fees settings page only.
 */
export async function saveFeeSettings(fees: Partial<FeeSettings>): Promise<void> {
  await AdminService.setDoc(COLLECTION, DOC_ID, fees, { merge: true })
  // Bust module-level cache so next read picks up the new values
  _cached = null
}

/**
 * Real-time subscription — all components on the same page share one listener.
 * Returns unsubscribe function.
 */
export function subscribeToFeeSettings(
  callback: (fees: FeeSettings) => void
): () => void {
  return AdminService.subscribeToDoc(COLLECTION, DOC_ID, doc => {
    const fees = doc
      ? { ...DEFAULT_FEE_SETTINGS, ...(doc as Partial<FeeSettings>) }
      : DEFAULT_FEE_SETTINGS
    _cached = fees
    callback(fees)
  })
}

export function invalidateFeeCache(): void {
  _cached = null
}

// ─── Helper: convert whole-number % to decimal multiplier ─────────────────────
// e.g. commissionSale = 4 → 0.04
export function toDecimal(wholePercent: number): number {
  return wholePercent / 100
}

// ─── Helper: apply an optional cap to a fee amount ─────────────────────────────
// A capKobo of 0 (or less) means "no cap" — the fee is returned unchanged.
// Any positive capKobo means the fee is clamped so it never exceeds that
// amount, regardless of how large the underlying order is.
export function applyCap(feeKobo: number, capKobo: number): number {
  if (!capKobo || capKobo <= 0) return feeKobo
  return Math.min(feeKobo, capKobo)
}

// ─── Helper: calculate full fee breakdown for a transaction ───────────────────

export interface FeeBreakdownResult {
  itemPriceKobo:     number
  // Seller-side commission — capped by sellerEscrowFeeCapKobo if set.
  commissionKobo:    number
  insuranceKobo:     number
  withdrawalFeeKobo: number
  totalDeductionsKobo: number
  sellerPayoutKobo:  number
  // Buyer-side escrow fee — capped by buyerEscrowFeeCapKobo if set.
  // Field name kept as buyerConvenienceKobo for backward compatibility with
  // existing consumers (BuyNowModal, CartCheckoutModal, admin preview) — it
  // now holds the percentage-based, capped escrow fee rather than a flat fee.
  buyerConvenienceKobo: number   // added to buyer total — 0 if disabled
  buyerTotalKobo:    number      // what buyer actually pays
  commissionPct:     number      // e.g. 4 (display) — pre-cap percentage
  insurancePct:      number      // e.g. 0.5 (display)
  buyerEscrowFeePct: number      // e.g. 0.6 (display) — pre-cap percentage
  // Whether the cap actually kicked in for this order — lets UIs show
  // "capped at ₦2,000" instead of the raw percentage once it's hit.
  sellerFeeCapped:   boolean
  buyerFeeCapped:    boolean
}

export function calculateFees(
  itemPriceKobo: number,
  transactionType: "sale" | "rental",
  fees: FeeSettings
): FeeBreakdownResult {
  const commissionPct  = transactionType === "rental" ? fees.commissionRental : fees.commissionSale

  const rawCommissionKobo = Math.floor(itemPriceKobo * toDecimal(commissionPct))
  const commissionKobo    = applyCap(rawCommissionKobo, fees.sellerEscrowFeeCapKobo)
  const sellerFeeCapped    = commissionKobo < rawCommissionKobo

  const insuranceKobo  = Math.floor(itemPriceKobo * toDecimal(fees.insuranceRate))
  const withdrawalFeeKobo = fees.withdrawalFee
  const totalDeductionsKobo = commissionKobo + insuranceKobo + withdrawalFeeKobo
  const sellerPayoutKobo    = itemPriceKobo - totalDeductionsKobo

  const rawBuyerFeeKobo = fees.buyerFeeEnabled
    ? Math.floor(itemPriceKobo * toDecimal(fees.buyerEscrowFeePercent))
    : 0
  const buyerConvenienceKobo = fees.buyerFeeEnabled
    ? applyCap(rawBuyerFeeKobo, fees.buyerEscrowFeeCapKobo)
    : 0
  const buyerFeeCapped = fees.buyerFeeEnabled && buyerConvenienceKobo < rawBuyerFeeKobo

  const buyerTotalKobo = itemPriceKobo + buyerConvenienceKobo

  return {
    itemPriceKobo,
    commissionKobo,
    insuranceKobo,
    withdrawalFeeKobo,
    totalDeductionsKobo,
    sellerPayoutKobo,
    buyerConvenienceKobo,
    buyerTotalKobo,
    commissionPct,
    insurancePct: fees.insuranceRate,
    buyerEscrowFeePct: fees.buyerEscrowFeePercent,
    sellerFeeCapped,
    buyerFeeCapped,
  }
}
