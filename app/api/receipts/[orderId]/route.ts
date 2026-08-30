// app/api/receipts/[orderId]/route.ts
// Usage: GET /api/receipts/<orderId>
// Returns a downloadable PDF receipt

export const dynamic = "force-dynamic"

import { AdminService } from "@/src/services"

import { NextRequest, NextResponse } from "next/server"

function formatNaira(kobo: number): string {
  return `NGN ${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`
}

function formatDate(ts: { toDate?: () => Date } | string | number | null): string {
  try {
    const d = ts && typeof ts === "object" && (ts as any).toDate ? (ts as any).toDate() : new Date(ts as string | number)
    return d.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })
  } catch { return "—" }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  try {
    const orderSnap = await AdminService.getDoc("orders", orderId)
    if (!orderSnap) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    const order = orderSnap

    // Build clean receipt data
    const itemPrice   = order.itemPrice   || 0
    const totalAmount = order.totalAmount || itemPrice
    const receiptNo   = `ZMX-${orderId.slice(0, 8).toUpperCase()}`

    // ── Generate PDF using html → buffer approach (no reportlab dependency) ──
    // We return a self-contained HTML that the browser can print/save as PDF,
    // OR if you install `@puppeteer/browsers` or `html-pdf-node` on the server
    // you can render it server-side. For now we return HTML with print styles.

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Receipt ${receiptNo}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 40px; max-width: 680px; margin: auto; }
  .logo { font-size: 22px; font-weight: 800; color: #f97316; letter-spacing: -0.5px; }
  .logo span { color: #1a1a1a; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #f1f5f9; }
  .receipt-meta { text-align: right; }
  .receipt-meta h2 { font-size: 18px; font-weight: 700; color: #1a1a1a; }
  .receipt-meta p { font-size: 12px; color: #64748b; margin-top: 2px; }
  .badge { display: inline-block; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; margin-top: 6px; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 10px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .party h3 { font-size: 12px; font-weight: 700; margin-bottom: 4px; }
  .party p { font-size: 12px; color: #475569; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; }
  thead th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; border-bottom: 1px solid #e2e8f0; }
  thead th:last-child { text-align: right; }
  tbody td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
  tbody td:last-child { text-align: right; }
  .totals { margin-top: 8px; }
  .totals tr td { border: none; padding: 5px 12px; }
  .totals .total-row td { font-weight: 700; font-size: 15px; border-top: 2px solid #1a1a1a; padding-top: 10px; }
  .fee { color: #ef4444; }
  .escrow-note { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-top: 24px; }
  .escrow-note p { font-size: 12px; color: #1e40af; line-height: 1.5; }
  .escrow-note strong { font-weight: 700; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #f1f5f9; text-align: center; }
  .footer p { font-size: 11px; color: #94a3b8; line-height: 1.6; }
  @media print {
    body { padding: 20px; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="logo">ZAMOR<span>AX</span></div>
    <p style="font-size:11px;color:#94a3b8;margin-top:4px;">Nigeria's Trusted Marketplace</p>
  </div>
  <div class="receipt-meta">
    <h2>RECEIPT</h2>
    <p>${receiptNo}</p>
    <p>${formatDate(order.createdAt)}</p>
    <div class="badge">✓ ${order.status?.replace(/_/g, " ").toUpperCase() || "COMPLETED"}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Parties</div>
  <div class="parties">
    <div class="party">
      <h3>Buyer</h3>
      <p>
        ${order.buyerName || "—"}<br/>
        ${order.buyerEmail || ""}
      </p>
    </div>
    <div class="party">
      <h3>Seller</h3>
      <p>
        ${order.sellerName || order.sellerStoreName || "—"}<br/>
        ${order.sellerEmail || ""}
      </p>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Order Details</div>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Type</th>
        ${order.orderType === "rental" ? "<th>Rental Period</th>" : ""}
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${order.itemTitle || "—"}</td>
        <td style="text-transform:capitalize">${order.orderType || "Purchase"}</td>
        ${order.orderType === "rental" && order.rentalStart ? `
        <td>${formatDate(order.rentalStart)} — ${formatDate(order.rentalEnd)}</td>
        ` : ""}
        <td>${formatNaira(itemPrice)}</td>
      </tr>
    </tbody>
    <tbody class="totals">
      <tr class="total-row">
        <td colspan="${order.orderType === "rental" ? 3 : 2}">Total Paid</td>
        <td>${formatNaira(totalAmount)}</td>
      </tr>
    </tbody>
  </table>
</div>

${order.trackingNumber ? `
<div class="section">
  <div class="section-title">Delivery</div>
  <p style="font-size:13px;">Tracking number: <strong>${order.trackingNumber}</strong></p>
</div>
` : ""}

<div class="escrow-note">
  <p>
    <strong>🔒 Escrow Protected</strong> — This transaction was secured by Zamorax Escrow.
    Payment was held safely and released only after buyer confirmation.
    Order ID: ${orderId}
  </p>
</div>

<div class="footer">
  <p>
    Thank you for trading safely on Zamorax.<br/>
    For support: support@zamorax.com · zamorax.com<br/>
    This receipt was automatically generated and is valid without a signature.
  </p>
</div>

<div class="no-print" style="text-align:center;margin-top:32px;">
  <button onclick="window.print()" style="background:#f97316;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
    🖨 Print / Save as PDF
  </button>
</div>

</body>
</html>`

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="Zamorax-Receipt-${receiptNo}.html"`,
      },
    })
  } catch (e: any) {
    console.error("Receipt generation error:", e)
    return NextResponse.json({ error: "Could not generate receipt" }, { status: 500 })
  }
}
