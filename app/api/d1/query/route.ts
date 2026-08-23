// app/api/d1/query/route.ts
// Internal server-side proxy for AdminService browser calls.
// NOTE: despite the "AdminService" name, this layer is used by buyers and
// sellers throughout the app (chats, listings, carts, reviews, etc.), not
// just the admin dashboard — so this route must allow any authenticated
// user through, while still keeping admin-only tables locked to admin/mod.
//
// SECURITY MODEL:
//  - All callers must be authenticated (valid Supabase session)
//  - Tables in ADMIN_ONLY_TABLES require role = admin | moderator (role read
//    from D1, the same source of truth requireAuth() uses — NOT the JWT
//    user_metadata, which can go stale if an admin is demoted in D1)
//  - PUBLIC_TABLES are readable/writable by any authenticated user with no
//    row scoping — these are tables with no per-user secrecy (listings,
//    categories, blog, banners, flash deals, etc.)
//  - OWNED_TABLES enforce row-level ownership: the server REWRITES every
//    SELECT/UPDATE/DELETE to inject "AND (<owner_col> = ?)" bound to the
//    verified session uid, and validates every INSERT sets the owner
//    column to the session uid. The client cannot override this — any
//    owner-column value the client sends is ignored/overwritten.
//  - JOIN-scoped tables (messages) are restricted to a single fixed query
//    shape so ownership can be verified via a subquery instead of a column.
//  - SQL is validated against an allowlisted table set — no arbitrary
//    table reads/writes. Parameterised queries only; no string
//    interpolation of user-supplied values.
//
// This proxy exists solely because CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN
// are server-only secrets and cannot be used from the browser bundle.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

// ── Tables with no per-user secrecy — any authenticated user, any row ────────
const PUBLIC_TABLES = new Set([
  "listings",
  "categories",
  "featured_banners",
  "site_banners", // header/footer promo banners — admin-managed, same trust level as featured_banners (gated client-side via RoleGuard, not here)
  "flash_deals",
  "group_buys",
  "bundles",
  "blog",
  "settings",
  "boosts",    // sellers create their own boost purchases; no per-row secrecy
  "adBoosts",  // same — seller-initiated, amount/status are not sensitive
  "fbz_warehouses", // admin-managed drop-off locations; sellers need to read
                    // the list to pick a nearest location, same trust level
                    // as featured_banners (gated client-side, not here)
])

// ── Tables scoped to a single owner column (or two, for buyer/seller pairs) ──
// On SELECT/UPDATE/DELETE the server injects "AND (col = ?[ OR col2 = ?])"
// bound to the session uid. On INSERT the server force-sets the owner
// column(s) to the session uid regardless of what the client sent.
// "selfOnly" columns (e.g. seller_id on offers) are NOT force-set on insert
// because the row legitimately belongs to a different party than the
// inserter (e.g. a buyer creates an offer addressed to a seller) — for
// those, ownership is enforced on read/update/delete only.
type OwnedTableRule = {
  columns: string[]            // owner column(s); session uid must match at least one
  insertForceColumn?: string   // column to force to session uid on INSERT (omit if N/A)
  readOnly?: boolean           // block INSERT/UPDATE/DELETE entirely — SELECT only, even for the owner
}

