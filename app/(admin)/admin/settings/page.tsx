"use client"

import { adminFetch } from "@/lib/admin-fetch"
import { invalidateSettingsCache } from "@/src/services/platformSettings"
import { invalidatePlatformCache } from "@/hooks/usePlatformSettings"
// app/(admin)/admin/settings/page.tsx
// COMPLETE: All sections preserved + full new feature set:
//   ── Original ──────────────────────────────────────────────────────────────
//   Commission, Plans, Boosts, Payout, Dispute auto-resolution,
//   FBZ warehouse, Zamorax Logistics, Referral rewards, Search alerts,
//   Buyer badges, Q&A, Push notifications, Bundles, Platform features,
//   Maintenance mode, Bank details (BankDetailsSettings component)
//   ── New (added this pass) ────────────────────────────────────────────────
//   Payment provider selector, USD→NGN exchange rate
//   Listing controls (on/off + min price + max images)
//   Verification gate (NIN gate, BVN gate, selfie required, auto-approve,
//     accept new submissions, review SLA message, email verification)
//   Announcement bar (on/off + message + color)
//   Homepage sections (hero banner + featured listings)
//   Dispute controls (filing on/off)
//   Social links & contact
//   Promo codes (on/off + max discount %)
//   AI chatbot (on/off + greeting)
//   Image watermark (on/off)
//   Personalised feed (on/off)
//   Offer system (on/off + min offer % of price)
//   Reviews (on/off + min days post-order)
//   Return window (days + badge visibility)
//   Back-in-stock alerts (on/off + per-user limit)
//   Safe meet spots (on/off)
//   Chat security / pre-escrow link blocking (on/off)
//   WhatsApp support line + message template
//   Group buy (min participants + discount %)
//   Buyer inspection window (days + timer visibility)
//   Insurance pool (collection on/off + rental-specific)
//   Blog (on/off + moderator publish rights)
//   Seller trust score (on/off + NIN/BVN weights)
//   QR handshake for pickup orders (on/off)
//   PWA install prompt (on/off + delay)
//   Push notification opt-in prompt delay
// Saves to Firestore: config/platform (single doc, instant apply)

import { useEffect, useState } from "react"
import { useAuthStore } from "@/store/authStore"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/ui/use-toast"
import {
  Loader2, Save, Percent, ShieldCheck, CreditCard, Zap,
  Wallet, Bell, Bot, MessageSquare, Package2, Warehouse,
  Truck, Globe, AlertTriangle, Gift, MapPin, Phone, Clock,
  ChevronDown, ChevronUp, Megaphone, DollarSign, ListChecks,
  Mail, LayoutDashboard, ShieldAlert, Tag, Image, Film, Users,
  Star, QrCode, Smartphone, Heart, RotateCcw, Camera,
  Shield, BookOpen, TrendingUp, MessageCircle, Fingerprint,
  ShoppingCart, UserPlus, PalmtreeIcon,
} from "lucide-react"
import { BankDetailsSettings } from "@/components/admin/BankDetailsSettings"
import { nigerianStates } from "@/constants/nigerianStates"
import { cn } from "@/lib/utils"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Settings {
  // ── Commission & Fees ─────────────────────────────────────────────────────
  // NOTE: these three (commissionSale/Rental, insuranceRate) are unused
  // duplicates too — the live values are on /admin/fees (config/feeSettings).
  // withdrawalFee removed entirely: it wrote to `platform_settings` in
  // kv_store, a doc /api/seller/withdraw never reads from, so editing it
  // here silently did nothing to the real fee.
  commissionSale: number
  commissionRental: number
  insuranceRate: number

  // ── Plans ─────────────────────────────────────────────────────────────────
  planFreeListingLimit: number            // max active listings on free plan
  planFreeBoosts: number                  // free boosts per month on free plan
  planFreeLabel: string                   // badge label for free plan card

  planStarterPrice: number
  planStarterBillingMonths: number        // 1 = monthly, 3 = quarterly, 12 = annual
  planStarterListingLimit: number         // max active listings
  planStarterFreeBoosts: number           // free boosts per billing period
  planStarterLabel: string                // e.g. "Most Popular" or "" for no badge

  planProPrice: number
  planProBillingMonths: number
  planProListingLimit: number             // 0 = unlimited
  planProFreeBoosts: number
  planProLabel: string

  // ── Boosts ────────────────────────────────────────────────────────────────
  boostStandard: number
  boostStandardDays: number
  boostStandardLabel: string              // e.g. "Standard" or promo override
  boostStandardDesc: string              // shown on pricing page

  boostPremium: number
  boostPremiumDays: number
  boostPremiumLabel: string
  boostPremiumDesc: string

  boostCategoryTop: number
  boostCategoryTopDays: number
  boostCategoryTopLabel: string
  boostCategoryTopDesc: string

  hubVerificationFee: number

  // ── Payout ────────────────────────────────────────────────────────────────
  minPayoutAmount: number
  instantPayoutEnabled: boolean
  payoutProcessingHours: number

  // ── Dispute auto-resolution ───────────────────────────────────────────────
  autoResolveEnabled: boolean
  autoResolveItemNotReceivedDays: number
  autoResolveNoTrackingDays: number
  autoResolveSellerNoResponseHours: number
  autoResolveInspectionWindowDays: number
  autoResolveLowValueThreshold: number

  // ── FBZ — original fields ─────────────────────────────────────────────────
  fbzEnabled: boolean
  fbzStorageFeePerDayKobo: number
  fbzFulfillmentFeeKobo: number
  fbzMaxStockPerSeller: number
  fbzWarehouseCapacity: number
  fbzAutoRejectDamagedGoods: boolean
  fbzRequireInsurance: boolean
  fbzInsuranceRatePercent: number
  fbzWarehouseAddress: string
  fbzWarehousePhone: string
  fbzWarehouseHours: string
  fbzInboundFeeKobo: number
  fbzPickPackFeeKobo: number
  fbzDeliveryPartner: string
  fbzDeliveryDaysMin: number
  fbzDeliveryDaysMax: number
  fbzPauseReason: string

  // ── Search alerts ─────────────────────────────────────────────────────────
  maxSearchAlertsPerUser: number
  searchAlertCooldownHours: number

  // ── Buyer badges ──────────────────────────────────────────────────────────
  badgeVerifiedBuyerOrders: number
  badgeTrustedBuyerOrders: number
  badgePowerBuyerOrders: number

  // ── Q&A ───────────────────────────────────────────────────────────────────
  qnaEnabled: boolean
  qnaSellerResponseSLAHours: number

  // ── Push notifications ────────────────────────────────────────────────────
  pushNotifsEnabled: boolean
  pushPriceDropAlertsEnabled: boolean

  // ── Bundles ───────────────────────────────────────────────────────────────
  bundlesEnabled: boolean
  promoCodesEnabled: boolean
  shareListingEnabled: boolean
  listingDuplicationEnabled: boolean
  stockViewAlertEnabled: boolean
  stockViewAlertThreshold: number
  maxBundleItems: number
  maxBundleDiscountPercent: number

  // ── Platform features ─────────────────────────────────────────────────────
  maintenanceMode: boolean
  maintenanceMessage: string
  newUserRegistrationEnabled: boolean
  flashDealsEnabled: boolean
  groupBuyEnabled: boolean
  rentalsEnabled: boolean

  // ── Referral rewards ──────────────────────────────────────────────────────
  referralSignupRewardKobo: number         // buyer referral: paid on referred buyer's signup
  referralOrderRewardKobo: number          // buyer referral: paid on referred buyer's first order
  referralSellerSignupRewardKobo: number   // seller referral: paid on referred seller's signup
  referralSellerSaleRewardKobo: number     // seller referral: paid on referred seller's first completed sale
  referralBannerHeadline: string           // CTA banner headline on the referral dashboard
  referralBannerSubtext: string            // CTA banner subtext on the referral dashboard

  // ── Logistics ─────────────────────────────────────────────────────────────
  logisticsEnabled: boolean
  newZlaRegistrationOpen: boolean
  doorstepSurchargeKobo: number
  // ── ZLA state-to-state matrix (replaces zone fees) ────────────────────────
  zlaMatrix:              Record<string, number>  // kobo, key = "StateA-StateB"
  zlaDoorstepFee:         number                  // kobo
  zlaFragileFee:          number                  // kobo
  zlaWeightThreshold:     number                  // kg
  zlaWeightSurchargeRate: number                  // kobo per extra kg
  // ── ZLA agent commissions (unchanged) ────────────────────────────────────
  feeIntrastate: number
  feeSWtoSW: number
  feeSWtoSE: number
  feeSWtoSS: number
  feeSWtoNC: number
  feeSWtoNW: number
  feeSWtoNE: number
  feeSEtoSE: number
  feeSEtoSS: number
  feeSEtoNC: number
  feeNCtoNC: number
  feeNWtoNW: number
  feeNEtoNE: number
  feeFarCrossCountry: number
  zlaParcelReceivedKobo: number
  zlaParcelDispatchedKobo: number
  zlaParcelDeliveredKobo: number
  zlaDoorstepBonusKobo: number

  // ── Payment provider ──────────────────────────────────────────────────────
  manualPaymentEnabled: boolean       // Bank Transfer (Manual)
  paystackCardEnabled: boolean        // Pay with Card (Paystack, card channel)
  paystackBankEnabled: boolean        // Bank (Online) (Paystack, bank/USSD/transfer channels)
  paystackPaymentEnabled: boolean     // legacy derived flag — kept for back-compat reads
  flutterwavePaymentEnabled: boolean  // Pay with Flutterwave — escrow-held checkout
  manualEnabledForMarketplace: boolean
  paystackEnabledForMarketplace: boolean
  flutterwaveEnabledForMarketplace: boolean
  payoutMethod: "manual" | "paystack" | "flutterwave" // seller withdrawal payout — separate from collection above

  // ── Exchange rate ─────────────────────────────────────────────────────────
  usdToNgnRate: number

  // ── Listing controls ──────────────────────────────────────────────────────
  listingCreationEnabled: boolean
  minListingPriceKobo: number
  maxImagesPerListing: number

  // ── Video upload controls ──────────────────────────────────────────────────
  videoUploadEnabled: boolean
  maxVideoSizeMb: number
  videoMaxDurationSec: number
  videoRequiredForPlan: "none" | "starter" | "pro"
  allowedVideoTypes: string[]              // stored as array in Firestore

  // ── Identity verification controls ───────────────────────────────────────
  requireNinBvnBeforeListing: boolean
  requireNinBeforeOrders: boolean
  requireNinBeforeChat: boolean
  acceptNewNinSubmissions: boolean
  acceptNewBvnSubmissions: boolean
  requireSelfieForVerification: boolean
  autoApproveVerifications: boolean
  verificationReviewSlaHours: number
  verificationReviewMessage: string       // shown to users while pending
  maxSelfieSizeMb: number

  // ── Email verification ────────────────────────────────────────────────────
  emailVerificationRequired: boolean

  // ── Announcement bar ──────────────────────────────────────────────────────
  announcementBarEnabled: boolean
  announcementBarMessage: string
  announcementBarColor: "info" | "warning" | "success" | "danger"

  // ── Homepage sections ─────────────────────────────────────────────────────
  homepageHeroBannerEnabled: boolean
  homepageFeaturedListingsEnabled: boolean
  // ── Zamorax Direct (official/enterprise seller listings) ─────────────────
  homepageZamoraxDirectEnabled: boolean
  homepageZamoraxDirectCount: number
  // ── Rentals carousel ───────────────────────────────────────────────────────
  homepageRentalsEnabled: boolean
  homepageRentalsCount: number

  // ── Dispute controls ──────────────────────────────────────────────────────
  disputeFilingEnabled: boolean

  // ── Social links & contact ────────────────────────────────────────────────
  socialTwitterUrl: string
  socialInstagramUrl: string
  socialLinkedInUrl: string
  socialWhatsAppNumber: string
  contactEmail: string
  // Contact page details
  contactAddress: string
  contactPhone: string
  supportHours: string

  // ── Promo codes ───────────────────────────────────────────────────────────
  promoEnabled: boolean
  maxPromoDiscountPercent: number

  // ── AI chatbot ────────────────────────────────────────────────────────────
  chatbotEnabled: boolean
  chatbotGreeting: string

  // ── Image watermark ───────────────────────────────────────────────────────
  imageWatermarkEnabled: boolean

  // ── Personalised feed ─────────────────────────────────────────────────────
  personalisedFeedEnabled: boolean

  // ── Offer / counter-offer system ─────────────────────────────────────────
  offersEnabled: boolean
  makeOfferEnabled: boolean             // gates the MakeOfferModal on listing pages
  minOfferPercent: number                 // e.g. 50 = buyer can't offer < 50% of price

  // ── Reviews & ratings ────────────────────────────────────────────────────
  reviewsEnabled: boolean
  reviewMinDaysAfterOrder: number

  // ── Return window ─────────────────────────────────────────────────────────
  returnWindowDays: number
  returnGuaranteeBadgeVisible: boolean

  // ── Back-in-stock alerts ──────────────────────────────────────────────────
  backInStockAlertsEnabled: boolean
  maxBackInStockPerUser: number

  // ── Safe meet spots ───────────────────────────────────────────────────────
  safeMeetEnabled: boolean

  // ── Chat feature ────────────────────────────────────────────────────────────
  chatEnabled: boolean
  // ── Chat pre-escrow security ──────────────────────────────────────────────
  chatEscrowLockEnabled: boolean

  // ── WhatsApp support line ─────────────────────────────────────────────────
  whatsappSupportEnabled: boolean
  whatsappSupportNumber: string
  whatsappSupportMessage: string

  // ── Group buy overrides ───────────────────────────────────────────────────
  groupBuyMinParticipants: number
  groupBuyDiscountPercent: number

  // ── Inspection window (buyer-facing) ─────────────────────────────────────
  buyerInspectionWindowHours: number
  showInspectionCountdown: boolean

  // ── Insurance pool ────────────────────────────────────────────────────────
  insuranceCollectionEnabled: boolean
  insuranceRequiredForRentals: boolean

  // ── Blog ──────────────────────────────────────────────────────────────────
  blogEnabled: boolean
  moderatorCanPublishBlog: boolean

  // ── Seller trust score ────────────────────────────────────────────────────
  trustScoreVisible: boolean
  trustScoreNinWeight: number
  trustScoreBvnWeight: number

  // ── QR handshake ──────────────────────────────────────────────────────────
  qrHandshakeRequired: boolean

  // ── PWA install prompt ────────────────────────────────────────────────────
  pwaInstallPromptEnabled: boolean
  pwaInstallPromptDelaySec: number

  // ── Push opt-in prompt ────────────────────────────────────────────────────
  pushOptInPromptDelaySec: number

  // ── FBZ coverage ──────────────────────────────────────────────────────────
  fbzCoveredStates: string[]

  // ── ZLA coverage ──────────────────────────────────────────────────────────
  zlaCoveredStates: string[]

  // ── PWA extended ──────────────────────────────────────────────────────────
  pwaReshowAfterDismissSec: number
  pwaHeadline: string
  pwaSubtitle: string

  // ── Multi-Cart ────────────────────────────────────────────────────────────
  multiCartEnabled: boolean
  maxCartItems: number
  maxQtyPerItem: number
  lowStockThreshold: number
  showLowStockWarning: boolean

  // ── Buyer Tools ───────────────────────────────────────────────────────────
  priceAlertsEnabled: boolean
  recentlyViewedEnabled: boolean

  // ── Seller Features ───────────────────────────────────────────────────────
  sellerFollowsEnabled: boolean
  vacationModeEnabled: boolean

  // ── Homepage: Platform Stats bar ──────────────────────────────────────────
  platformStatsEnabled: boolean
  platformStatListings: string       // e.g. "50,000+"
  platformStatSellers: string        // e.g. "12,000+"
  platformStatBuyers: string         // e.g. "80,000+"
  platformStatTransactions: string   // e.g. "₦2B+"

  // ── Homepage: How It Works ────────────────────────────────────────────────
  howItWorksEnabled: boolean
  howItWorksTitle: string
  howItWorksStep1Icon: string
  howItWorksStep1Title: string
  howItWorksStep1Desc: string
  howItWorksStep2Icon: string
  howItWorksStep2Title: string
  howItWorksStep2Desc: string
  howItWorksStep3Icon: string
  howItWorksStep3Title: string
  howItWorksStep3Desc: string
  howItWorksStep4Icon: string
  howItWorksStep4Title: string
  howItWorksStep4Desc: string
  howItWorksStepCount: number        // 2, 3, or 4 active steps
}

