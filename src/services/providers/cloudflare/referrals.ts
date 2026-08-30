// src/services/providers/cloudflare/referrals.ts
// WAS FIREBASE/FIRESTORE → NOW CLOUDFLARE D1
import { AdminService } from "@/src/services/admin"
import { DEFAULT_SETTINGS } from "@/src/services/platformSettings"
import type { IReferralsService, ReferredRole } from "@/src/services/referrals"

const DEFAULTS = {
  buyer_signup:      50000,
  first_order:       200000,
  seller_signup:     50000,
  seller_first_sale: 300000,
}

export const ReferralsService: IReferralsService = {

  async getReferralRewards() {
    try {
      const snap = await AdminService.getDoc("config", "platform") as Record<string, unknown> | null
      return {
        buyer_signup:       Number(snap?.referralSignupRewardKobo       ?? DEFAULTS.buyer_signup),
        first_order:        Number(snap?.referralOrderRewardKobo        ?? DEFAULTS.first_order),
        seller_signup:      Number(snap?.referralSellerSignupRewardKobo ?? DEFAULTS.seller_signup),
        seller_first_sale:  Number(snap?.referralSellerSaleRewardKobo   ?? DEFAULTS.seller_first_sale),
      }
    } catch {
      return DEFAULTS
    }
  },

  getReferralLink(userId) {
    const base = typeof window !== "undefined" ? window.location.origin : "https://zamorax.com"
    return `${base}?ref=${userId}`
  },

  // Any existing user — buyer or seller — can refer anybody. The reward paid
  // to the referrer depends on the ROLE of the person being referred, not the
  // referrer's own role (a buyer referring a seller earns the seller-signup
  // rate; a seller referring a buyer earns the buyer-signup rate).
  async applyReferralCode(newUserId, referrerId, referredRole) {
    if (newUserId === referrerId) return
    const rewards = await this.getReferralRewards()
    const signupReward = referredRole === "seller" ? rewards.seller_signup : rewards.buyer_signup

    await AdminService.setDoc("referrals", newUserId, {
      referrer_id:         referrerId,
      new_user_id:         newUserId,
      referred_role:       referredRole,
      status:              "signed_up",
      signup_reward_paid:  signupReward > 0,
      order_reward_paid:   false,
      sale_reward_paid:    false,
    })

    if (signupReward > 0) {
      await this.creditReferralAgent(
        referrerId,
        signupReward,
        referredRole === "seller" ? "seller_signup" : "signup",
        newUserId,
      )
    }
  },

  // Buyer path: pays out when the referred BUYER places their first order.
  async triggerFirstOrderBonus(buyerId) {
    const row = await AdminService.getDoc("referrals", buyerId) as Record<string, unknown> | null
    if (!row) return
    if (row.order_reward_paid || row.orderRewardPaid) return
    const role = String(row.referred_role ?? row.referredRole ?? "buyer")
    if (role !== "buyer") return

    const rewards = await this.getReferralRewards()
    await AdminService.updateDoc("referrals", buyerId, {
      order_reward_paid:    true,
      status:               "ordered",
      order_reward_paid_at: new Date().toISOString(),
    })
    await this.creditReferralAgent(
      String(row.referrer_id ?? row.referrerId),
      rewards.first_order,
      "first_order",
      buyerId,
    )
  },

  // Seller path: pays out when the referred SELLER's first order reaches a
  // completed sale (escrow released — either auto-release cron or a buyer's
  // manual delivery confirmation).
  async triggerSellerFirstSaleBonus(sellerId) {
    const row = await AdminService.getDoc("referrals", sellerId) as Record<string, unknown> | null
    if (!row) return
    if (row.sale_reward_paid || row.saleRewardPaid) return
    const role = String(row.referred_role ?? row.referredRole ?? "buyer")
    if (role !== "seller") return

    const rewards = await this.getReferralRewards()
    await AdminService.updateDoc("referrals", sellerId, {
      sale_reward_paid:    true,
      status:              "sold",
      sale_reward_paid_at: new Date().toISOString(),
    })
    await this.creditReferralAgent(
      String(row.referrer_id ?? row.referrerId),
      rewards.seller_first_sale,
      "seller_first_sale",
      sellerId,
    )
  },

  async creditReferralAgent(agentId, amountKobo, reason, fromUserId) {
    if (!agentId || amountKobo <= 0) return
    const existing = await AdminService.getDoc("agent_wallets", agentId) as Record<string, unknown> | null
    const currentBalance = existing ? Number(existing.balance ?? 0) : 0
    const currentEarned  = existing ? Number(existing.total_earned ?? existing.totalEarned ?? 0) : 0

    await AdminService.setDoc("agent_wallets", agentId, {
      balance:     currentBalance + amountKobo,
      total_earned: currentEarned  + amountKobo,
      owner_id:    agentId,
    }, { merge: true })

    await AdminService.addDoc(`agent_wallets/${agentId}/transactions`, {
      amount:      amountKobo,
      type:        "referral",
      reason,
      from_user_id: fromUserId,
    })
  },
}