const OWNED_TABLES: Record<string, OwnedTableRule> = {
  orders:             { columns: ["buyer_id", "seller_id"] },
  chats:              { columns: ["buyer_id", "seller_id"] },
  notifications:      { columns: ["user_id"], insertForceColumn: "user_id" },
  reports:            { columns: ["reporter_id"], insertForceColumn: "reporter_id" },
  saved_listings:     { columns: ["user_id"], insertForceColumn: "user_id" },
  search_alerts:      { columns: ["user_id"], insertForceColumn: "user_id" },
  listing_qna:        { columns: ["asker_id"] }, // sellers also need to answer — see ANSWERABLE_TABLES below
  pending_payments:   { columns: ["user_id"], insertForceColumn: "user_id" },
  accepted_offers:    { columns: ["buyer_id"] },
  offers:             { columns: ["buyer_id", "seller_id"] },
  reviews:            { columns: ["reviewer_id"] }, // public read handled separately below
  recently_viewed:    { columns: ["user_id"], insertForceColumn: "user_id" },
  referrals:          { columns: ["referrer_id"] },
  agent_wallets:      { columns: ["user_id"] },
  wallet_transactions:{ columns: ["user_id"] },
  // FIX: this was `{ columns: ["id"] }`, but the actual D1 schema
  // (migrations/0001_baseline_schema.sql) defines seller_wallets with
  // `user_id TEXT PRIMARY KEY` — there is no "id" column on this table at
  // all. Every client-side write to seller_wallets (setDoc with merge, used
  // by OrdersService.releaseEscrow and the escrow-release cron job) builds
  // "INSERT ... ON CONFLICT(user_id) DO UPDATE ..." against the real PK,
  // but this proxy was scoping/rewriting against a nonexistent "id" column,
  // which made SQLite reject the ON CONFLICT target with "ON CONFLICT
  // clause does not match any PRIMARY KEY or UNIQUE constraint:
  // SQLITE_ERROR" — silently failing the wallet credit on every escrow
  // release that went through this proxy.
  seller_wallets:     { columns: ["user_id"] },
  pending_payouts:    { columns: ["user_id"] },
  // Sellers need to read their OWN withdrawal rows (transfer reference,
  // proof screenshot) from their earnings page — this was previously in
  // ADMIN_ONLY_TABLES, which blocks every non-staff caller outright with a
  // 403 before row-scoping is ever considered. That made it impossible for
  // a seller to see the proof/reference an admin attached when manually
  // marking a withdrawal paid — their only avenue was the confirmation
  // email, which they may never see if it's missed or lost. Moving it here
  // instead of just deleting it from ADMIN_ONLY_TABLES keeps write access
  // staff-only in practice (creation/approval always goes through the
  // admin dashboard's own auth-gated pages, not this generic proxy) while
  // opening safe, row-scoped read access: a seller can only ever see rows
  // where user_id = their own uid, per the OWNED_TABLES mechanism above —
  // never another seller's bank details or payout history.
  withdrawals:        { columns: ["user_id"], readOnly: true },
  users:              { columns: ["uid"] }, // self-serve profile/wallet updates only; row creation happens via dedicated auth routes, not this proxy
  // A follow row is written by the follower but references a seller who
  // isn't the owner (same pattern as offers/listing_qna) — reads are public
  // (follower counts / "who do I follow" need to see all rows), writes are
  // scoped to the follower's own rows.
  seller_follows:     { columns: ["follower_id"], insertForceColumn: "follower_id" },
  // Every image a seller/admin/moderator uploads gets a row here so it can
  // be reselected from the "My uploads" picker later instead of
  // re-uploading — see components/media/MediaLibraryPicker.tsx. Strictly
  // owner-scoped: nobody should see or reuse another user's uploads.
  media_library:      { columns: ["user_id"], insertForceColumn: "user_id" },
  // A seller creates a shipment request for their own listing (seller-facing
  // FBZ dashboard: app/(public)/dashboard/fbz) and needs to read back only
  // their own shipments. Admin actions — mark received, activate, reject —
  // happen from the admin FBZ dashboard and go through the isStaff bypass
  // above, so this scoping only ever applies to the seller's own requests.
  fbz_shipments:      { columns: ["seller_id"], insertForceColumn: "seller_id" },
}

// listing_qna and reviews have a public-read component (anyone viewing a
// listing should see its Q&A/reviews) but a private-write component (only
// the asker can ask, only the reviewer can edit/delete their own review).
// These tables are readable by anyone authenticated (like PUBLIC_TABLES)
// but writes are still scoped via OWNED_TABLES above.
const PUBLIC_READ_OWNED_WRITE_TABLES = new Set(["listing_qna", "reviews", "users", "seller_follows"])