const DEFAULTS: Settings = {
  // Commission & Fees
  commissionSale: 0.015,
  commissionRental: 0.04,
  insuranceRate: 0.005,
  // Plans
  planFreeListingLimit: 5,
  planFreeBoosts: 0,
  planFreeLabel: "",

  planStarterPrice: 150000,
  planStarterBillingMonths: 1,
  planStarterListingLimit: 20,
  planStarterFreeBoosts: 1,
  planStarterLabel: "⭐ Most Popular",

  planProPrice: 350000,
  planProBillingMonths: 1,
  planProListingLimit: 0,
  planProFreeBoosts: 3,
  planProLabel: "",

  // Boosts
  boostStandard: 50000,
  boostStandardDays: 7,
  boostStandardLabel: "Standard",
  boostStandardDesc: "3× more views. Appear higher in category search results.",

  boostPremium: 150000,
  boostPremiumDays: 14,
  boostPremiumLabel: "Premium",
  boostPremiumDesc: "Top 3 placement in search. Homepage featured section.",

  boostCategoryTop: 300000,
  boostCategoryTopDays: 7,
  boostCategoryTopLabel: "Category Top",
  boostCategoryTopDesc: "#1 spot in your category. Maximum visibility.",

  hubVerificationFee: 200000,
  // Payout
  minPayoutAmount: 100000,
  instantPayoutEnabled: true,
  payoutProcessingHours: 24,
  // Dispute auto-resolution
  autoResolveEnabled: true,
  autoResolveItemNotReceivedDays: 14,
  autoResolveNoTrackingDays: 7,
  autoResolveSellerNoResponseHours: 48,
  autoResolveInspectionWindowDays: 3,
  autoResolveLowValueThreshold: 500000,
  // FBZ
  fbzEnabled: true,
  fbzStorageFeePerDayKobo: 500,
  fbzFulfillmentFeeKobo: 1500,
  fbzMaxStockPerSeller: 500,
  fbzWarehouseCapacity: 10000,
  fbzAutoRejectDamagedGoods: true,
  fbzRequireInsurance: false,
  fbzInsuranceRatePercent: 0.5,
  fbzWarehouseAddress: "",
  fbzWarehousePhone: "",
  fbzWarehouseHours: "Mon–Sat, 9am–5pm",
  fbzInboundFeeKobo: 50000,
  fbzPickPackFeeKobo: 40000,
  fbzDeliveryPartner: "GIG Logistics",
  fbzDeliveryDaysMin: 1,
  fbzDeliveryDaysMax: 3,
  fbzPauseReason: "",
  // Search alerts
  maxSearchAlertsPerUser: 10,
  searchAlertCooldownHours: 6,
  // Buyer badges
  badgeVerifiedBuyerOrders: 5,
  badgeTrustedBuyerOrders: 20,
  badgePowerBuyerOrders: 50,
  // Q&A
  qnaEnabled: true,
  qnaSellerResponseSLAHours: 24,
  // Push notifications
  pushNotifsEnabled: true,
  pushPriceDropAlertsEnabled: true,
  // Bundles
  bundlesEnabled: true,
  promoCodesEnabled: true,
  shareListingEnabled: true,
  listingDuplicationEnabled: true,
  stockViewAlertEnabled: true,
  stockViewAlertThreshold: 50,
  maxBundleItems: 5,
  maxBundleDiscountPercent: 30,
  // Platform features
  maintenanceMode: false,
  maintenanceMessage: "",
  newUserRegistrationEnabled: true,
  flashDealsEnabled: true,
  groupBuyEnabled: true,
  rentalsEnabled: true,
  // Referral rewards
  referralSignupRewardKobo: 50000,
  referralOrderRewardKobo: 200000,
  referralSellerSignupRewardKobo: 50000,
  referralSellerSaleRewardKobo: 300000,
  referralBannerHeadline: "Earn up to ₦3,000 per referral!",
  referralBannerSubtext: "Invite friends to buy or sell on Zamorax and get paid instantly.",
  // Logistics
  logisticsEnabled: true,
  newZlaRegistrationOpen: true,
  doorstepSurchargeKobo: 50000,
  zlaMatrix: {},
  zlaDoorstepFee: 50000,
  zlaFragileFee: 30000,
  zlaWeightThreshold: 5,
  zlaWeightSurchargeRate: 20000,
  feeIntrastate: 150000,
  feeSWtoSW: 200000,
  feeSWtoSE: 350000,
  feeSWtoSS: 350000,
  feeSWtoNC: 300000,
  feeSWtoNW: 450000,
  feeSWtoNE: 500000,
  feeSEtoSE: 200000,
  feeSEtoSS: 300000,
  feeSEtoNC: 350000,
  feeNCtoNC: 200000,
  feeNWtoNW: 200000,
  feeNEtoNE: 200000,
  feeFarCrossCountry: 500000,
  zlaParcelReceivedKobo: 20000,
  zlaParcelDispatchedKobo: 15000,
  zlaParcelDeliveredKobo: 30000,
  zlaDoorstepBonusKobo: 10000,
  // Payment provider
  manualPaymentEnabled: true,
  paystackCardEnabled: false,
  paystackBankEnabled: false,
  paystackPaymentEnabled: false,
  flutterwavePaymentEnabled: false,
  manualEnabledForMarketplace: true,
  paystackEnabledForMarketplace: true,
  flutterwaveEnabledForMarketplace: false,
  payoutMethod: "manual",
  // Exchange rate
  usdToNgnRate: 1600,
  // Listing controls
  listingCreationEnabled: true,
  minListingPriceKobo: 50000,
  maxImagesPerListing: 10,
  // Video upload controls
  videoUploadEnabled: false,
  maxVideoSizeMb: 50,
  videoMaxDurationSec: 60,
  videoRequiredForPlan: "none" as const,
  allowedVideoTypes: ["video/mp4", "video/quicktime", "video/webm"],
  // Identity verification controls
  requireNinBvnBeforeListing: true,
  requireNinBeforeOrders: false,
  requireNinBeforeChat: false,
  acceptNewNinSubmissions: true,
  acceptNewBvnSubmissions: true,
  requireSelfieForVerification: true,
  autoApproveVerifications: false,
  verificationReviewSlaHours: 24,
  verificationReviewMessage: "Your submission is under review. Usually approved within 24 hours.",
  maxSelfieSizeMb: 5,
  // Email verification
  emailVerificationRequired: true,
  // Announcement bar
  announcementBarEnabled: false,
  announcementBarMessage: "",
  announcementBarColor: "info",
  // Homepage sections
  homepageHeroBannerEnabled: true,
  homepageFeaturedListingsEnabled: true,
  homepageZamoraxDirectEnabled: true,
  homepageZamoraxDirectCount: 8,
  homepageRentalsEnabled: true,
  homepageRentalsCount: 8,
  // Dispute controls
  disputeFilingEnabled: true,
  // Social links & contact
  socialTwitterUrl: "",
  socialInstagramUrl: "",
  socialLinkedInUrl: "",
  socialWhatsAppNumber: "2348000000000",
  contactEmail: "hello@zamorax.com",
  contactAddress: "",
  contactPhone: "",
  supportHours: "Monday–Saturday: 9AM–6PM WAT",
  // Promo codes
  promoEnabled: true,
  maxPromoDiscountPercent: 50,
  // AI chatbot
  chatbotEnabled: true,
  chatbotGreeting: "Hi! I'm Zamorax AI. How can I help you today?",
  // Image watermark
  imageWatermarkEnabled: true,
  // Personalised feed
  personalisedFeedEnabled: true,
  // Offer system
  offersEnabled: true,
  makeOfferEnabled: true,
  minOfferPercent: 50,
  // Reviews
  reviewsEnabled: true,
  reviewMinDaysAfterOrder: 1,
  // Return window
  returnWindowDays: 3,
  returnGuaranteeBadgeVisible: true,
  // Back-in-stock
  backInStockAlertsEnabled: true,
  maxBackInStockPerUser: 20,
  // Safe meet
  safeMeetEnabled: true,
  // Chat feature
  chatEnabled: true,
  // Chat security
  chatEscrowLockEnabled: true,
  // WhatsApp support
  whatsappSupportEnabled: true,
  whatsappSupportNumber: "2347076479357",
  whatsappSupportMessage: "Hi Zamorax Support, I need help with",
  // Group buy overrides
  groupBuyMinParticipants: 5,
  groupBuyDiscountPercent: 15,
  // Inspection window
  buyerInspectionWindowHours: 24,
  showInspectionCountdown: true,
  // Insurance pool
  insuranceCollectionEnabled: true,
  insuranceRequiredForRentals: false,
  // Blog
  blogEnabled: true,
  moderatorCanPublishBlog: true,
  // Seller trust score
  trustScoreVisible: true,
  trustScoreNinWeight: 20,
  trustScoreBvnWeight: 15,
  // QR handshake
  qrHandshakeRequired: false,
  // PWA install prompt
  pwaInstallPromptEnabled: true,
  pwaInstallPromptDelaySec: 0,
  // Push opt-in prompt
  pushOptInPromptDelaySec: 30,
  // FBZ coverage
  fbzCoveredStates: [],
  // ZLA coverage
  zlaCoveredStates: [],
  // PWA extended
  pwaReshowAfterDismissSec: 86400,
  pwaHeadline: "Install Zamorax App",
  pwaSubtitle: "Add to home screen for faster access",
  // Multi-Cart
  multiCartEnabled: true,
  maxCartItems: 20,
  maxQtyPerItem: 10,
  lowStockThreshold: 3,
  showLowStockWarning: true,
  // Buyer Tools
  priceAlertsEnabled: true,
  recentlyViewedEnabled: true,
  // Seller Features
  sellerFollowsEnabled: true,
  vacationModeEnabled: true,

  // Platform Stats bar
  platformStatsEnabled: true,
  platformStatListings: "50,000+",
  platformStatSellers: "12,000+",
  platformStatBuyers: "80,000+",
  platformStatTransactions: "₦2B+",

  // How It Works
  howItWorksEnabled: true,
  howItWorksTitle: "How Zamorax Works",
  howItWorksStep1Icon: "Tag",
  howItWorksStep1Title: "List Your Item",
  howItWorksStep1Desc: "Post for free in under 2 minutes. Add photos, set your price, and go live instantly.",
  howItWorksStep2Icon: "ShieldCheck",
  howItWorksStep2Title: "Buyer Pays into Escrow",
  howItWorksStep2Desc: "Payment is held securely. Your money is safe until the buyer confirms delivery.",
  howItWorksStep3Icon: "BadgeCheck",
  howItWorksStep3Title: "Funds Released",
  howItWorksStep3Desc: "Once the buyer confirms receipt, funds are released to your wallet. Simple.",
  howItWorksStep4Icon: "Truck",
  howItWorksStep4Title: "Fast Delivery",
  howItWorksStep4Desc: "Nationwide delivery via ZamoraxLogic. Track your parcel in real time.",
  howItWorksStepCount: 3,
}

