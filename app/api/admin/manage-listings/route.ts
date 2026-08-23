// app/api/admin/manage-listings/route.ts
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin, requireModerator } from "@/lib/auth-server"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

function rowToListing(row: Record<string, unknown>) {
  let images: string[] = []
  try { images = JSON.parse(row.images as string ?? "[]") } catch { images = [] }
  return {
    id:           row.id,
    sellerId:     row.seller_id,
    sellerName:   row.seller_name,
    title:        row.title,
    description:  row.description,
    priceSale:    Number(row.price) || 0,
    categorySlug: row.category,
    condition:    row.condition,
    images,
    status:       row.status,
    isBoosted:    !!row.is_boosted,
    isZamoraxPick: !!row.is_zamorax_pick,
    isOfficial:   !!row.is_zamorax_pick || !!row.seller_is_official,
    fulfilledBy:  String(row.fulfilled_by ?? "seller"),
    city:         row.seller_state,
    views:        Number(row.views) || 0,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireModerator(req)
  if (!auth.ok) return auth.error

  const nativeDB = (context as any)?.env?.DB
  const { searchParams } = new URL(req.url)

  const status = searchParams.get("status") ?? "all"  // all | pending | active | rejected
  const search = searchParams.get("search")?.trim() ?? ""
  const page   = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10))
  const limit  = 20

  const wheres: string[] = []
  const vals:   unknown[] = []

  if (status !== "all") { wheres.push("listings.status = ?"); vals.push(status) }
  if (search) {
    wheres.push("(listings.title LIKE ? OR listings.seller_name LIKE ?)")
    vals.push(`%${search}%`, `%${search}%`)
  }

  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : ""

  try {
    const [countResult, rowsResult] = await Promise.all([
      d1Query(`SELECT COUNT(*) as total FROM listings ${where}`, vals, nativeDB),
      d1Query(
        `SELECT listings.*, (SELECT is_official FROM users WHERE users.uid = listings.seller_id) AS seller_is_official
         FROM listings ${where} ORDER BY listings.created_at DESC LIMIT ? OFFSET ?`,
        [...vals, limit, page * limit], nativeDB,
      ),
    ])

    const countRows = (countResult as any)?.results ?? []
    const rows       = (rowsResult as any)?.results ?? []

    const total    = Number(countRows[0]?.total ?? 0)
    const listings = rows.map((r: any) => rowToListing(r))

    return NextResponse.json({ listings, total, page, limit, hasMore: (page + 1) * limit < total })
  } catch (err: any) {
    console.error("[admin/manage-listings]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/admin/manage-listings?id=xxx
export async function DELETE(req: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.error

  const nativeDB = (context as any)?.env?.DB
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  try {
    await d1Query("DELETE FROM listings WHERE id = ?", [id], nativeDB)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/admin/manage-listings — approve, reject, boost
export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireModerator(req)
  if (!auth.ok) return auth.error

  const nativeDB = (context as any)?.env?.DB

  try {
    const { id, action, reason } = await req.json()
    if (!id || !action) return NextResponse.json({ error: "id and action required" }, { status: 400 })

    const now = new Date().toISOString()

    if (action === "approve") {
      // FBZ listings need a second gate — stock must be received and
      // activated at the warehouse (see /api/fbz/shipments/[id]/activate)
      // before the listing can go live, in addition to this normal content
      // review. If this listing was created with FBZ chosen and stock
      // hasn't been activated yet, approving here only clears the content
      // side and holds it at 'pending_fbz_stock' instead of going straight
      // to 'active'. A non-FBZ listing (or one whose stock is already
      // activated) goes straight to 'active' as before.
      const current = await d1Query(
        "SELECT status, is_fbz FROM listings WHERE id = ? LIMIT 1",
        [id], nativeDB,
      )
      const row = (current as any)?.results?.[0]
      const isFbzPending = row?.status === "pending_fbz"
      const stockAlreadyActivated = !!row?.is_fbz

      const nextStatus = (isFbzPending && !stockAlreadyActivated) ? "pending_fbz_stock" : "active"
      await d1Query(
        "UPDATE listings SET status = ?, updated_at = ? WHERE id = ?",
        [nextStatus, now, id], nativeDB,
      )
    } else if (action === "reject") {
      await d1Query(
        "UPDATE listings SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?",
        [reason ?? "", now, id], nativeDB,
      )
    } else if (action === "boost") {
      const boostExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await d1Query(
        "UPDATE listings SET is_boosted = 1, boost_expires_at = ?, updated_at = ? WHERE id = ?",
        [boostExpires, now, id], nativeDB,
      )
    } else if (action === "unboost") {
      await d1Query(
        "UPDATE listings SET is_boosted = 0, boost_expires_at = NULL, updated_at = ? WHERE id = ?",
        [now, id], nativeDB,
      )
    } else if (action === "zamorax_pick") {
      // Showcase this listing under Zamorax Direct without reassigning
      // ownership/payouts. It's removed from the seller's normal
      // store/search while picked — see migration 0002 and
      // /api/listings/official.
      await d1Query(
        "UPDATE listings SET is_zamorax_pick = 1, updated_at = ? WHERE id = ?",
        [now, id], nativeDB,
      )

      try {
        const listingRow = await d1Query(
          "SELECT title, seller_id FROM listings WHERE id = ?", [id], nativeDB,
        )
        const listing = (listingRow as any)?.results?.[0]
        if (listing?.seller_id) {
          await d1Query(
            `INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at, updated_at)
             VALUES (?, ?, 'system', ?, ?, ?, 0, ?, ?)`,
            [
              crypto.randomUUID(),
              listing.seller_id,
              "🛡️ Listing added to Zamorax Enterprises Direct",
              `Your listing "${listing.title ?? "your item"}" is now featured under Zamorax Enterprises Direct on the homepage.`,
              `/dashboard/seller/listings`,
              now, now,
            ],
            nativeDB,
          )
        }
      } catch { /* non-blocking — pick already succeeded */ }
    } else if (action === "zamorax_unpick") {
      await d1Query(
        "UPDATE listings SET is_zamorax_pick = 0, updated_at = ? WHERE id = ?",
        [now, id], nativeDB,
      )

      // Unpicking ends this listing's official status UNLESS the seller
      // account itself is still independently official (in which case the
      // listing stays official through that, and any Zamorax-fulfillment
      // lock should stand). Only reset fulfilled_by when neither is true
      // anymore.
      const stillOfficialRow = await d1Query(
        `SELECT users.is_official AS seller_is_official
         FROM listings LEFT JOIN users ON users.uid = listings.seller_id
         WHERE listings.id = ?`,
        [id], nativeDB,
      )
      const stillOfficial = !!(stillOfficialRow as any)?.results?.[0]?.seller_is_official
      if (!stillOfficial) {
        await d1Query(
          "UPDATE listings SET fulfilled_by = 'seller', updated_at = ? WHERE id = ?",
          [now, id], nativeDB,
        )
      }
    } else if (action === "set_fulfilled_by_seller" || action === "set_fulfilled_by_zamorax") {
      // Sets the listing's default fulfillment owner. New orders for this
      // listing inherit this value (see createOrder in
      // src/services/providers/cloudflare/orders.ts). Restricted to
      // listings Zamorax actually fulfills — admin-picked (is_zamorax_pick),
      // official-seller (users.is_official), or FBZ-activated (is_fbz,
      // regardless of seller status — a non-official seller can still send
      // individual listings to FBZ while fulfilling others themselves via
      // meetup) — same rule as marking an individual order shipped (see
      // app/api/admin/orders/[id]/ship). This does not touch any existing
      // order, and never affects payout — seller_payout / escrow release
      // are untouched either way.
      const listingRow = await d1Query(
        `SELECT listings.is_zamorax_pick, listings.is_fbz, users.is_official AS seller_is_official
         FROM listings LEFT JOIN users ON users.uid = listings.seller_id
         WHERE listings.id = ?`,
        [id], nativeDB,
      )
      const listing = (listingRow as any)?.results?.[0]
      const isZamoraxFulfilled = !!listing?.is_zamorax_pick || !!listing?.seller_is_official || !!listing?.is_fbz
      if (!isZamoraxFulfilled) {
        return NextResponse.json(
          { error: "Fulfillment can only be set on official listings, official-seller listings, or FBZ-activated listings." },
          { status: 403 },
        )
      }
      const fulfilledBy = action === "set_fulfilled_by_zamorax" ? "zamorax" : "seller"
      await d1Query(
        `UPDATE listings
         SET fulfilled_by = ?, fulfillment_set_by = ?, fulfillment_set_at = ?, updated_at = ?
         WHERE id = ?`,
        [fulfilledBy, auth.uid, now, now, id], nativeDB,
      )
    } else if (action === "set_fbz_free_delivery" || action === "unset_fbz_free_delivery") {
      // delivery_fee_override_kobo = 0 means "buyer sees free delivery
      // regardless of state/weight" (see LogisticsService.calculateFee
      // callers in BuyNowModal/CartCheckoutModal). Restricted to the same
      // Zamorax-fulfilled set as set_fulfilled_by_* above — a listing
      // Zamorax doesn't actually fulfill has no delivery fee to override.
      const listingRow = await d1Query(
        `SELECT listings.is_zamorax_pick, listings.is_fbz, users.is_official AS seller_is_official
         FROM listings LEFT JOIN users ON users.uid = listings.seller_id
         WHERE listings.id = ?`,
        [id], nativeDB,
      )
      const listing = (listingRow as any)?.results?.[0]
      const isZamoraxFulfilled = !!listing?.is_zamorax_pick || !!listing?.seller_is_official || !!listing?.is_fbz
      if (!isZamoraxFulfilled) {
        return NextResponse.json(
          { error: "Free delivery can only be set on official listings, official-seller listings, or FBZ-activated listings." },
          { status: 403 },
        )
      }
      const overrideValue = action === "set_fbz_free_delivery" ? 0 : null
      await d1Query(
        "UPDATE listings SET delivery_fee_override_kobo = ?, updated_at = ? WHERE id = ?",
        [overrideValue, now, id], nativeDB,
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