// ── Tables that require role = admin | moderator ──────────────────────────
const ADMIN_ONLY_TABLES = new Set([
  "disputes",
  "payout_requests",
  "subscriptions",
  "verification_requests",
  "kv_store",
  "insurance_pool",
  // Referral agent payout requests — approve/pay/reject only happen via the
  // admin dashboard (app/(admin)/admin/agent-withdrawals), which reads/writes
  // this table through AdminService/this proxy directly (no dedicated server
  // route exists for admin actions). The agent-facing withdraw page never
  // reads this table itself — it only calls POST /api/agent/withdraw, a
  // requireAuth-gated server route — so this table needs no per-agent read
  // access here, just admin/moderator gating.
  "agent_withdrawals",
  // FIX: contact_messages was missing from every allowlist in this proxy,
  // so any table reference to it got a hard 403 before role was even
  // checked. Its only INSERT path is the separate /api/contact route
  // (which talks to D1 directly via server-only CF credentials, not this
  // proxy), so there's no public-insert case to carve out here — staff
  // read/update via /admin/messages and /moderator/messages is all this
  // table needs from this proxy, making ADMIN_ONLY_TABLES the right fit.
  "contact_messages",
])

// listing_reports: any authenticated user may INSERT (filing a report is a
// public action — see ReportListingModal, used by ordinary buyers), but
// only staff may SELECT/UPDATE the queue (moderation). It doesn't fit
// PUBLIC_TABLES (that would let anyone read/edit all reports), OWNED_TABLES
// (reporters shouldn't retain read/update access to their own filed
// reports — only staff should ever list or resolve them), or
// ADMIN_ONLY_TABLES (that blocks the public insert entirely). Handled as
// its own case below, same shape as the "messages" join-scoped exception.
const LISTING_REPORTS_TABLE = "listing_reports"

const ALLOWED_TABLES = new Set([
  ...PUBLIC_TABLES,
  ...Object.keys(OWNED_TABLES),
  ...ADMIN_ONLY_TABLES,
  "messages", // handled via dedicated join-scoped path below
  LISTING_REPORTS_TABLE, // handled via dedicated path below — public insert, staff-only read/update
])

// Extract all table names referenced in a SQL string
// Handles FROM x, JOIN x, INTO x, UPDATE x, DELETE FROM x
// IMPORTANT: "ON CONFLICT(...) DO UPDATE SET ..." (used by every upsert in
// this codebase) contains the literal word "UPDATE" immediately followed by
// "SET", not a table name — the old regex matched that and extracted a
// phantom "set" table, which isn't in any allowlist and caused every upsert
// (e.g. admin config saves via kv_store) to be rejected as "Table(s) not
// allowed: set". The negative lookahead below excludes that case.
function extractTables(sql: string): string[] {
  const tablePattern =
    /(?:FROM|JOIN|INTO|UPDATE(?!\s+SET\b)|TABLE)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/gi
  const matches: string[] = []
  let m: RegExpExecArray | null
  while ((m = tablePattern.exec(sql)) !== null) {
    matches.push(m[1].toLowerCase())
  }
  return matches
}