type NumKey  = { [K in keyof Settings]: Settings[K] extends number  ? K : never }[keyof Settings]
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]

// ─── Reusable field components ───────────────────────────────────────────────

function SectionCard({
  icon: Icon, title, children, accent, defaultOpen = true,
}: {
  icon: React.ElementType; title: string; children: React.ReactNode
  accent?: boolean; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className={accent ? "border-primary/30 ring-1 ring-primary/10" : ""}>
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          <span className="flex-1">{title}</span>
          {open
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
          }
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="space-y-4 pt-0">{children}</CardContent>}
    </Card>
  )
}

function NumField({ label, desc, value, onChange, prefix, suffix, step, min, max }: {
  label: string; desc?: string; value: number
  onChange: (v: number) => void
  prefix?: string; suffix?: string; step?: number; min?: number; max?: number
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">{label}</Label>
      {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      <div className="flex items-center gap-2">
        {prefix && <span className="text-sm text-muted-foreground shrink-0">{prefix}</span>}
        <Input
          type="number" value={value}
          onChange={e => onChange(Number(e.target.value))}
          step={step ?? 1} min={min ?? 0} max={max}
          className="max-w-xs"
        />
        {suffix && <span className="text-sm text-muted-foreground shrink-0">{suffix}</span>}
      </div>
    </div>
  )
}

function KoboField({ label, desc, value, onChange }: {
  label: string; desc?: string; value: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-sm text-muted-foreground">₦</span>
        <Input
          type="number"
          value={value / 100}
          onChange={e => onChange(Math.round(parseFloat(e.target.value) * 100))}
          step={100} min={0}
          className="w-28 text-right"
        />
      </div>
    </div>
  )
}

function ToggleRow({ label, desc, checked, onChange }: {
  label: string; desc?: string; checked: boolean; onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function StrField({ label, desc, value, onChange, placeholder }: {
  label: string; desc?: string; value: string
  onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">{label}</Label>
      {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

function InfoBox({ children, color = "blue" }: { children: React.ReactNode; color?: "blue" | "amber" | "red" | "green" }) {
  const cls = {
    blue:  "bg-blue-50 border-blue-100 text-blue-700",
    amber: "bg-amber-50 border-amber-100 text-amber-700",
    red:   "bg-red-50 border-red-100 text-red-700",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
  }[color]
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${cls}`}>{children}</div>
  )
}

// Checkout method toggles — admin can turn on any combination of the four
// buyer-facing methods. At least one must stay enabled; the checkout picker
// on Buy Now / Cart / Boost / Ad Boost / Subscription auto-shows a picker
// whenever 2+ are on, and skips it entirely when only 1 is on.
function ProviderPicker({
  manualEnabled,
  cardEnabled,
  bankEnabled,
  flutterwaveEnabled,
  onChange,
}: {
  manualEnabled: boolean
  cardEnabled:   boolean
  bankEnabled:   boolean
  flutterwaveEnabled: boolean
  onChange: (next: {
    manualPaymentEnabled: boolean
    paystackCardEnabled: boolean
    paystackBankEnabled: boolean
    paystackPaymentEnabled: boolean
    flutterwavePaymentEnabled: boolean
  }) => void
}) {
  const options: { id: "manual" | "card" | "bank" | "flutterwave"; label: string; desc: string; checked: boolean }[] = [
    { id: "manual",      label: "Bank Transfer (Manual)",   desc: "Buyers pay into your bank account. You confirm manually.",                                       checked: manualEnabled },
    { id: "card",        label: "Pay with Card",             desc: "Instant — card-only checkout via Paystack.",                                                     checked: cardEnabled },
    { id: "bank",        label: "Bank (Online)",             desc: "Instant — bank transfer, USSD, or direct bank debit via Paystack.",                              checked: bankEnabled },
    { id: "flutterwave", label: "Pay with Flutterwave",      desc: "Instant — card, bank transfer, or USSD via Flutterwave. Funds held in escrow until delivery.",    checked: flutterwaveEnabled },
  ]

  const enabledCount = [manualEnabled, cardEnabled, bankEnabled, flutterwaveEnabled].filter(Boolean).length

  const toggle = (id: "manual" | "card" | "bank" | "flutterwave") => {
    const nextManual      = id === "manual"      ? !manualEnabled      : manualEnabled
    const nextCard        = id === "card"        ? !cardEnabled        : cardEnabled
    const nextBank        = id === "bank"         ? !bankEnabled        : bankEnabled
    const nextFlutterwave = id === "flutterwave" ? !flutterwaveEnabled : flutterwaveEnabled
    // At least one method must stay enabled — checkout has nowhere to send
    // buyers otherwise. Block the toggle instead of silently leaving all off.
    if (!nextManual && !nextCard && !nextBank && !nextFlutterwave) return
    onChange({
      manualPaymentEnabled: nextManual,
      paystackCardEnabled:  nextCard,
      paystackBankEnabled:  nextBank,
      // Legacy combined flag — derived so any old code still reading it works.
      paystackPaymentEnabled: nextCard || nextBank,
      flutterwavePaymentEnabled: nextFlutterwave,
    })
  }

  return (
    <div className="space-y-2">
      {options.map(opt => (
        <label
          key={opt.id}
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            opt.checked
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted/40"
          }`}
        >
          <input
            type="checkbox"
            checked={opt.checked}
            onChange={() => toggle(opt.id)}
            className="mt-0.5 accent-primary"
          />
          <div>
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="text-xs text-muted-foreground">{opt.desc}</p>
          </div>
        </label>
      ))}
      {enabledCount >= 2 && (
        <p className="text-xs text-muted-foreground px-1">
          {enabledCount} methods are on — buyers will choose their preferred payment method at checkout.
        </p>
      )}
      {enabledCount === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          Only one method is on — checkout will skip the picker and use it automatically.
        </p>
      )}
    </div>
  )
}

