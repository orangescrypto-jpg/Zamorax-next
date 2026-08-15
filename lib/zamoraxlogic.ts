// lib/zamoraxlogic.ts
// ─────────────────────────────────────────────────────────────────
// All ZamoraxLogic API calls go through this file.
// Never call ZamoraxLogic API directly from components or other services.
// ─────────────────────────────────────────────────────────────────

import { fetchWithRetry, type FetchWithRetryOptions } from "@/lib/fetch-with-retry"

const ZLA_API_URL          = process.env.ZAMORAXLOGIC_API_URL          || "https://zamoraxlogic.com/api/v1"
const ZLA_API_KEY          = process.env.ZAMORAXLOGIC_API_KEY          || ""
const ZLA_WEBHOOK_SECRET   = process.env.ZAMORAXLOGIC_WEBHOOK_SECRET   || ""

// ── Types ──────────────────────────────────────────────────────────────────

export interface ZLABookingPayload {
  // Pickup (seller side)
  pickup: {
    contactName:  string
    contactPhone: string
    address:      string
    state:        string
    city:         string
  }
  // Delivery (buyer side)
  delivery: {
    contactName:  string
    contactPhone: string
    address:      string
    state:        string
    city:         string
    lga?:         string
  }
  item: {
    description:   string
    weight:        number
    declaredValue: number
    fragile:       boolean
  }
  deliveryType:    "agent_pickup" | "doorstep"
  externalOrderId: string
  callbackUrl:     string
}

export interface ZLAOriginAgent {
  id?:            string
  name:           string
  address:        string
  phone:          string
  operatingHours: string
}

export interface ZLABookingResponse {
  success:               boolean
  shipmentId:            string
  trackingCode:          string
  originAgent:           ZLAOriginAgent | null   // null if no agent in seller's state yet
  estimatedDeliveryDays: number
  deliveryFee?:          number                  // kobo — actual ZLA rate (our cost)
  message?:              string
}

export interface ZLARateResponse {
  fee:           number
  insuranceFee:  number
  doorstepFee:   number
  total:         number
  estimatedDays: number
}

export interface ZLACoverageResponse {
  success:        boolean
  coveredStates:  string[]
  count:          number
  stateAgents?:   Array<{
    id:             string
    storeName:      string
    storeAddress:   string
    state:          string
    city:           string
    lga:            string
    phone:          string
    operatingHours: string
    rating:         number
  }>
  stateAgentCount?: number
}

// ── Internal fetch wrapper ─────────────────────────────────────────────────

// retryOpts defaults to safe behavior: GET requests (getCoverage,
// getShipment, calculateRate) retry automatically on timeout/network
// drop/5xx. POST requests (bookShipment, cancelShipment) do NOT retry
// by default, since ZamoraxLogic has no idempotency-key mechanism yet —
// blindly retrying "book shipment" on a flaky connection could create
// two real-world deliveries for one order. Pass { retryUnsafe: true }
// explicitly at the call site if that ever changes.
const zlaFetch = async (
  endpoint: string,
  options?: RequestInit,
  retryOpts?: FetchWithRetryOptions,
) => {
  if (!ZLA_API_KEY) throw new Error("ZAMORAXLOGIC_API_KEY not configured")

  const res = await fetchWithRetry(
    `${ZLA_API_URL}${endpoint}`,
    {
      ...options,
      headers: {
        "Authorization": `Bearer ${ZLA_API_KEY}`,
        "Content-Type":  "application/json",
        ...options?.headers,
      },
    },
    { retries: 3, timeoutMs: 12_000, ...retryOpts },
  )

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "ZLA API error" }))
    throw new Error(error.message || `ZLA API error: ${res.status}`)
  }

  return res.json()
}

// ── Public API ─────────────────────────────────────────────────────────────

export const ZamoraxLogicClient = {

  /**
   * Book a ZamoraxLogic shipment for a Zamorax marketplace order.
   * Called from /api/payment/confirm after admin confirms payment.
   *
   * Sends the marketplace field shape (pickup/delivery/item objects).
   * Returns originAgent so we can notify the seller where to drop the parcel.
   * originAgent will be null if ZamoraxLogic has no agent in the seller's state.
   */
  async bookShipment(data: ZLABookingPayload): Promise<ZLABookingResponse> {
    return zlaFetch("/shipments", {
      method: "POST",
      body:   JSON.stringify(data),
    })
  },

  /**
   * Get coverage — list of Nigerian states with at least one active agent.
   * Optional ?state= param also returns agents in that specific state.
   *
   * Used by ShippingService.getZLACoveredStates() as the authoritative
   * real-time source when the Zamorax marketplace needs to query ZamoraxLogic
   * directly (e.g. future cross-platform sync).
   * For now the marketplace reads its own agentLocations collection directly,
   * which is faster and doesn't need an external API call.
   */
  async getCoverage(state?: string): Promise<ZLACoverageResponse> {
    const qs = state ? `?state=${encodeURIComponent(state)}` : ""
    return zlaFetch(`/coverage${qs}`)
  },

  /**
   * Get shipment status and full timeline by tracking code.
   */
  async getShipment(trackingCode: string) {
    return zlaFetch(`/shipments/${trackingCode}`)
  },

  /**
   * Calculate delivery rate before booking.
   */
  async calculateRate(
    originState:   string,
    destState:     string,
    weight:        number,
    declaredValue: number  = 0,
    doorstep:      boolean = false
  ): Promise<ZLARateResponse> {
    const params = new URLSearchParams({
      origin:        originState,
      destination:   destState,
      weight:        String(weight),
      declaredValue: String(declaredValue),
      isDoorstep:    String(doorstep),
    })
    return zlaFetch(`/rates?${params}`)
  },

  /**
   * Cancel a pending shipment (only works before dropped_off status).
   */
  async cancelShipment(shipmentId: string) {
    return zlaFetch(`/shipments/${shipmentId}/cancel`, { method: "POST" })
  },

  /**
   * Verify a webhook callback came from ZamoraxLogic.
   * Call this in the webhook handler before processing any delivery event.
   */
  verifyWebhookSignature(body: string, signature: string): boolean {
    if (!ZLA_WEBHOOK_SECRET) return false
    try {
      const crypto  = require("crypto")
      const expected = crypto
        .createHmac("sha256", ZLA_WEBHOOK_SECRET)
        .update(body)
        .digest("hex")
      return crypto.timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expected,  "hex")
      )
    } catch {
      return false
    }
  },
}
