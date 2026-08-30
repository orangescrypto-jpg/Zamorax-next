import { NextRequest, NextResponse } from "next/server"

const RESEND_API = "https://api.resend.com/emails"
const FROM = "Zamorax <notifications@zamorax.com>"

type EmailTemplate = "order_confirmed" | "payment_received" | "dispute_opened" | "order_delivered" | "payout_sent"

const TEMPLATES: Record<EmailTemplate, (data: Record<string, string>) => { subject: string; html: string }> = {
  order_confirmed: (d) => ({
    subject: `Order Confirmed — #${d.orderId}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#0f172a">Your order is confirmed ✓</h2>
      <p>Hi ${d.name}, your order <strong>#${d.orderId}</strong> for <strong>${d.item}</strong> has been placed successfully.</p>
      <p>Amount: <strong>₦${d.amount}</strong> is held securely in escrow.</p>
      <p>The seller has been notified and will ship your item soon.</p>
      <a href="https://zamorax.com/dashboard/buyer/orders" style="display:inline-block;background:#f97316;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">Track Order</a>
    </div>`
  }),
  payment_received: (d) => ({
    subject: `Payment Received — ₦${d.amount}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#0f172a">Payment received ✓</h2>
      <p>Hi ${d.name}, ₦${d.amount} has been received for order <strong>#${d.orderId}</strong>.</p>
      <p>Funds are in escrow and will be released once the buyer confirms delivery.</p>
      <a href="https://zamorax.com/dashboard/seller/orders" style="display:inline-block;background:#f97316;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Order</a>
    </div>`
  }),
  dispute_opened: (d) => ({
    subject: `Dispute Opened — Order #${d.orderId}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#dc2626">A dispute has been opened</h2>
      <p>Hi ${d.name}, a dispute has been opened for order <strong>#${d.orderId}</strong>.</p>
      <p>Reason: ${d.reason}</p>
      <p>Our moderation team will review within 24 hours. Please provide any evidence through the platform.</p>
      <a href="https://zamorax.com/dashboard/buyer/disputes/new" style="display:inline-block;background:#f97316;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Dispute</a>
    </div>`
  }),
  order_delivered: (d) => ({
    subject: `Your order has arrived — #${d.orderId}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#0f172a">Order delivered 📦</h2>
      <p>Hi ${d.name}, your order <strong>#${d.orderId}</strong> for <strong>${d.item}</strong> has been marked as delivered.</p>
      <p>Please confirm receipt to release payment to the seller. You have <strong>48 hours</strong> before automatic release.</p>
      <a href="https://zamorax.com/dashboard/buyer/orders" style="display:inline-block;background:#f97316;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">Confirm Receipt</a>
    </div>`
  }),
  payout_sent: (d) => ({
    subject: `Payout Sent — ₦${d.amount}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#0f172a">Payout sent ✓</h2>
      <p>Hi ${d.name}, ₦${d.amount} has been sent to your ${d.bankName} account ending in ${d.accountLast4}.</p>
      <p>It may take 1-3 business days to reflect depending on your bank.</p>
    </div>`
  }),
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return NextResponse.json({ error: "Email not configured" }, { status: 503 })

  try {
    const { to, template, data } = await req.json() as { to: string; template: EmailTemplate; data: Record<string, string> }
    if (!to || !template || !TEMPLATES[template]) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

    const { subject, html } = TEMPLATES[template](data)
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    if (!res.ok) throw new Error(`Resend error: ${res.status}`)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