// Third-party seller (marketplace/escrow) checkout — Buy Now / Cart checkout
// when the seller isn't Zamorax Enterprises Direct. Fully independent from
// <ProviderPicker> above: these three toggles never derive from or combine
// with the global ones. Paystack here is a single switch covering both
// card + bank channels together (unlike the global picker, which splits
// them) since third-party checkout doesn't need that granularity.
function MarketplaceProviderPicker({
  manualEnabled,
  paystackEnabled,
  flutterwaveEnabled,
  onChange,
}: {
  manualEnabled: boolean
  paystackEnabled: boolean
  flutterwaveEnabled: boolean
  onChange: (next: {
    manualEnabledForMarketplace: boolean
    paystackEnabledForMarketplace: boolean
    flutterwaveEnabledForMarketplace: boolean
  }) => void
}) {
  const options: { id: "manual" | "paystack" | "flutterwave"; label: string; desc: string; checked: boolean }[] = [
    { id: "manual",      label: "Bank Transfer (Manual)", desc: "Buyer transfers manually, then uploads proof for admin to confirm.",                  checked: manualEnabled },
    { id: "paystack",    label: "Paystack (Card + Bank)",  desc: "Instant — card, bank transfer, USSD, or direct debit via Paystack.",                  checked: paystackEnabled },
    { id: "flutterwave", label: "Flutterwave",             desc: "Instant — card, bank transfer, or USSD. Funds held in escrow until delivery.",        checked: flutterwaveEnabled },
  ]

  const enabledCount = [manualEnabled, paystackEnabled, flutterwaveEnabled].filter(Boolean).length

  const toggle = (id: "manual" | "paystack" | "flutterwave") => {
    const nextManual      = id === "manual"      ? !manualEnabled      : manualEnabled
    const nextPaystack     = id === "paystack"    ? !paystackEnabled    : paystackEnabled
    const nextFlutterwave = id === "flutterwave" ? !flutterwaveEnabled : flutterwaveEnabled
    if (!nextManual && !nextPaystack && !nextFlutterwave) return
    onChange({
      manualEnabledForMarketplace: nextManual,
      paystackEnabledForMarketplace: nextPaystack,
      flutterwaveEnabledForMarketplace: nextFlutterwave,
    })
  }

  return (
    <div className="space-y-2">
      {options.map(opt => (
        <label
          key={opt.id}
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            opt.checked
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted/40"
          }`}
        >
          <input
            type="checkbox"
            checked={opt.checked}
            onChange={() => toggle(opt.id)}
            className="mt-0.5 accent-primary"
          />
          <div>
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="text-xs text-muted-foreground">{opt.desc}</p>
          </div>
        </label>
      ))}
      {enabledCount >= 2 && (
        <p className="text-xs text-muted-foreground px-1">
          {enabledCount} methods are on — third-party buyers will choose their preferred payment method at checkout.
        </p>
      )}
      {enabledCount === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          Only one method is on for third-party checkout — it'll be used automatically, no picker shown.
        </p>
      )}
    </div>
  )
}

// ─── How It Works icon options ────────────────────────────────────────────────

const HOW_IT_WORKS_ICONS = [
  "Tag", "ShieldCheck", "BadgeCheck", "Zap", "Truck", "Star",
  "Package", "Search", "CreditCard", "Lock", "Handshake", "RefreshCcw",
  "MapPin", "Bell", "Heart", "Gift", "Camera", "Globe",
]

function StepEditor({
  stepNum, icon, title, desc,
  onIcon, onTitle, onDesc,
}: {
  stepNum: number
  icon: string; title: string; desc: string
  onIcon: (v: string) => void
  onTitle: (v: string) => void
  onDesc: (v: string) => void
}) {
  return (
    <div className="rounded-xl border border-border/60 p-4 space-y-3 bg-muted/20">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Step {stepNum}</p>

      {/* Icon picker */}
      <div className="space-y-1">
        <Label className="text-xs">Icon</Label>
        <div className="flex flex-wrap gap-1.5">
          {HOW_IT_WORKS_ICONS.map(name => (
            <button
              key={name}
              type="button"
              onClick={() => onIcon(name)}
              className={cn(
                "px-2 py-1 rounded-lg border text-xs font-medium transition-colors",
                icon === name
                  ? "bg-primary text-white border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Title</Label>
        <Input
          value={title}
          onChange={e => onTitle(e.target.value)}
          placeholder={`Step ${stepNum} title`}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Input
          value={desc}
          onChange={e => onDesc(e.target.value)}
          placeholder={`Step ${stepNum} description`}
          className="h-8 text-sm"
        />
      </div>
    </div>
  )
}

// ─── ZLA State-to-State Matrix Editor ────────────────────────────────────────
// Admin edits delivery prices per route (Origin → Destination).
// Only routes with a non-zero price are stored — blank = not configured.

const NIGERIAN_STATES_LIST = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe",
  "Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara",
  "Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau",
  "Rivers","Sokoto","Taraba","Yobe","Zamfara",
]

function ZlaMatrixEditor({
  matrix,
  onChange,
}: {
  matrix: Record<string, number>
  onChange: (v: Record<string, number>) => void
}) {
  const [from, setFrom] = useState("")
  const [to,   setTo]   = useState("")
  const [price, setPrice] = useState("")

  // Entries that have been set (non-zero)
  const entries = Object.entries(matrix).filter(([, v]) => v > 0)

  const handleAdd = () => {
    if (!from || !to || !price) return
    const key = `${from}-${to}`
    onChange({ ...matrix, [key]: Math.round(parseFloat(price) * 100) })
    setFrom(""); setTo(""); setPrice("")
  }

  const handleRemove = (key: string) => {
    const next = { ...matrix }
    delete next[key]
    onChange(next)
  }

  const handleEdit = (key: string, nairaValue: string) => {
    onChange({ ...matrix, [key]: Math.round(parseFloat(nairaValue || "0") * 100) })
  }

  return (
    <div className="space-y-4">
      {/* Add new route */}
      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">From (Seller State)</Label>
          <select
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Select…</option>
            {NIGERIAN_STATES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To (Buyer State)</Label>
          <select
            value={to}
            onChange={e => setTo(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Select…</option>
            {NIGERIAN_STATES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Price (₦)</Label>
          <Input
            type="number"
            placeholder="e.g. 3500"
            value={price}
            onChange={e => setPrice(e.target.value)}
            className="w-28"
            min={0}
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleAdd}
          disabled={!from || !to || !price}
          className="mt-auto"
        >
          Add
        </Button>
      </div>

      {/* Existing routes */}
      {entries.length === 0 ? (
        <InfoBox color="amber">
          No routes set yet. Add origin → destination routes above. Buyers on unconfigured routes will see ₦0 delivery fee — fix before going live.
        </InfoBox>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-0 text-xs font-semibold text-muted-foreground bg-muted/40 px-3 py-2">
            <span>From</span><span>To</span><span className="text-right pr-3">Price (₦)</span><span />
          </div>
          <div className="divide-y max-h-72 overflow-y-auto">
            {entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, kobo]) => {
              const [origin, dest] = key.split("-")
              return (
                <div key={key} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center px-3 py-1.5 text-sm">
                  <span className="font-medium truncate">{origin}</span>
                  <span className="text-muted-foreground truncate">{dest}</span>
                  <Input
                    type="number"
                    value={kobo / 100}
                    onChange={e => handleEdit(key, e.target.value)}
                    className="w-24 h-7 text-right text-xs"
                    min={0}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemove(key)}
                    className="text-destructive text-xs hover:underline px-1"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
          <div className="bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {entries.length} route{entries.length !== 1 ? "s" : ""} configured
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const { toast } = useToast()
  const { user, setUser } = useAuthStore()
  const [s, setS] = useState<Settings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // On mount: refresh the server-side httpOnly cookies so Save All never
  // hits an expired sb-access-token. The /api/auth/refresh route uses the
  // sb-refresh-token cookie (7-day lifetime) to reissue all auth cookies.
  useEffect(() => {
    const syncSession = async () => {
      try {
        // Refresh server-side cookies first (most important for Save to work)
        const refreshRes = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
        })
        if (refreshRes.ok) {
          const { uid } = await refreshRes.json()
          if (uid && user?.uid !== uid) {
            const profileRes = await fetch(`/api/db/users/${uid}`)
            if (profileRes.ok) {
              const profile = await profileRes.json()
              if (profile) setUser(profile)
            }
          }
          return
        }
      } catch { /* fall through to client-side refresh */ }

      // Firebase tokens are managed by the Firebase SDK — no fallback needed
    }
    syncSession()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    adminFetch("/api/admin/settings")
      .then(r => r.json())
      .then(json => { if (json?.settings) setS(prev => ({ ...prev, ...json.settings })) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const num  = (key: NumKey)  => (v: number)  => setS(p => ({ ...p, [key]: v }))
  const bool = (key: BoolKey) => ()           => setS(p => ({ ...p, [key]: !p[key] }))
  const str  = (key: keyof Settings) => (v: string) => setS(p => ({ ...p, [key]: v }))
  const kobo = (key: NumKey)  => (v: number)  => setS(p => ({ ...p, [key]: v }))

  const save = async () => {
    setSaving(true)
    try {
      // adminFetch() handles session reading + auth headers automatically.
      const res = await adminFetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(
        (json?.error || `Save failed (HTTP ${res.status})`) +
        (json?.debug ? ` | DEBUG: ${JSON.stringify(json.debug)}` : "")
      )
      invalidateSettingsCache()
      invalidatePlatformCache()
      toast({ title: "✅ Settings saved", description: "All changes applied instantly across the platform." })
    } catch (err: any) {
      toast({ title: "Error saving settings", description: err.message, variant: "destructive" })
    } finally { setSaving(false) }
  }

  if (loading) return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )

  return (
    <div className="container py-8 max-w-2xl space-y-5 pb-32">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Platform Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            All changes apply instantly — no code deployment needed.
          </p>
        </div>
        <Button onClick={save} disabled={saving} className="bg-primary text-white">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-2" />Save All</>}
        </Button>
      </div>

      {/* ── Payment Provider ─────────────────────────────────────────────────── */}
      <SectionCard icon={CreditCard} title="Payment Provider" accent>
        <p className="text-xs text-muted-foreground">
          Switch active payment method instantly. Bank details (Manual) and API keys (Paystack/Flutterwave) are configured separately.
        </p>
        <ProviderPicker
          manualEnabled={s.manualPaymentEnabled}
          cardEnabled={s.paystackCardEnabled}
          bankEnabled={s.paystackBankEnabled}
          flutterwaveEnabled={s.flutterwavePaymentEnabled}
          onChange={next => setS(p => ({ ...p, ...next }))}
        />
        {s.manualPaymentEnabled && (
          <InfoBox color="amber">
            ⚠️ Manual mode is on — you must confirm each manual payment in the Payments dashboard before releasing escrow.
          </InfoBox>
        )}
        {s.flutterwavePaymentEnabled && (
          <InfoBox color="blue">
            🔒 Flutterwave is on — order payments are collected with the escrow flag, so Flutterwave holds the funds (not the platform) until you release them at delivery confirmation.
          </InfoBox>
        )}
      </SectionCard>

      {/* ── Third-Party Seller Checkout ──────────────────────────────────────── */}
      <SectionCard icon={CreditCard} title="Third-Party Seller Checkout" accent>
        <p className="text-xs text-muted-foreground">
          Independent from Payment Provider above — controls what buyers see at checkout for
          third-party seller listings only (Buy Now / Cart, when the seller isn't Zamorax
          Enterprises Direct). Zamorax Enterprises Direct purchases, subscriptions, boosts, and
          ad boosts always use the Payment Provider settings above and ignore this section.
        </p>
        <MarketplaceProviderPicker
          manualEnabled={s.manualEnabledForMarketplace}
          paystackEnabled={s.paystackEnabledForMarketplace}
          flutterwaveEnabled={s.flutterwaveEnabledForMarketplace}
          onChange={next => setS(p => ({ ...p, ...next }))}
        />
        {s.flutterwaveEnabledForMarketplace && (
          <InfoBox color="blue">
            🔒 Flutterwave is on for third-party checkout — those order payments are collected with the escrow flag, so Flutterwave holds the funds until you release them at delivery confirmation.
          </InfoBox>
        )}
      </SectionCard>

      {/* ── Payout Method (seller withdrawals) ──────────────────────────────── */}
      <SectionCard icon={Wallet} title="Seller Payout Method" accent>
        <p className="text-xs text-muted-foreground">
          Controls how <strong>seller withdrawals</strong> get paid out — separate from how buyers pay in above.
        </p>
        <div className="space-y-2">
          {([
            { id: "manual" as const,      label: "Manual",      desc: "You review each withdrawal, send the transfer yourself, then confirm with proof of payment." },
            { id: "paystack" as const,    label: "Paystack",    desc: "Approving a withdrawal immediately sends a real bank transfer via Paystack." },
            { id: "flutterwave" as const, label: "Flutterwave", desc: "Approving a withdrawal sends a real bank transfer via Flutterwave (or releases held escrow directly to the seller when tied to a specific order)." },
          ]).map(opt => (
            <label
              key={opt.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                s.payoutMethod === opt.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
              }`}
            >
              <input
                type="radio"
                name="payoutMethod"
                checked={s.payoutMethod === opt.id}
                onChange={() => setS(p => ({ ...p, payoutMethod: opt.id }))}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
        {s.payoutMethod === "paystack" && (
          <InfoBox color="green">
            ⚡ Paystack payout is on — withdrawals are paid automatically the moment you approve them. Make sure your Paystack balance is funded and live transfers are unlocked (business KYC completed), or approvals will fail.
          </InfoBox>
        )}
        {s.payoutMethod === "flutterwave" && (
          <InfoBox color="green">
            ⚡ Flutterwave payout is on — withdrawals are paid automatically the moment you approve them. Make sure your Flutterwave balance is funded and live transfers are unlocked (business KYC completed), or approvals will fail.
          </InfoBox>
        )}
        {s.payoutMethod === "manual" && (
          <InfoBox color="amber">
            🏦 Manual payout is on — you review each withdrawal, send the bank transfer yourself, then confirm with a reference and proof of payment in the Withdrawals dashboard.
          </InfoBox>
        )}
      </SectionCard>

      {/* ── Platform Bank Account ────────────────────────────────────────────── */}
      <BankDetailsSettings />

      {/* ── USD → NGN Exchange Rate ──────────────────────────────────────────── */}
      <SectionCard icon={DollarSign} title="USD → NGN Exchange Rate" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Used to show NGN equivalent for USD-priced items. Update when the rate changes significantly.
        </p>
        <NumField
          label="Exchange rate"
          desc="How many Naira per 1 US Dollar"
          value={s.usdToNgnRate}
          onChange={num("usdToNgnRate")}
          prefix="$1 ="
          suffix="NGN"
          step={10}
          min={100}
        />
        <InfoBox color="blue">
          Example: $10 plan → ₦{(10 * s.usdToNgnRate).toLocaleString()} shown to Nigerian users
        </InfoBox>
      </SectionCard>

      {/* ── Commission & Fees → managed in /admin/fees ───────────────────────── */}
      <Card className="border-primary/20">
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Percent className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold">Commission & Fees</p>
              <p className="text-xs text-muted-foreground">
                Seller commission, arbitration pool, withdrawal fee, buyer convenience fee
              </p>
            </div>
          </div>
          <a
            href="/admin/fees"
            className="shrink-0 text-xs font-medium text-primary border border-primary/30 rounded-md px-3 py-1.5 hover:bg-primary/5 transition-colors"
          >
            Manage Fees →
          </a>
        </CardContent>
      </Card>


      {/* ── Email Settings → managed in /admin/email ─────────────────────────── */}
      <Card className="border-primary/20">
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold">Email Settings</p>
              <p className="text-xs text-muted-foreground">
                Resend API key, branded email templates, per-email toggles, test send
              </p>
            </div>
          </div>
          <a
            href="/admin/email"
            className="shrink-0 text-xs font-medium text-primary border border-primary/30 rounded-md px-3 py-1.5 hover:bg-primary/5 transition-colors"
          >
            Manage Emails →
          </a>
        </CardContent>
      </Card>
      {/* ── Listing & Media Controls ──────────────────────────────────────────── */}
      <SectionCard icon={ListChecks} title="Listing & Media Controls" defaultOpen={false}>

        {/* — Listing gate — */}
        <ToggleRow
          label="Allow new listings"
          desc="Turn off to freeze all new listing creation (sellers can still manage existing ones)"
          checked={s.listingCreationEnabled}
          onChange={bool("listingCreationEnabled")}
        />
        {!s.listingCreationEnabled && (
          <InfoBox color="amber">⚠️ New listing creation is paused. Sellers will see a message when they try to post.</InfoBox>
        )}

        <Separator />

        {/* — Image controls — */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Image className="h-3.5 w-3.5" /> Photo Uploads
          </p>
          <KoboField
            label="Minimum listing price"
            desc="Listings below this price will be rejected at creation"
            value={s.minListingPriceKobo}
            onChange={kobo("minListingPriceKobo")}
          />
          <NumField
            label="Max photos per listing"
            desc="Sellers can upload up to this many photos. Step4Media enforces this live — no code push needed."
            value={s.maxImagesPerListing}
            onChange={num("maxImagesPerListing")}
            suffix="photos"
            min={1}
            max={30}
          />
          <InfoBox color="blue">
            Sellers will see a live counter: <strong>"X / {s.maxImagesPerListing} photos"</strong> as they upload. The Add Photo button hides automatically at the limit.
          </InfoBox>
        </div>

        <Separator />

        {/* — Video controls — */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5" /> Video Uploads
          </p>
          <ToggleRow
            label="Enable video uploads"
            desc="Allow sellers to attach a short verification video to their listing (replaces the Coming Soon banner in Step4Media)"
            checked={s.videoUploadEnabled}
            onChange={bool("videoUploadEnabled")}
          />

          {s.videoUploadEnabled ? (
            <>
              <NumField
                label="Max video file size"
                desc="Videos larger than this are rejected before upload starts"
                value={s.maxVideoSizeMb}
                onChange={num("maxVideoSizeMb")}
                suffix="MB"
                min={5}
                max={500}
              />
              <NumField
                label="Max video duration"
                desc="Informational — shown to sellers in the upload hint. Not technically enforced by storage."
                value={s.videoMaxDurationSec}
                onChange={num("videoMaxDurationSec")}
                suffix="seconds"
                min={10}
                max={600}
              />

              {/* Allowed formats */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Allowed video formats</Label>
                <p className="text-xs text-muted-foreground">
                  Check which MIME types sellers can upload. Unchecked types are rejected before upload.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    { mime: "video/mp4",       label: "MP4" },
                    { mime: "video/quicktime",  label: "MOV" },
                    { mime: "video/webm",       label: "WebM" },
                    { mime: "video/x-msvideo",  label: "AVI" },
                    { mime: "video/mpeg",       label: "MPEG" },
                  ].map(({ mime, label }) => {
                    const checked = s.allowedVideoTypes.includes(mime)
                    return (
                      <button
                        key={mime}
                        type="button"
                        onClick={() => setS(p => ({
                          ...p,
                          allowedVideoTypes: checked
                            ? p.allowedVideoTypes.filter(t => t !== mime)
                            : [...p.allowedVideoTypes, mime]
                        }))}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                          checked
                            ? "bg-primary text-white border-primary"
                            : "bg-background text-muted-foreground border-border hover:border-primary"
                        }`}
                      >
                        {checked ? "✓ " : ""}{label}
                      </button>
                    )
                  })}
                </div>
                {s.allowedVideoTypes.length === 0 && (
                  <InfoBox color="amber">⚠️ No formats selected — all video uploads will be rejected.</InfoBox>
                )}
              </div>

              {/* Which plan tier requires a video */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Video requirement by plan</Label>
                <p className="text-xs text-muted-foreground">
                  Make verification video mandatory for certain seller plans. Buyers see a "Verified Video" badge when a video is attached.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  {([
                    { val: "none",    label: "Optional for everyone",       desc: "Video is never required — always optional" },
                    { val: "starter", label: "Required for Starter & Pro",  desc: "Free sellers skip it; Starter and Pro must attach one" },
                    { val: "pro",     label: "Required for Pro only",       desc: "Only Pro sellers are required to upload a video" },
                  ] as const).map(opt => (
                    <label
                      key={opt.val}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        s.videoRequiredForPlan === opt.val
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="videoRequiredForPlan"
                        value={opt.val}
                        checked={s.videoRequiredForPlan === opt.val}
                        onChange={() => setS(p => ({ ...p, videoRequiredForPlan: opt.val }))}
                        className="mt-0.5 accent-primary"
                      />
                      <div>
                        <p className="text-sm font-medium">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <InfoBox color="green">
                Sellers see: max {s.maxVideoSizeMb} MB · max ~{s.videoMaxDurationSec}s · {
                  s.allowedVideoTypes.length > 0
                    ? s.allowedVideoTypes.map(t => t.split("/")[1].toUpperCase()).join(", ")
                    : "no formats allowed"
                }
              </InfoBox>
            </>
          ) : (
            <InfoBox color="amber">
              Video upload is <strong>off</strong>. Sellers see a "Coming Soon" banner in Step 4 of the listing form. Turn on above to activate the full video uploader.
            </InfoBox>
          )}
        </div>
      </SectionCard>

      {/* ── Identity Verification Controls ──────────────────────────────────── */}
      <SectionCard icon={Fingerprint} title="Identity Verification Controls" defaultOpen={false} accent>
        <p className="text-xs text-muted-foreground">
          Controls NIN, BVN, and selfie verification gates, submission queues, and review SLAs.
        </p>

        {/* — Gates — */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Verification Gates</p>
          <ToggleRow
            label="Require NIN before listing"
            desc="Sellers must complete NIN verification before any listing goes live"
            checked={s.requireNinBvnBeforeListing}
            onChange={bool("requireNinBvnBeforeListing")}
          />
          <ToggleRow
            label="Require NIN before placing orders"
            desc="Buyers must be NIN-verified before they can order"
            checked={s.requireNinBeforeOrders}
            onChange={bool("requireNinBeforeOrders")}
          />
          <ToggleRow
            label="Require NIN before accessing chat"
            desc="Users must be NIN-verified to open a chat thread"
            checked={s.requireNinBeforeChat}
            onChange={bool("requireNinBeforeChat")}
          />
          <ToggleRow
            label="Require email verification"
            desc="Users must verify their email before accessing buyer/seller features"
            checked={s.emailVerificationRequired}
            onChange={bool("emailVerificationRequired")}
          />
        </div>

        <Separator />

        {/* — Submission queues — */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Submission Queues</p>
          <ToggleRow
            label="Accept new NIN submissions"
            desc="Pause the NIN queue without removing the gate (e.g. during review backlog)"
            checked={s.acceptNewNinSubmissions}
            onChange={bool("acceptNewNinSubmissions")}
          />
          {!s.acceptNewNinSubmissions && (
            <InfoBox color="amber">⚠️ NIN submissions paused. Users will see a "temporarily unavailable" message.</InfoBox>
          )}
          <ToggleRow
            label="Accept new BVN/Pro submissions"
            desc="Pause the Pro verification queue (proVerificationRequests) separately from NIN"
            checked={s.acceptNewBvnSubmissions}
            onChange={bool("acceptNewBvnSubmissions")}
          />
          {!s.acceptNewBvnSubmissions && (
            <InfoBox color="amber">⚠️ BVN/Pro submissions paused. Users cannot upgrade to Pro verification.</InfoBox>
          )}
          <ToggleRow
            label="Require selfie for Starter/Pro verification"
            desc="When off, BVN alone is enough — no selfie upload required"
            checked={s.requireSelfieForVerification}
            onChange={bool("requireSelfieForVerification")}
          />
          <NumField
            label="Max selfie file size"
            desc="Reject selfie uploads above this size"
            value={s.maxSelfieSizeMb}
            onChange={num("maxSelfieSizeMb")}
            suffix="MB"
            min={1}
            max={20}
          />
        </div>

        <Separator />

        {/* — Review & auto-approve — */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Review Process</p>
          <ToggleRow
            label="Auto-approve verifications"
            desc="Skip manual review — verifications are approved automatically on submission"
            checked={s.autoApproveVerifications}
            onChange={bool("autoApproveVerifications")}
          />
          {s.autoApproveVerifications && (
            <InfoBox color="amber">⚠️ Auto-approve is ON. All submitted verifications will pass without manual review.</InfoBox>
          )}
          <NumField
            label="Review SLA"
            desc="Target review time shown to users while their submission is pending"
            value={s.verificationReviewSlaHours}
            onChange={num("verificationReviewSlaHours")}
            suffix="hrs"
            min={1}
          />
          <StrField
            label="Pending review message"
            desc="Shown to users after submitting NIN/BVN (replaces hardcoded '24hrs' text in verify page, upgrade form, and VerificationGate)"
            value={s.verificationReviewMessage}
            onChange={str("verificationReviewMessage")}
            placeholder="Your submission is under review. Usually approved within 24 hours."
          />
        </div>
      </SectionCard>

      {/* ── Announcement Bar ─────────────────────────────────────────────────── */}
      <SectionCard icon={Megaphone} title="Announcement Bar" defaultOpen={false}>
        <ToggleRow
          label="Show announcement bar"
          desc="Displays a full-width banner at the top of every public page"
          checked={s.announcementBarEnabled}
          onChange={bool("announcementBarEnabled")}
        />
        {s.announcementBarEnabled && (
          <>
            <StrField
              label="Message"
              desc="Keep it short — shown on mobile too"
              value={s.announcementBarMessage}
              onChange={str("announcementBarMessage")}
              placeholder="e.g. 🎉 Zero fees on all sales this weekend only!"
            />
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Bar color</Label>
              <div className="flex gap-2 flex-wrap">
                {(["info", "warning", "success", "danger"] as const).map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setS(p => ({ ...p, announcementBarColor: color }))}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                      s.announcementBarColor === color ? "ring-2 ring-offset-1 ring-primary" : "opacity-60"
                    } ${
                      color === "info"    ? "bg-blue-100 text-blue-700 border-blue-200" :
                      color === "warning" ? "bg-amber-100 text-amber-700 border-amber-200" :
                      color === "success" ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                                           "bg-red-100 text-red-700 border-red-200"
                    }`}
                  >
                    {color.charAt(0).toUpperCase() + color.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {s.announcementBarMessage && (
              <div className={`rounded-lg px-3 py-2 text-xs font-medium text-center ${
                s.announcementBarColor === "info"    ? "bg-blue-100 text-blue-800" :
                s.announcementBarColor === "warning" ? "bg-amber-100 text-amber-800" :
                s.announcementBarColor === "success" ? "bg-emerald-100 text-emerald-800" :
                                                       "bg-red-100 text-red-800"
              }`}>
                Preview: {s.announcementBarMessage}
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* ── Homepage Sections ────────────────────────────────────────────────── */}
      <SectionCard icon={LayoutDashboard} title="Homepage Sections" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">Toggle which sections appear on the public homepage.</p>
        <ToggleRow
          label="Hero banner"
          desc="The main banner/carousel at the top of the homepage"
          checked={s.homepageHeroBannerEnabled}
          onChange={bool("homepageHeroBannerEnabled")}
        />
        <ToggleRow
          label="Featured listings section"
          desc="The curated listings row below the hero"
          checked={s.homepageFeaturedListingsEnabled}
          onChange={bool("homepageFeaturedListingsEnabled")}
        />
        <ToggleRow
          label="Zamorax Enterprises Direct section"
          desc="Official Zamorax Enterprises listings (bulk-sourced, locally warehoused stock)"
          checked={s.homepageZamoraxDirectEnabled}
          onChange={bool("homepageZamoraxDirectEnabled")}
        />
        {s.homepageZamoraxDirectEnabled && (
          <NumField
            label="Zamorax Enterprises Direct listings shown on homepage"
            desc='How many to show before the "See all" link — rest are on the full Zamorax Enterprises Direct page'
            value={s.homepageZamoraxDirectCount}
            onChange={num("homepageZamoraxDirectCount")}
            min={1}
            max={24}
          />
        )}
        <ToggleRow
          label="Rentals section"
          desc="Rental listings carousel, placed after Featured Listings"
          checked={s.homepageRentalsEnabled}
          onChange={bool("homepageRentalsEnabled")}
        />
        {s.homepageRentalsEnabled && (
          <NumField
            label="Rental listings shown on homepage"
            desc='How many to show before the "See more" link — rest are on the full Rentals page'
            value={s.homepageRentalsCount}
            onChange={num("homepageRentalsCount")}
            min={1}
            max={24}
          />
        )}
        <ToggleRow
          label="Blog preview section"
          desc="Shows recent blog posts on the homepage"
          checked={s.blogEnabled}
          onChange={bool("blogEnabled")}
        />

        <Separator />

        {/* ── Platform Stats bar ── */}
        <ToggleRow
          label="Platform stats bar"
          desc="Shows trust numbers (listings, sellers, buyers, transactions) below the hero"
          checked={s.platformStatsEnabled}
          onChange={bool("platformStatsEnabled")}
        />
        {s.platformStatsEnabled && (
          <div className="grid grid-cols-2 gap-3 pl-1">
            <StrField
              label="Active listings"
              value={s.platformStatListings}
              onChange={str("platformStatListings")}
              placeholder="50,000+"
            />
            <StrField
              label="Verified sellers"
              value={s.platformStatSellers}
              onChange={str("platformStatSellers")}
              placeholder="12,000+"
            />
            <StrField
              label="Happy buyers"
              value={s.platformStatBuyers}
              onChange={str("platformStatBuyers")}
              placeholder="80,000+"
            />
            <StrField
              label="Safe transactions"
              value={s.platformStatTransactions}
              onChange={str("platformStatTransactions")}
              placeholder="₦2B+"
            />
          </div>
        )}

        <Separator />

        {/* ── How It Works ── */}
        <ToggleRow
          label="How It Works section"
          desc="3-step explainer shown between Categories and Flash Deals"
          checked={s.howItWorksEnabled}
          onChange={bool("howItWorksEnabled")}
        />
        {s.howItWorksEnabled && (
          <div className="space-y-3 pl-1">
            <StrField
              label="Section title"
              value={s.howItWorksTitle}
              onChange={str("howItWorksTitle")}
              placeholder="How Zamorax Works"
            />

            <NumField
              label="Number of steps shown"
              desc="Choose 2, 3, or 4 steps"
              value={s.howItWorksStepCount}
              onChange={v => setS(p => ({ ...p, howItWorksStepCount: Math.min(4, Math.max(2, v)) }))}
              min={2}
              max={4}
            />

            <StepEditor
              stepNum={1}
              icon={s.howItWorksStep1Icon}
              title={s.howItWorksStep1Title}
              desc={s.howItWorksStep1Desc}
              onIcon={str("howItWorksStep1Icon")}
              onTitle={str("howItWorksStep1Title")}
              onDesc={str("howItWorksStep1Desc")}
            />
            <StepEditor
              stepNum={2}
              icon={s.howItWorksStep2Icon}
              title={s.howItWorksStep2Title}
              desc={s.howItWorksStep2Desc}
              onIcon={str("howItWorksStep2Icon")}
              onTitle={str("howItWorksStep2Title")}
              onDesc={str("howItWorksStep2Desc")}
            />
            {s.howItWorksStepCount >= 3 && (
              <StepEditor
                stepNum={3}
                icon={s.howItWorksStep3Icon}
                title={s.howItWorksStep3Title}
                desc={s.howItWorksStep3Desc}
                onIcon={str("howItWorksStep3Icon")}
                onTitle={str("howItWorksStep3Title")}
                onDesc={str("howItWorksStep3Desc")}
              />
            )}
            {s.howItWorksStepCount >= 4 && (
              <StepEditor
                stepNum={4}
                icon={s.howItWorksStep4Icon}
                title={s.howItWorksStep4Title}
                desc={s.howItWorksStep4Desc}
                onIcon={str("howItWorksStep4Icon")}
                onTitle={str("howItWorksStep4Title")}
                onDesc={str("howItWorksStep4Desc")}
              />
            )}
          </div>
        )}
      </SectionCard>


      {/* ── Promo / Coupon Codes ─────────────────────────────────────────────── */}
      <SectionCard icon={Tag} title="Promo & Coupon Codes" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the /api/promo/validate endpoint and the PromoCodeInput component at checkout.
        </p>
        <ToggleRow
          label="Allow promo code redemption"
          desc="Turn off to disable all promo codes platform-wide without deleting them"
          checked={s.promoEnabled}
          onChange={bool("promoEnabled")}
        />
        {!s.promoEnabled && (
          <InfoBox color="amber">⚠️ Promo codes disabled. All codes will be rejected at checkout.</InfoBox>
        )}
        <NumField
          label="Max discount a promo code can apply"
          desc="Codes with a higher discount than this will be capped at this value"
          value={s.maxPromoDiscountPercent}
          onChange={num("maxPromoDiscountPercent")}
          suffix="%"
          min={1}
          max={100}
        />
      </SectionCard>

      {/* ── AI Chatbot ───────────────────────────────────────────────────────── */}
      <SectionCard icon={Bot} title="AI Chatbot Widget" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the floating ChatbotWidget that appears on public pages and listing detail pages.
        </p>
        <ToggleRow
          label="AI chatbot enabled"
          desc="Show the floating Zamorax AI chat bubble on public pages"
          checked={s.chatbotEnabled}
          onChange={bool("chatbotEnabled")}
        />
        {s.chatbotEnabled && (
          <StrField
            label="Chatbot greeting message"
            desc="First message the bot sends when a user opens the widget (no listing context)"
            value={s.chatbotGreeting}
            onChange={str("chatbotGreeting")}
            placeholder="Hi! I'm Zamorax AI. How can I help you today?"
          />
        )}
      </SectionCard>

      {/* ── Image Watermark ──────────────────────────────────────────────────── */}
      <SectionCard icon={Image} title="Image Watermark" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the "zamorax" overlay rendered by WatermarkedImage on all listing photos.
        </p>
        <ToggleRow
          label="Show watermark on listing images"
          desc="Overlay the Zamorax branding on all listing photos"
          checked={s.imageWatermarkEnabled}
          onChange={bool("imageWatermarkEnabled")}
        />
        {!s.imageWatermarkEnabled && (
          <InfoBox color="amber">⚠️ Watermark off. Listing images will show without Zamorax branding.</InfoBox>
        )}
      </SectionCard>

      {/* ── Personalised Feed ────────────────────────────────────────────────── */}
      <SectionCard icon={TrendingUp} title="Personalised Feed" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls whether the homepage PersonalisedFeed reads from browseHistory and shows AI-recommended listings. When off, it falls back to newest listings.
        </p>
        <ToggleRow
          label="Personalised feed enabled"
          desc="Show AI-recommended listings based on each user's browsing history"
          checked={s.personalisedFeedEnabled}
          onChange={bool("personalisedFeedEnabled")}
        />
      </SectionCard>

      {/* ── Offer / Counter-offer System ─────────────────────────────────────── */}
      <SectionCard icon={MessageCircle} title="Offer System" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the MakeOfferModal and SellerOffersInbox across the platform.
        </p>
        <ToggleRow
          label="Allow buyers to make offers"
          desc="Show the 'Make Offer' button on listing detail pages"
          checked={s.offersEnabled}
          onChange={bool("offersEnabled")}
        />
        {s.offersEnabled && (
          <ToggleRow
            label="Enable MakeOfferModal (listing page)"
            desc="Show the Make an Offer button on individual listing pages. Disable to hide it without turning off the whole offer system."
            checked={s.makeOfferEnabled ?? true}
            onChange={bool("makeOfferEnabled")}
          />
        )}
        {s.offersEnabled && (
          <NumField
            label="Minimum offer (% of listing price)"
            desc="Offers below this percentage of the asking price will be rejected automatically"
            value={s.minOfferPercent}
            onChange={num("minOfferPercent")}
            suffix="% of price"
            min={1}
            max={100}
          />
        )}
        {!s.offersEnabled && (
          <InfoBox color="amber">⚠️ Offer system disabled. Buyers can only purchase at listed price.</InfoBox>
        )}
      </SectionCard>

      {/* ── Reviews & Ratings ────────────────────────────────────────────────── */}
      <SectionCard icon={Star} title="Reviews & Ratings" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the ReviewSystem and SellerReviews components.
        </p>
        <ToggleRow
          label="Reviews & ratings enabled"
          desc="Allow buyers to post reviews on completed orders"
          checked={s.reviewsEnabled}
          onChange={bool("reviewsEnabled")}
        />
        {s.reviewsEnabled && (
          <NumField
            label="Min days after order completion before review"
            desc="Prevents instant fake reviews — buyer must wait this long after order is marked complete"
            value={s.reviewMinDaysAfterOrder}
            onChange={num("reviewMinDaysAfterOrder")}
            suffix="days"
            min={0}
            max={30}
          />
        )}
      </SectionCard>

      {/* ── Return Guarantee ─────────────────────────────────────────────────── */}
      <SectionCard icon={RotateCcw} title="Return Guarantee" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the ReturnGuaranteeBadge displayed on listing pages and the return window buyers have.
          The "3-Day Returns" text in the badge is currently hardcoded — connect returnWindowDays to it.
        </p>
        <NumField
          label="Return window"
          desc="How many days after delivery a buyer can request a return"
          value={s.returnWindowDays}
          onChange={num("returnWindowDays")}
          suffix="days"
          min={1}
          max={30}
        />
        <ToggleRow
          label="Show return guarantee badge on listings"
          desc="Display the 'N-Day Returns' badge on listing detail pages"
          checked={s.returnGuaranteeBadgeVisible}
          onChange={bool("returnGuaranteeBadgeVisible")}
        />
        <InfoBox color="blue">
          Badge will display: <strong>"{s.returnWindowDays}-Day Returns"</strong>
        </InfoBox>
      </SectionCard>

      {/* ── Back-in-Stock Alerts ─────────────────────────────────────────────── */}
      <SectionCard icon={Bell} title="Back-in-Stock Alerts" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the BackInStockAlert component on sold-out/paused listings.
        </p>
        <ToggleRow
          label="Back-in-stock alerts enabled"
          desc="Allow buyers to subscribe to notifications when a sold-out listing becomes available"
          checked={s.backInStockAlertsEnabled}
          onChange={bool("backInStockAlertsEnabled")}
        />
        {s.backInStockAlertsEnabled && (
          <NumField
            label="Max subscriptions per user"
            desc="Limit how many back-in-stock subscriptions a single buyer can hold"
            value={s.maxBackInStockPerUser}
            onChange={num("maxBackInStockPerUser")}
            suffix="alerts"
            min={1}
          />
        )}
      </SectionCard>

      {/* ── Safe Meet Spots ──────────────────────────────────────────────────── */}
      <SectionCard icon={MapPin} title="Safe Meet Spots" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the SafeMeetModal button inside the chat window. When off, the "Suggest Meet Spot" button is hidden.
        </p>
        <ToggleRow
          label="Safe meet feature enabled in chat"
          desc="Let users propose verified safe meetup locations from the Zamorax safe spot directory"
          checked={s.safeMeetEnabled}
          onChange={bool("safeMeetEnabled")}
        />
      </SectionCard>

      {/* ── Chat Security ────────────────────────────────────────────────────── */}
      <SectionCard icon={Shield} title="Chat & Messaging" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls buyer-seller messaging, pre-escrow contact masking, and safe meet spots.
        </p>
        <ToggleRow
          label="Buyer-seller chat enabled"
          desc="Master toggle — when OFF, the Chat with Seller button is hidden on all listings and no new chats can be started"
          checked={s.chatEnabled ?? true}
          onChange={bool("chatEnabled")}
        />
        {!(s.chatEnabled ?? true) && (
          <InfoBox color="red">⚠️ Chat is globally DISABLED. Buyers cannot contact sellers from listing pages.</InfoBox>
        )}
        {(s.chatEnabled ?? true) && (
          <>
            <ToggleRow
              label="Block phone numbers & external links before escrow is funded"
              desc="Prevents off-platform deals. Users can share contact details only after payment is in escrow"
              checked={s.chatEscrowLockEnabled}
              onChange={bool("chatEscrowLockEnabled")}
            />
            {!s.chatEscrowLockEnabled && (
              <InfoBox color="red">⚠️ Chat lock is OFF. Users can share contact details at any stage. This increases off-platform fraud risk.</InfoBox>
            )}
          </>
        )}
      </SectionCard>

      {/* ── WhatsApp Support ─────────────────────────────────────────────────── */}
      <SectionCard icon={MessageSquare} title="WhatsApp Support Line" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          The support line used in WhatsAppSupport widget (separate from the social WhatsApp link in the footer).
        </p>
        <ToggleRow
          label="Show WhatsApp support widget"
          desc="Floating WhatsApp button shown site-wide. Turn off to hide it everywhere."
          checked={s.whatsappSupportEnabled}
          onChange={bool("whatsappSupportEnabled")}
        />
        <StrField
          label="Support WhatsApp number"
          desc="Digits only with country code — e.g. 2347076479357"
          value={s.whatsappSupportNumber}
          onChange={str("whatsappSupportNumber")}
          placeholder="2347076479357"
        />
        <StrField
          label="Default message template"
          desc="Pre-filled message when a user taps the support widget"
          value={s.whatsappSupportMessage}
          onChange={str("whatsappSupportMessage")}
          placeholder="Hi Zamorax Support, I need help with"
        />
        <InfoBox color="blue">
          Link preview: wa.me/{s.whatsappSupportNumber || "..."}?text={encodeURIComponent(s.whatsappSupportMessage || "")}
        </InfoBox>
      </SectionCard>

      {/* ── Social Links & Contact ───────────────────────────────────────────── */}
      <SectionCard icon={Globe} title="Social Links & Footer Contact" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          These appear in the site footer instantly — no redeployment needed.
        </p>
        <StrField label="X (Twitter) URL" value={s.socialTwitterUrl} onChange={str("socialTwitterUrl")} placeholder="https://x.com/zamorax" />
        <StrField label="Instagram URL" value={s.socialInstagramUrl} onChange={str("socialInstagramUrl")} placeholder="https://instagram.com/zamorax" />
        <StrField label="LinkedIn URL" value={s.socialLinkedInUrl} onChange={str("socialLinkedInUrl")} placeholder="https://linkedin.com/company/zamorax" />
        <StrField label="WhatsApp (social footer link)" desc="Digits only with country code" value={s.socialWhatsAppNumber} onChange={str("socialWhatsAppNumber")} placeholder="2348012345678" />
        <StrField label="Contact Email" value={s.contactEmail} onChange={str("contactEmail")} placeholder="hello@zamorax.com" />
        <StrField
          label="Office / Business Address"
          desc="Shown on the /contact page info card"
          value={s.contactAddress}
          onChange={str("contactAddress")}
          placeholder="14 Admiralty Way, Lekki Phase 1, Lagos"
        />
        <StrField
          label="Contact Phone / WhatsApp"
          desc="Display-formatted number shown on /contact (e.g. +234 701 234 5678)"
          value={s.contactPhone}
          onChange={str("contactPhone")}
          placeholder="+234 701 234 5678"
        />
        <StrField
          label="Support Hours"
          desc="Shown on the /contact page info card"
          value={s.supportHours}
          onChange={str("supportHours")}
          placeholder="Monday–Saturday: 9AM–6PM WAT"
        />
        <div className="rounded-lg bg-muted/40 border px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Footer preview</p>
          <div className="flex gap-3 flex-wrap text-xs text-muted-foreground">
            {s.socialTwitterUrl    && <span className="px-2 py-1 bg-background rounded border">𝕏 Twitter ✓</span>}
            {s.socialInstagramUrl  && <span className="px-2 py-1 bg-background rounded border">📸 Instagram ✓</span>}
            {s.socialLinkedInUrl   && <span className="px-2 py-1 bg-background rounded border">💼 LinkedIn ✓</span>}
            {s.socialWhatsAppNumber && <span className="px-2 py-1 bg-background rounded border">💬 WhatsApp ✓</span>}
            {!s.socialTwitterUrl && !s.socialInstagramUrl && !s.socialLinkedInUrl && !s.socialWhatsAppNumber && (
              <span className="text-muted-foreground italic">No social links set yet</span>
            )}
          </div>
          {s.contactEmail && <p className="text-xs text-muted-foreground">{s.contactEmail}</p>}
          {s.contactPhone && <p className="text-xs text-muted-foreground">📞 {s.contactPhone}</p>}
          {s.contactAddress && <p className="text-xs text-muted-foreground">📍 {s.contactAddress}</p>}
          {s.supportHours && <p className="text-xs text-muted-foreground">🕐 {s.supportHours}</p>}
        </div>
      </SectionCard>

      {/* ── Dispute Controls ─────────────────────────────────────────────────── */}
      <SectionCard icon={ShieldAlert} title="Dispute Controls" defaultOpen={false}>
        <ToggleRow
          label="Allow dispute filing"
          desc="Turn off to temporarily pause all new dispute submissions (e.g. during team downtime)"
          checked={s.disputeFilingEnabled}
          onChange={bool("disputeFilingEnabled")}
        />
        {!s.disputeFilingEnabled && (
          <InfoBox color="amber">⚠️ Dispute filing is paused. Buyers cannot open new disputes until this is re-enabled.</InfoBox>
        )}
      </SectionCard>

      {/* ── Buyer Inspection Window ──────────────────────────────────────────── */}
      <SectionCard icon={Clock} title="Buyer Inspection Window" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          How long after delivery a buyer has to inspect and raise an issue before escrow is auto-released to the seller.
          This is the buyer-facing window — separate from the auto-resolve dispute days.
        </p>
        <NumField
          label="Inspection window"
          desc="Hours after delivery confirmation that escrow is held before auto-release"
          value={s.buyerInspectionWindowHours}
          onChange={num("buyerInspectionWindowHours")}
          suffix="hours"
          min={1}
          max={720}
        />
        <ToggleRow
          label="Show inspection countdown timer to buyers"
          desc="Display the live countdown in InspectionCountdown component on the order page"
          checked={s.showInspectionCountdown}
          onChange={bool("showInspectionCountdown")}
        />
      </SectionCard>

      {/* ── Insurance Pool ───────────────────────────────────────────────────── */}
      <SectionCard icon={Shield} title="Insurance Pool" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls whether the platform collects insurance on orders. The rate is set in Commission & Fees above.
        </p>
        <ToggleRow
          label="Insurance collection enabled"
          desc="Collect the insurance fee on every eligible order and add it to the pool"
          checked={s.insuranceCollectionEnabled}
          onChange={bool("insuranceCollectionEnabled")}
        />
        <ToggleRow
          label="Require insurance specifically for rentals"
          desc="Even if general insurance is off, always collect it on rental orders"
          checked={s.insuranceRequiredForRentals}
          onChange={bool("insuranceRequiredForRentals")}
        />
      </SectionCard>

      {/* ── Blog & Content ───────────────────────────────────────────────────── */}
      <SectionCard icon={BookOpen} title="Blog & Content" defaultOpen={false}>
        <ToggleRow
          label="Blog section enabled"
          desc="Show the /blog route and blog preview on the public homepage"
          checked={s.blogEnabled}
          onChange={bool("blogEnabled")}
        />
        <ToggleRow
          label="Allow moderators to publish blog posts"
          desc="When off, only admins can publish — moderators can still draft"
          checked={s.moderatorCanPublishBlog}
          onChange={bool("moderatorCanPublishBlog")}
        />
      </SectionCard>

      {/* ── Seller Trust Score ───────────────────────────────────────────────── */}
      <SectionCard icon={Star} title="Seller Trust Score" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the SellerTrustScore component on seller profiles and listing detail pages.
          Total weight should add to 100 for correct display. Other factors (rating, orders, completion rate) make up the remainder.
        </p>
        <ToggleRow
          label="Show trust score on seller profiles"
          desc="Display the trust score bar and breakdown on public seller pages"
          checked={s.trustScoreVisible}
          onChange={bool("trustScoreVisible")}
        />
        {s.trustScoreVisible && (
          <>
            <Separator />
            <NumField
              label="NIN verification weight"
              desc="Points added to trust score when seller has NIN verified"
              value={s.trustScoreNinWeight}
              onChange={num("trustScoreNinWeight")}
              suffix="pts"
              min={0}
              max={50}
            />
            <NumField
              label="BVN verification weight"
              desc="Points added to trust score when seller has BVN/Pro verified"
              value={s.trustScoreBvnWeight}
              onChange={num("trustScoreBvnWeight")}
              suffix="pts"
              min={0}
              max={50}
            />
            <InfoBox color="blue">
              NIN + BVN = {s.trustScoreNinWeight + s.trustScoreBvnWeight} pts. Remaining {100 - s.trustScoreNinWeight - s.trustScoreBvnWeight} pts come from rating, orders, and completion rate.
            </InfoBox>
          </>
        )}
      </SectionCard>

      {/* ── QR Handshake ─────────────────────────────────────────────────────── */}
      <SectionCard icon={QrCode} title="QR Code Handshake" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls whether in-person pickup orders require a QR scan to mark as delivered (QRCodeDisplay component).
        </p>
        <ToggleRow
          label="QR handshake required for in-person pickup"
          desc="The seller must scan the buyer's QR code to complete a pickup order"
          checked={s.qrHandshakeRequired}
          onChange={bool("qrHandshakeRequired")}
        />
        {!s.qrHandshakeRequired && (
          <InfoBox color="amber">⚠️ QR handshake is optional. Orders can be marked complete without scanning.</InfoBox>
        )}
      </SectionCard>

      {/* ── PWA & Push Prompts ───────────────────────────────────────────────── */}
      <SectionCard icon={Smartphone} title="PWA & Push Notification Prompts" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the InstallPrompt (PWA) and PushNotificationPrompt timing on mobile.
        </p>
        <ToggleRow
          label="Show PWA install prompt to mobile users"
          desc="Display the 'Add to Home Screen' prompt when the browser fires beforeinstallprompt"
          checked={s.pwaInstallPromptEnabled}
          onChange={bool("pwaInstallPromptEnabled")}
        />
        {s.pwaInstallPromptEnabled && (
          <>
            <NumField
              label="PWA prompt delay"
              desc="Seconds to wait after page load before showing the install prompt"
              value={s.pwaInstallPromptDelaySec}
              onChange={num("pwaInstallPromptDelaySec")}
              suffix="seconds"
              min={0}
              max={300}
            />
            <NumField
              label="Re-show after dismiss"
              desc="Seconds before showing install prompt again after user dismisses (86400 = 1 day, 604800 = 7 days)"
              value={s.pwaReshowAfterDismissSec ?? 86400}
              onChange={num("pwaReshowAfterDismissSec" as any)}
              suffix="seconds"
              min={0}
            />
            <StrField
              label="Install prompt headline"
              desc="Shown on the install banner / iOS bottom sheet"
              value={s.pwaHeadline ?? "Install Zamorax App"}
              onChange={str("pwaHeadline" as any)}
              placeholder="Install Zamorax App"
            />
            <StrField
              label="Install prompt subtitle"
              value={s.pwaSubtitle ?? "Add to home screen for faster access"}
              onChange={str("pwaSubtitle" as any)}
              placeholder="Add to home screen for faster access"
            />
          </>
        )}
        <Separator />
        <NumField
          label="Push notification opt-in prompt delay"
          desc="Seconds to wait before asking the user to allow push notifications (currently hardcoded to 30s in PushNotificationPrompt)"
          value={s.pushOptInPromptDelaySec}
          onChange={num("pushOptInPromptDelaySec")}
          suffix="seconds"
          min={0}
          max={600}
        />
      </SectionCard>

      {/* ── Referral Rewards ─────────────────────────────────────────────────── */}
      <SectionCard icon={Gift} title="Referral Agent Rewards" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">Rates update instantly. Agents see live rates on their dashboard. Any existing buyer or seller can refer anybody — the reward paid depends on the role of the person referred, not the referrer's own role.</p>
        <p className="text-xs font-semibold text-muted-foreground pt-2">Referred a buyer</p>
        <KoboField label="Signup reward" desc="Paid when a referred buyer signs up" value={s.referralSignupRewardKobo} onChange={kobo("referralSignupRewardKobo")} />
        <KoboField label="First order reward" desc="Paid when a referred buyer places their first order" value={s.referralOrderRewardKobo} onChange={kobo("referralOrderRewardKobo")} />
        <p className="text-xs font-semibold text-muted-foreground pt-2">Referred a seller</p>
        <KoboField label="Signup reward" desc="Paid when a referred seller signs up" value={s.referralSellerSignupRewardKobo} onChange={kobo("referralSellerSignupRewardKobo")} />
        <KoboField label="First sale reward" desc="Paid when a referred seller's first listing sells and completes" value={s.referralSellerSaleRewardKobo} onChange={kobo("referralSellerSaleRewardKobo")} />
        <Separator />
        <p className="text-xs font-semibold text-muted-foreground pt-2">Referral dashboard banner</p>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Headline</label>
          <Input value={s.referralBannerHeadline} onChange={e => str("referralBannerHeadline")(e.target.value)} placeholder="e.g. Earn up to ₦3,000 per referral!" className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Subtext</label>
          <Input value={s.referralBannerSubtext} onChange={e => str("referralBannerSubtext")(e.target.value)} placeholder="e.g. Invite friends and get paid instantly." className="h-9 text-sm" />
        </div>
      </SectionCard>

      {/* ── FBZ moved to its own page — see /admin/fbz → "Rates & Settings" tab ── */}

      {/* ── Subscription Plans ───────────────────────────────────────────────── */}
      <SectionCard icon={CreditCard} title="Subscription Plans" defaultOpen={false}>

        {/* Free */}
        <div className="space-y-3 pb-4 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Free Plan</p>
          <InfoBox color="blue">
            Free plan has no price — limits apply at listing creation. Adjust listing limit and free boosts here.
          </InfoBox>
          <NumField
            label="Active listing limit"
            desc="Max listings a Free seller can have active at once"
            value={s.planFreeListingLimit ?? 5}
            onChange={num("planFreeListingLimit" as NumKey)}
            suffix="listings"
            min={1}
          />
          <NumField
            label="Free boosts per month"
            desc="Number of free boosts included for Free plan sellers each month (usually 0)"
            value={s.planFreeBoosts ?? 0}
            onChange={num("planFreeBoosts" as NumKey)}
            suffix="boosts"
            min={0}
          />
          <div className="space-y-1">
            <Label className="text-sm font-medium">Badge label</Label>
            <p className="text-xs text-muted-foreground">Shown on the plan card. Leave blank for no badge.</p>
            <Input
              value={s.planFreeLabel ?? ""}
              onChange={e => setS(p => ({ ...p, planFreeLabel: e.target.value }))}
              placeholder='e.g. "🆓 Free" or leave blank'
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* Starter */}
        <div className="space-y-3 pb-4 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Starter Plan</p>
          <KoboField label="Price" desc="Amount charged per billing period" value={s.planStarterPrice} onChange={v => setS(p => ({ ...p, planStarterPrice: v }))} />
          <NumField label="Billing period" desc="1 = monthly · 3 = quarterly · 12 = annual" value={s.planStarterBillingMonths} onChange={num("planStarterBillingMonths")} suffix="month(s)" min={1} max={24} />
          <NumField label="Active listing limit" desc="Max listings a Starter seller can have active at once" value={s.planStarterListingLimit} onChange={num("planStarterListingLimit")} suffix="listings" min={1} />
          <NumField label="Free boosts per period" desc="Number of free boosts included each billing period" value={s.planStarterFreeBoosts} onChange={num("planStarterFreeBoosts")} suffix="boosts" min={0} />
          <div className="space-y-1">
            <Label className="text-sm font-medium">Badge label</Label>
            <p className="text-xs text-muted-foreground">Shown on the plan card. Leave blank for no badge.</p>
            <Input value={s.planStarterLabel} onChange={e => setS(p => ({ ...p, planStarterLabel: e.target.value }))} placeholder='e.g. "⭐ Most Popular" or "🔥 Promo"' className="h-9 text-sm" />
          </div>
        </div>

        {/* Pro */}
        <div className="space-y-3 pt-2">
          <p className="text-sm font-semibold text-foreground">Pro Plan</p>
          <KoboField label="Price" desc="Amount charged per billing period" value={s.planProPrice} onChange={v => setS(p => ({ ...p, planProPrice: v }))} />
          <NumField label="Billing period" desc="1 = monthly · 3 = quarterly · 12 = annual" value={s.planProBillingMonths} onChange={num("planProBillingMonths")} suffix="month(s)" min={1} max={24} />
          <NumField label="Active listing limit" desc="0 = unlimited" value={s.planProListingLimit} onChange={num("planProListingLimit")} suffix="listings" min={0} />
          <NumField label="Free boosts per period" value={s.planProFreeBoosts} onChange={num("planProFreeBoosts")} suffix="boosts" min={0} />
          <div className="space-y-1">
            <Label className="text-sm font-medium">Badge label</Label>
            <p className="text-xs text-muted-foreground">Shown on the plan card. Leave blank for no badge.</p>
            <Input value={s.planProLabel} onChange={e => setS(p => ({ ...p, planProLabel: e.target.value }))} placeholder='e.g. "🚀 Best Value"' className="h-9 text-sm" />
          </div>
        </div>
      </SectionCard>

      {/* ── Boosts & Verification ────────────────────────────────────────────── */}
      <SectionCard icon={Zap} title="Boosts & Verification" defaultOpen={false}>

        {/* Standard */}
        <div className="space-y-3 pb-4 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Standard Boost</p>
          <div className="space-y-1">
            <Label className="text-sm font-medium">Display name</Label>
            <Input value={s.boostStandardLabel} onChange={e => setS(p => ({ ...p, boostStandardLabel: e.target.value }))} placeholder="e.g. Standard" className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-medium">Description</Label>
            <Input value={s.boostStandardDesc} onChange={e => setS(p => ({ ...p, boostStandardDesc: e.target.value }))} placeholder="Shown on pricing page" className="h-9 text-sm" />
          </div>
          <KoboField label="Price" value={s.boostStandard} onChange={v => setS(p => ({ ...p, boostStandard: v }))} />
          <NumField label="Duration" value={s.boostStandardDays} onChange={num("boostStandardDays")} suffix="days" min={1} />
        </div>

        {/* Premium */}
        <div className="space-y-3 py-4 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Premium Boost</p>
          <div className="space-y-1">
            <Label className="text-sm font-medium">Display name</Label>
            <Input value={s.boostPremiumLabel} onChange={e => setS(p => ({ ...p, boostPremiumLabel: e.target.value }))} placeholder="e.g. Premium" className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-medium">Description</Label>
            <Input value={s.boostPremiumDesc} onChange={e => setS(p => ({ ...p, boostPremiumDesc: e.target.value }))} placeholder="Shown on pricing page" className="h-9 text-sm" />
          </div>
          <KoboField label="Price" value={s.boostPremium} onChange={v => setS(p => ({ ...p, boostPremium: v }))} />
          <NumField label="Duration" value={s.boostPremiumDays} onChange={num("boostPremiumDays")} suffix="days" min={1} />
        </div>

        {/* Category Top */}
        <div className="space-y-3 pt-4 pb-2">
          <p className="text-sm font-semibold text-foreground">Category Top Boost</p>
          <div className="space-y-1">
            <Label className="text-sm font-medium">Display name</Label>
            <Input value={s.boostCategoryTopLabel} onChange={e => setS(p => ({ ...p, boostCategoryTopLabel: e.target.value }))} placeholder="e.g. Category Top" className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-medium">Description</Label>
            <Input value={s.boostCategoryTopDesc} onChange={e => setS(p => ({ ...p, boostCategoryTopDesc: e.target.value }))} placeholder="Shown on pricing page" className="h-9 text-sm" />
          </div>
          <KoboField label="Price" value={s.boostCategoryTop} onChange={v => setS(p => ({ ...p, boostCategoryTop: v }))} />
          <NumField label="Duration" value={s.boostCategoryTopDays} onChange={num("boostCategoryTopDays")} suffix="days" min={1} />
        </div>

        <Separator />
        <KoboField label="Hub verification fee" desc="One-time fee per item submitted for hub verification" value={s.hubVerificationFee} onChange={v => setS(p => ({ ...p, hubVerificationFee: v }))} />
      </SectionCard>

      {/* ── Payout Settings ──────────────────────────────────────────────────── */}
      <SectionCard icon={Wallet} title="Payout Settings" defaultOpen={false}>
        <NumField label="Minimum payout (kobo)" value={s.minPayoutAmount} onChange={num("minPayoutAmount")} />
        <ToggleRow label="Instant payout" desc="Verified sellers get same-day payouts" checked={s.instantPayoutEnabled} onChange={bool("instantPayoutEnabled")} />
        <NumField label="Manual payout SLA" value={s.payoutProcessingHours} onChange={num("payoutProcessingHours")} suffix="hrs" />
      </SectionCard>

      {/* ── Dispute Auto-Resolution ──────────────────────────────────────────── */}
      <SectionCard icon={Bot} title="Dispute Auto-Resolution" defaultOpen={false}>
        <ToggleRow label="Enable auto-resolution" checked={s.autoResolveEnabled} onChange={bool("autoResolveEnabled")} />
        <Separator />
        <NumField label="Item not received — refund after" value={s.autoResolveItemNotReceivedDays} onChange={num("autoResolveItemNotReceivedDays")} suffix="days" />
        <NumField label="No tracking — refund after" value={s.autoResolveNoTrackingDays} onChange={num("autoResolveNoTrackingDays")} suffix="days" />
        <NumField label="Seller no-response — escalate after" value={s.autoResolveSellerNoResponseHours} onChange={num("autoResolveSellerNoResponseHours")} suffix="hrs" />
        <NumField label="Inspection window" value={s.autoResolveInspectionWindowDays} onChange={num("autoResolveInspectionWindowDays")} suffix="days" />
        <NumField label="Low-value threshold" value={s.autoResolveLowValueThreshold} onChange={num("autoResolveLowValueThreshold")} suffix="kobo" />
      </SectionCard>

      {/* ── Search Alerts ────────────────────────────────────────────────────── */}
      <SectionCard icon={Bell} title="Search Alerts" defaultOpen={false}>
        <NumField label="Max alerts per user" value={s.maxSearchAlertsPerUser} onChange={num("maxSearchAlertsPerUser")} suffix="alerts" />
        <NumField label="Alert cooldown" value={s.searchAlertCooldownHours} onChange={num("searchAlertCooldownHours")} suffix="hrs" />
      </SectionCard>

      {/* ── Buyer Badge Thresholds ───────────────────────────────────────────── */}
      <SectionCard icon={ShieldCheck} title="Buyer Badge Thresholds" defaultOpen={false}>
        <NumField label="Verified Buyer" value={s.badgeVerifiedBuyerOrders} onChange={num("badgeVerifiedBuyerOrders")} suffix="orders" />
        <NumField label="Trusted Buyer" value={s.badgeTrustedBuyerOrders} onChange={num("badgeTrustedBuyerOrders")} suffix="orders" />
        <NumField label="Power Buyer" value={s.badgePowerBuyerOrders} onChange={num("badgePowerBuyerOrders")} suffix="orders" />
      </SectionCard>

      {/* ── Listing Q&A ──────────────────────────────────────────────────────── */}
      <SectionCard icon={MessageSquare} title="Listing Q&A" defaultOpen={false}>
        <ToggleRow label="Q&A enabled" checked={s.qnaEnabled} onChange={bool("qnaEnabled")} />
        <NumField label="Seller response SLA" value={s.qnaSellerResponseSLAHours} onChange={num("qnaSellerResponseSLAHours")} suffix="hrs" />
      </SectionCard>

      {/* ── Push Notifications ───────────────────────────────────────────────── */}
      <SectionCard icon={Bell} title="Push Notifications" defaultOpen={false}>
        <ToggleRow label="Platform push notifications" checked={s.pushNotifsEnabled} onChange={bool("pushNotifsEnabled")} />
        <ToggleRow label="Price drop alerts" checked={s.pushPriceDropAlertsEnabled} onChange={bool("pushPriceDropAlertsEnabled")} />
      </SectionCard>

      {/* ── Bundle Deals ─────────────────────────────────────────────────────── */}
      <SectionCard icon={Package2} title="Bundle Deals" defaultOpen={false}>
        <ToggleRow label="Bundle deals enabled" checked={s.bundlesEnabled} onChange={bool("bundlesEnabled")} />
        <ToggleRow
          label="Seller promo codes"
          desc="Allow sellers to create discount codes for their store"
          checked={s.promoCodesEnabled ?? true}
          onChange={bool("promoCodesEnabled")}
        />
        <ToggleRow
          label="Share listing button"
          desc="Show native share sheet / copy link button on listing cards"
          checked={s.shareListingEnabled ?? true}
          onChange={bool("shareListingEnabled")}
        />
        <ToggleRow
          label="Listing duplication"
          desc="Allow sellers to copy a listing to a new draft"
          checked={s.listingDuplicationEnabled ?? true}
          onChange={bool("listingDuplicationEnabled")}
        />
        <ToggleRow
          label="Stock view alerts"
          desc="Notify seller when a listing hits X views with no sale"
          checked={s.stockViewAlertEnabled ?? true}
          onChange={bool("stockViewAlertEnabled")}
        />
        {s.stockViewAlertEnabled && (
          <NumField
            label="View alert threshold"
            desc="Number of views before seller is notified"
            value={s.stockViewAlertThreshold ?? 50}
            onChange={num("stockViewAlertThreshold")}
            suffix="views"
            min={10}
          />
        )}
        <NumField label="Max items per bundle" value={s.maxBundleItems} onChange={num("maxBundleItems")} suffix="items" />
        <NumField label="Max bundle discount" value={s.maxBundleDiscountPercent} onChange={num("maxBundleDiscountPercent")} suffix="%" />
      </SectionCard>

      {/* ── Cart & Checkout ──────────────────────────────────────────────────── */}
      <SectionCard icon={ShoppingCart} title="Cart & Checkout" defaultOpen={false}>
        <p className="text-xs text-muted-foreground">
          Controls the multi-item cart feature. When enabled, buyers can add items from multiple sellers and check out in one payment.
        </p>
        <ToggleRow
          label="Enable Multi-Cart"
          desc="Buyers can add multiple items from different sellers into one cart"
          checked={s.multiCartEnabled ?? true}
          onChange={bool("multiCartEnabled" as any)}
        />
        {(s.multiCartEnabled ?? true) && (
          <>
            <NumField
              label="Max items per cart"
              desc="Maximum number of distinct listings a buyer can add to one cart"
              value={s.maxCartItems ?? 20}
              onChange={num("maxCartItems" as any)}
              suffix="items"
              min={1}
              max={100}
            />
            <NumField
              label="Max quantity per listing"
              desc="Maximum quantity of a single listing a buyer can add"
              value={s.maxQtyPerItem ?? 10}
              onChange={num("maxQtyPerItem" as any)}
              suffix="units"
              min={1}
              max={50}
            />
            <Separator />
            <ToggleRow
              label="Show low stock warning"
              desc="Display 'Only X left' warning when stock is below threshold"
              checked={s.showLowStockWarning ?? true}
              onChange={bool("showLowStockWarning" as any)}
            />
            {(s.showLowStockWarning ?? true) && (
              <NumField
                label="Low stock threshold"
                desc="Show warning when available quantity is at or below this number"
                value={s.lowStockThreshold ?? 3}
                onChange={num("lowStockThreshold" as any)}
                suffix="units"
                min={1}
                max={20}
              />
            )}
          </>
        )}
      </SectionCard>

      {/* ── Buyer Tools ──────────────────────────────────────────────────────── */}
      <SectionCard icon={Bell} title="Buyer Tools" defaultOpen={false}>
        <ToggleRow
          label="Price Drop Alerts"
          desc="Allow buyers to set a target price on a listing and get notified when it drops"
          checked={s.priceAlertsEnabled ?? true}
          onChange={bool("priceAlertsEnabled" as any)}
        />
        <ToggleRow
          label="Recently Viewed listings row"
          desc="Show a 'Recently Viewed' horizontal row on the homepage for logged-in buyers"
          checked={s.recentlyViewedEnabled ?? true}
          onChange={bool("recentlyViewedEnabled" as any)}
        />
      </SectionCard>

      {/* ── Seller Features ──────────────────────────────────────────────────── */}
      <SectionCard icon={UserPlus} title="Seller Features" defaultOpen={false}>
        <ToggleRow
          label="Seller Store Follows"
          desc="Allow buyers to follow seller stores and sellers to see their follower count"
          checked={s.sellerFollowsEnabled ?? true}
          onChange={bool("sellerFollowsEnabled" as any)}
        />
        <ToggleRow
          label="Vacation Mode"
          desc="Allow sellers to enable vacation mode, pausing all their active listings"
          checked={s.vacationModeEnabled ?? true}
          onChange={bool("vacationModeEnabled" as any)}
        />
      </SectionCard>

      {/* ── Platform Features ────────────────────────────────────────────────── */}
      <SectionCard icon={Globe} title="Platform Features" defaultOpen={false}>
        <ToggleRow label="Flash Deals" checked={s.flashDealsEnabled} onChange={bool("flashDealsEnabled")} />
        <ToggleRow label="Group Buy" checked={s.groupBuyEnabled} onChange={bool("groupBuyEnabled")} />
        {s.groupBuyEnabled && (
          <>
            <NumField
              label="Group buy minimum participants"
              desc="How many buyers must join a group for the discount to activate"
              value={s.groupBuyMinParticipants}
              onChange={num("groupBuyMinParticipants")}
              suffix="buyers"
              min={2}
              max={50}
            />
            <NumField
              label="Group buy discount"
              desc="Percentage discount applied when the group size is reached"
              value={s.groupBuyDiscountPercent}
              onChange={num("groupBuyDiscountPercent")}
              suffix="%"
              min={1}
              max={80}
            />
            <InfoBox color="blue">
              Group of {s.groupBuyMinParticipants}+ buyers → {s.groupBuyDiscountPercent}% off the listing price
            </InfoBox>
          </>
        )}
        <Separator />
        <ToggleRow label="Rentals" checked={s.rentalsEnabled} onChange={bool("rentalsEnabled")} />
        <ToggleRow label="New user registration" checked={s.newUserRegistrationEnabled} onChange={bool("newUserRegistrationEnabled")} />
      </SectionCard>

      {/* ── Maintenance Mode ─────────────────────────────────────────────────── */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="h-4 w-4" /> Maintenance Mode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="Enable maintenance mode"
            desc="Takes the marketplace offline for non-admin users"
            checked={s.maintenanceMode}
            onChange={bool("maintenanceMode")}
          />
          {s.maintenanceMode && (
            <div className="space-y-1.5">
              <Label className="text-sm">Maintenance message</Label>
              <Input
                placeholder="We're performing scheduled maintenance. Back shortly!"
                value={s.maintenanceMessage}
                onChange={e => str("maintenanceMessage")(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky Save */}
      <div className="sticky bottom-4 flex justify-end pb-4">
        <Button onClick={save} disabled={saving} size="lg" className="bg-primary text-white shadow-lg min-w-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? "Saving…" : "Save All Settings"}
        </Button>
      </div>
    </div>
  )
}