async function getSessionUser(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// D1 is the source of truth for role (matches lib/auth-server.ts) — NOT
// user_metadata on the JWT, which can go stale if a role changes in D1
// without the user re-authenticating.
async function getRoleFromD1(uid: string, nativeDB?: unknown): Promise<string | null> {
  try {
    const result = await d1Query("SELECT role FROM users WHERE uid = ? LIMIT 1", [uid], nativeDB)
    const rows = (result as any)?.results ?? []
    return rows[0]?.role ?? null
  } catch {
    return null
  }
}

function classifyStatement(sql: string): "select" | "insert" | "update" | "delete" | "pragma" | null {
  const m = /^\s*(select|insert|update|delete|pragma)\b/i.exec(sql)
  return (m?.[1]?.toLowerCase() as any) ?? null
}

export async function POST(req: NextRequest, context: RouteContext) {
  const nativeDB = (context as any)?.env?.DB

  // ── 1. Require authentication ─────────────────────────────────
  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const uid = user.id
  const role = await getRoleFromD1(uid, nativeDB)
  const isStaff = role === "admin" || role === "moderator"

  try {
    const body = await req.json()
    const { sql: rawSql, params } = body as { sql?: unknown; params?: unknown }

    if (typeof rawSql !== "string" || !rawSql.trim()) {
      return NextResponse.json({ error: "Missing sql" }, { status: 400 })
    }
    let sql = rawSql.trim()
    let vals: unknown[] = Array.isArray(params) ? [...params] : []

    const stmtType = classifyStatement(sql)
    if (!stmtType) {
      return NextResponse.json(
        { error: "Statement type not allowed through this proxy." },
        { status: 403 },
      )
    }
    // Block multi-statement injection and DDL/PRAGMA-write tricks riding along
    // with a write (e.g. "UPDATE x SET y=1; DROP TABLE x;").
    if (/;\s*\S/.test(sql.replace(/;\s*$/, ""))) {
      return NextResponse.json(
        { error: "Multiple statements are not allowed." },
        { status: 400 },
      )
    }

    // ── 2. Validate all referenced tables against allowlist ──────────
    const tables = extractTables(sql)
    const disallowed = tables.filter(t => !ALLOWED_TABLES.has(t))
    if (disallowed.length > 0) {
      console.warn("[api/d1/query] table not allowed", { sql, tables, disallowed, uid })
      return NextResponse.json(
        { error: `Table(s) not allowed: ${disallowed.join(", ")}` },
        { status: 403 },
      )
    }

    // Staff (admin/moderator) bypass row-level ownership scoping entirely —
    // they need full visibility for moderation/support, but still go
    // through the table/statement allowlist above.
    if (isStaff) {
      const result = await d1Query(sql, vals, nativeDB)
      const rows = (result as any)?.results ?? []
      return NextResponse.json({ results: rows })
    }

    const needsStaff = tables.some(t => ADMIN_ONLY_TABLES.has(t))
    if (needsStaff) {
      console.warn("[api/d1/query] staff-only table access denied", { sql, tables, uid, role })
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // ── listing_reports: public insert (file a report), staff-only read/update ──
    // Staff already returned above via the isStaff bypass, so anything reaching
    // here for this table is a non-staff caller — only INSERT is allowed, and
    // reporter_id is force-set to the session uid regardless of what was sent.
    if (tables.includes(LISTING_REPORTS_TABLE)) {
      if (stmtType !== "insert") {
        return NextResponse.json(
          { error: "Only staff may read or update listing_reports." },
          { status: 403 },
        )
      }
      const colMatch = /INSERT INTO listing_reports\s*\(([^)]+)\)/i.exec(sql)
      if (!colMatch) {
        return NextResponse.json({ error: "Malformed listing_reports insert." }, { status: 400 })
      }
      const cols = colMatch[1].split(",").map(c => c.trim().toLowerCase())
      const reporterIdx = cols.indexOf("reporter_id")
      if (reporterIdx === -1) {
        return NextResponse.json(
          { error: "listing_reports insert must include reporter_id." },
          { status: 400 },
        )
      }
      vals[reporterIdx] = uid // force-set reporter to session uid, ignore whatever client sent
      const result = await d1Query(sql, vals, nativeDB)
      return NextResponse.json({ results: (result as any)?.results ?? [] })
    }

    // ── 3. messages: join-scoped table, not column-owned ─────────────
    // Only allow the exact shape AdminService.subscribeToChat uses:
    //   SELECT/INSERT against messages WHERE chat_id = ?
    // and verify the caller is a participant of that chat before running it.
    if (tables.includes("messages")) {
      if (stmtType === "select") {
        const byChatId = /WHERE\s+chat_id\s*=\s*\?/i.test(sql)
        const byId = /WHERE\s+id\s*=\s*\?/i.test(sql)
        if (!byChatId && !byId) {
          return NextResponse.json(
            { error: "messages SELECT must filter by chat_id or id." },
            { status: 403 },
          )
        }
        if (byChatId) {
          const chatId = vals[0]
          const owns = await isChatParticipant(uid, String(chatId), nativeDB)
          if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
          const result = await d1Query(sql, vals, nativeDB)
          return NextResponse.json({ results: (result as any)?.results ?? [] })
        }
        // byId: look up the message's chat_id first, then verify membership.
        const messageId = vals[0]
        const lookup = await d1Query(
          "SELECT chat_id FROM messages WHERE id = ? LIMIT 1",
          [messageId],
          nativeDB,
        )
        const chatId = ((lookup as any)?.results ?? [])[0]?.chat_id
        if (!chatId) return NextResponse.json({ results: [] })
        const owns = await isChatParticipant(uid, String(chatId), nativeDB)
        if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        const result = await d1Query(sql, vals, nativeDB)
        return NextResponse.json({ results: (result as any)?.results ?? [] })
      }
      if (stmtType === "insert") {
        // Expect INSERT INTO messages (..., chat_id, sender_id, ...) VALUES (...)
        // Force sender_id to the session uid and verify chat membership.
        const colMatch = /INSERT INTO messages\s*\(([^)]+)\)/i.exec(sql)
        if (!colMatch) {
          return NextResponse.json({ error: "Malformed messages insert." }, { status: 400 })
        }
        const cols = colMatch[1].split(",").map(c => c.trim().toLowerCase())
        const chatIdx = cols.indexOf("chat_id")
        const senderIdx = cols.indexOf("sender_id")
        if (chatIdx === -1 || senderIdx === -1) {
          return NextResponse.json(
            { error: "messages insert must include chat_id and sender_id." },
            { status: 400 },
          )
        }
        const chatId = vals[chatIdx]
        const owns = await isChatParticipant(uid, String(chatId), nativeDB)
        if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        vals[senderIdx] = uid // force-set sender to session uid, ignore whatever client sent
        const result = await d1Query(sql, vals, nativeDB)
        return NextResponse.json({ results: (result as any)?.results ?? [] })
      }
      if (stmtType === "update") {
        // Only allow the exact shape acceptChatOffer/declineChatOffer use:
        //   UPDATE messages SET content = ?, updated_at = ? WHERE id = ?
        // Verify the caller is a participant of the chat that message belongs to.
        const idMatch = /WHERE\s+id\s*=\s*\?/i.test(sql)
        if (!idMatch) {
          return NextResponse.json(
            { error: "messages UPDATE must filter by id." },
            { status: 403 },
          )
        }
        const messageId = vals[vals.length - 1]
        const rows = await d1Query(
          "SELECT chat_id FROM messages WHERE id = ? LIMIT 1",
          [messageId],
          nativeDB,
        )
        const chatId = ((rows as any)?.results ?? [])[0]?.chat_id
        if (!chatId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        const owns = await isChatParticipant(uid, String(chatId), nativeDB)
        if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        const result = await d1Query(sql, vals, nativeDB)
        return NextResponse.json({ results: (result as any)?.results ?? [] })
      }
      return NextResponse.json({ error: "Operation not allowed on messages." }, { status: 403 })
    }

    // ── 4. Public tables — no row scoping needed ──────────────────────
    const isPublicTable = tables.every(t => PUBLIC_TABLES.has(t))
    const isPublicReadOwnedWrite =
      stmtType === "select" && tables.every(t => PUBLIC_READ_OWNED_WRITE_TABLES.has(t) || PUBLIC_TABLES.has(t))
    if (isPublicTable || isPublicReadOwnedWrite) {
      const result = await d1Query(sql, vals, nativeDB)
      return NextResponse.json({ results: (result as any)?.results ?? [] })
    }

    // ── 5. Owned tables — inject/verify row-level scoping ─────────────
    const ownedTable = tables.find(t => OWNED_TABLES[t])
    if (!ownedTable || tables.length !== 1) {
      console.warn("[api/d1/query] unsupported query shape", { sql, tables, uid })
      // Disallow joins across owned tables through this generic path —
      // each owned table must be queried on its own so scoping is unambiguous.
      return NextResponse.json(
        { error: "This query shape is not supported through the proxy." },
        { status: 403 },
      )
    }
    const rule = OWNED_TABLES[ownedTable]

    if (rule.readOnly && stmtType !== "select") {
      console.warn("[api/d1/query] write denied on read-only owned table", { sql, tables, uid })
      return NextResponse.json(
        { error: `${ownedTable} is read-only through this proxy — writes must go through a dedicated API route.` },
        { status: 403 },
      )
    }

    if (stmtType === "select" || stmtType === "update" || stmtType === "delete") {
      const ownerClause = rule.columns.map(c => `${ownedTable}.${c} = ?`).join(" OR ")
      const ownerVals = rule.columns.map(() => uid)

      // Inject as an additional AND-ed condition. Safe because we always
      // wrap the client's WHERE (if any) in parens and AND our own clause —
      // this can only narrow results, never widen them, regardless of what
      // the client's WHERE contains.
      if (/\bWHERE\b/i.test(sql)) {
        sql = sql.replace(/\bWHERE\b/i, `WHERE (${ownerClause}) AND (`).trimEnd()
        sql = sql.endsWith(";") ? sql.slice(0, -1) : sql
        // Close the paren we opened, before any trailing ORDER BY/LIMIT clause
        const tailMatch = /\b(ORDER BY|LIMIT|GROUP BY)\b/i.exec(sql)
        if (tailMatch) {
          const idx = tailMatch.index
          sql = sql.slice(0, idx) + ") " + sql.slice(idx)
        } else {
          sql = sql + ")"
        }
        // For UPDATE: SET placeholders come before WHERE in SQL, so owner vals
        // must be inserted between SET vals and the original WHERE val.
        // updateDoc always generates exactly 1 WHERE placeholder (WHERE id=?),
        // so ownerVals slot in right before the last element.
        if (stmtType === "update") {
          const whereVals = vals.slice(-1)
          const setVals = vals.slice(0, -1)
          vals = [...setVals, ...ownerVals, ...whereVals]
        } else {
          vals = [...ownerVals, ...vals]
        }
      } else {
        sql = sql.trimEnd()
        const tailMatch = /\b(ORDER BY|LIMIT|GROUP BY)\b/i.exec(sql)
        if (tailMatch) {
          const idx = tailMatch.index
          sql = sql.slice(0, idx) + ` WHERE (${ownerClause}) ` + sql.slice(idx)
        } else {
          sql = sql + ` WHERE (${ownerClause})`
        }
        vals = [...vals, ...ownerVals]
      }
    } else if (stmtType === "insert") {
      if (rule.insertForceColumn) {
        const colMatch = /INSERT (?:OR REPLACE )?INTO\s+\S+\s*\(([^)]+)\)/i.exec(sql)
        if (!colMatch) {
          return NextResponse.json({ error: "Malformed insert." }, { status: 400 })
        }
        const cols = colMatch[1].split(",").map(c => c.trim().toLowerCase())
        const idx = cols.indexOf(rule.insertForceColumn)
        if (idx === -1) {
          return NextResponse.json(
            { error: `Insert into ${ownedTable} must include ${rule.insertForceColumn}.` },
            { status: 400 },
          )
        }
        vals[idx] = uid // force-set owner column to session uid, ignore client value
      }
      // Tables without insertForceColumn (e.g. offers, where a buyer creates
      // a row addressed to a different seller) are allowed to insert with
      // client-supplied owner values, but read/update/delete remain scoped.
    }

    const result = await d1Query(sql, vals, nativeDB)
    return NextResponse.json({ results: (result as any)?.results ?? [] })
  } catch (err: any) {
    console.error("[api/d1/query]", err)
    return NextResponse.json({ error: err.message ?? "D1 query failed" }, { status: 500 })
  }
}

async function isChatParticipant(uid: string, chatId: string, nativeDB?: unknown): Promise<boolean> {
  try {
    const result = await d1Query(
      "SELECT 1 FROM chats WHERE id = ? AND (buyer_id = ? OR seller_id = ?) LIMIT 1",
      [chatId, uid, uid],
      nativeDB,
    )
    return ((result as any)?.results ?? []).length > 0
  } catch {
    return false
  }
}
