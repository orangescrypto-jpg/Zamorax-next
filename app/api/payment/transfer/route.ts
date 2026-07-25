// app/api/payment/transfer/route.ts
// Sends an actual bank transfer via Paystack or Flutterwave, chosen by
// `provider` in the request body. Used when platform settings have
// payoutMethod = "paystack" or "flutterwave". This is what automatically
// pays a seller the moment admin approves a withdrawal — no manual bank
// transfer step needed.
//
// Flutterwave has two distinct payout paths, both handled below:
//   1. Escrow release (escrowTxRef present) — the order's payment was
//      collected with the escrow flag on, funds are sitting held at
//      Flutterwave, and this calls their /transactions/escrow/settle
//      endpoint to release straight to the seller's subaccount/bank.
//   2. Plain transfer (no escrowTxRef) — a standalone wallet withdrawal
//      not tied to a specific held escrow transaction, sent via
//      Flutterwave's normal /transfers endpoint (same shape as Paystack's).
//
// Requires: PAYSTACK_SECRET_KEY and/or FLW_SECRET_KEY depending on which
// provider is used, and that live transfers are unlocked on the relevant
// account (business KYC completed). Test-mode transfers work without KYC
// but only send to each provider's test recipients.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-server"

async function handlePaystackTransfer(params: {
  amountKobo: number; accountName: string; accountNumber: string
  bankCode: string; reference: string; reason?: string
}) {
  const {
    amountKobo, accountName, accountNumber, bankCode, reference, reason,
  } = params

  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return NextResponse.json({ error: "PAYSTACK_SECRET_KEY not configured" }, { status: 500 })

  try {
    // FIX: idempotency guard. Reference is deterministic (`WD-${withdrawalId}`
    // from the caller), so if this exact transfer was already initiated —
    // e.g. the admin's browser crashed reading a previous response (the
    // "Unexpected end of JSON input" class of bug) and they clicked Approve
    // again — check Paystack first instead of blindly firing a second real
    // bank transfer for the same withdrawal.
    const verifyRes = await fetch(
      `https://api.paystack.co/transfer/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )
    if (verifyRes.ok) {
      const verifyData = await verifyRes.json()
      const existingStatus = verifyData?.data?.status as string | undefined
      if (verifyData.status && existingStatus && existingStatus !== "failed" && existingStatus !== "reversed") {
        // A transfer with this reference already exists and isn't in a
        // failed/reversed state — don't send another one. Return the
        // existing result so the caller can proceed as if this were the
        // original successful call.
        return NextResponse.json({
          success: true,
          alreadyProcessed: true,
          transferCode: verifyData.data.transfer_code,
          transferStatus: existingStatus,
          reference,
        })
      }
      // If existingStatus is "failed" or "reversed", fall through and retry
      // the transfer below — that's a legitimate reason to send it again.
    }

    // Step 1: create (or reuse) a transfer recipient.
    const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "nuban", name: accountName, account_number: accountNumber,
        bank_code: bankCode, currency: "NGN",
      }),
    })
    const recipientData = await recipientRes.json()
    if (!recipientRes.ok || !recipientData.status || !recipientData.data?.recipient_code) {
      return NextResponse.json(
        { success: false, error: recipientData.message || "Could not create transfer recipient", reference },
        { status: 400 },
      )
    }
    const recipientCode = recipientData.data.recipient_code

    // Step 2: initiate the transfer itself.
    const transferRes = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "balance",
        amount: amountKobo,
        recipient: recipientCode,
        reference,
        reason: reason || "Zamorax seller withdrawal",
      }),
    })
    const transferData = await transferRes.json()

    if (!transferRes.ok || !transferData.status) {
      // Insufficient platform balance is the most common real-world failure —
      // surface it clearly so admin knows to fund the Paystack balance,
      // rather than a generic "transfer failed".
      const message = transferData.message || "Transfer failed"
      return NextResponse.json({ success: false, error: message, reference }, { status: 400 })
    }

    const transferStatus = transferData.data?.status as string | undefined

    // FIX: Paystack can return status "otp" when OTP-based transfer approval
    // is enabled on the account (a common fraud-prevention setting) — this
    // means the transfer is NOT complete yet, it's waiting on a manual OTP
    // finalization step via /transfer/finalize_transfer. The caller
    // previously treated ANY non-error response as success:true, so the
    // admin page immediately marked the withdrawal "completed" and emailed
    // the seller "paid" even though no money had actually moved. Surface
    // this distinctly so the admin page can show a real "needs OTP" state
    // instead of a false completion.
    if (transferStatus === "otp") {
      return NextResponse.json({
        success: false,
        requiresOtp: true,
        transferCode: transferData.data.transfer_code,
        error: "This transfer requires OTP approval in your Paystack dashboard before it completes. It has NOT been marked as paid.",
        reference,
      }, { status: 202 })
    }

    return NextResponse.json({
      success: true,
      transferCode: transferData.data?.transfer_code,
      transferStatus: transferStatus ?? "success", // "success" | "pending"
      reference,
    })
  } catch (err: any) {
    console.error("[payment/transfer] Paystack error:", err)
    return NextResponse.json({ success: false, error: err.message || "Transfer failed" }, { status: 500 })
  }
}

// ── Flutterwave: release funds already held in escrow ────────────────
// Called when the order's payment was collected with the escrow flag on
// (see initialize/route.ts). This does NOT create a new transfer — it
// tells Flutterwave "release the funds you're already holding for this
// transaction", which pays the seller's subaccount bank account directly
// and settles the platform's commission at the same time.
async function handleFlutterwaveEscrowRelease(params: {
  flwTransactionId: number | string
  reference: string
  orderId?: string
}) {
  const { flwTransactionId, reference, orderId } = params
  const secretKey = process.env.FLW_SECRET_KEY
  if (!secretKey) return NextResponse.json({ error: "FLW_SECRET_KEY not configured" }, { status: 500 })

  try {
    // FIX: idempotency guard. Unlike the Paystack transfer above, Flutterwave
    // has no cheap "check if this settle already happened" lookup by id alone
    // (verify_by_reference needs the tx_ref, and escrow/settle itself has no
    // side-effect-free dry-run). The reliable source of truth we already have
    // is our own D1 orders row — if escrow_status is already
    // released_to_seller, a second call here would be a real duplicate
    // release attempt (admin double-click, a retried request after a slow/
    // dropped response, etc.), not a legitimate new release. Skip the call
    // entirely in that case rather than hitting Flutterwave again.
    if (orderId) {
      try {
        const { d1Query } = await import("@/lib/d1")
        const rows = await d1Query(
          "SELECT status, escrow_status FROM orders WHERE id = ? LIMIT 1",
          [orderId],
        )
        const order = rows?.results?.[0] as Record<string, unknown> | undefined
        if (order && String(order.escrow_status ?? "") === "released_to_seller") {
          return NextResponse.json({
            success: true,
            alreadyProcessed: true,
            transferCode: String(flwTransactionId),
            transferStatus: "success",
            reference,
          })
        }
      } catch (err) {
        // Non-fatal — if the idempotency check itself fails (D1 blip), fall
        // through and attempt the release rather than blocking it entirely.
        // Flutterwave's own "not escrow" / already-settled response is the
        // fallback safety net in that case.
        console.error("[payment/transfer] idempotency check failed, proceeding with release attempt:", err)
      }
    }

    const res = await fetch("https://api.ravepay.co/v2/gpx/transactions/escrow/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: String(flwTransactionId),
        secret_key: secretKey,
      }),
    })
    const data = await res.json()

    if (!res.ok || data.status !== "success") {
      return NextResponse.json(
        { success: false, error: data.message || "Flutterwave escrow release failed", reference },
        { status: 400 },
      )
    }

    return NextResponse.json({
      success: true,
      transferCode: String(flwTransactionId),
      transferStatus: "success",
      reference,
    })
  } catch (err: any) {
    console.error("[payment/transfer] Flutterwave escrow release error:", err)
    return NextResponse.json({ success: false, error: err.message || "Escrow release failed" }, { status: 500 })
  }
}


// ── Flutterwave: standalone bank transfer (not tied to a held escrow) ─
// Used for a plain wallet-balance withdrawal that isn't linked to one
// specific escrowed order — same idea as the Paystack transfer above.
async function handleFlutterwaveTransfer(params: {
  amountKobo: number; accountNumber: string; bankCode: string
  reference: string; reason?: string
}) {
  const { amountKobo, accountNumber, bankCode, reference, reason } = params
  const secretKey = process.env.FLW_SECRET_KEY
  if (!secretKey) return NextResponse.json({ error: "FLW_SECRET_KEY not configured" }, { status: 500 })

  try {
    const res = await fetch("https://api.flutterwave.com/v3/transfers", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        account_bank:   bankCode,
        account_number: accountNumber,
        amount:         amountKobo / 100,   // Flutterwave uses Naira, not kobo
        currency:       "NGN",
        reference,
        narration:      reason || "Zamorax seller withdrawal",
      }),
    })
    const data = await res.json()

    if (!res.ok || data.status !== "success") {
      const message = data.message || "Transfer failed"
      return NextResponse.json({ success: false, error: message, reference }, { status: 400 })
    }

    const transferStatus = data.data?.status as string | undefined // "NEW" | "SUCCESSFUL" | "FAILED"

    return NextResponse.json({
      success: true,
      transferCode: String(data.data?.id ?? ""),
      transferStatus: transferStatus === "SUCCESSFUL" ? "success" : "pending",
      reference,
    })
  } catch (err: any) {
    console.error("[payment/transfer] Flutterwave transfer error:", err)
    return NextResponse.json({ success: false, error: err.message || "Transfer failed" }, { status: 500 })
  }
}

// ── Handler ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.error

  try {
    const {
      provider, amountKobo, accountName, accountNumber, bankCode,
      reference, reason, escrowTxRef, orderId,
    } = await req.json()

    if (!reference) {
      return NextResponse.json({ error: "Missing reference" }, { status: 400 })
    }

    if (provider === "flutterwave") {
      // If this payout is releasing a specific escrowed order payment,
      // escrowTxRef carries the Flutterwave transaction id captured at
      // verify-time (see verify/route.ts's flwTransactionId) — release it
      // instead of sending a brand-new transfer. orderId (if the caller has
      // it) enables the idempotency guard inside handleFlutterwaveEscrowRelease.
      if (escrowTxRef) {
        return await handleFlutterwaveEscrowRelease({ flwTransactionId: escrowTxRef, reference, orderId })
      }
      if (!amountKobo || !accountNumber || !bankCode) {
        return NextResponse.json({ error: "Missing required transfer fields" }, { status: 400 })
      }
      return await handleFlutterwaveTransfer({ amountKobo, accountNumber, bankCode, reference, reason })
    }

    // Default / explicit "paystack"
    if (!amountKobo || !accountNumber || !bankCode) {
      return NextResponse.json({ error: "Missing required transfer fields" }, { status: 400 })
    }
    return await handlePaystackTransfer({ amountKobo, accountName, accountNumber, bankCode, reference, reason })

  } catch (err: any) {
    console.error("[payment/transfer] Unexpected error:", err)
    return NextResponse.json({ success: false, error: err.message || "Transfer failed" }, { status: 500 })
  }
}
