// src/services/providers/cloudflare/admin.ts
// ─────────────────────────────────────────────────────────────────
// WAS FIRESTORE → NOW CLOUDFLARE D1 (via Cloudflare D1 HTTP REST API)
// Replaces all onSnapshot() calls with fetch + polling pattern.
// TODO: add Durable Objects for realtime later
// ─────────────────────────────────────────────────────────────────

import type { IAdminService, FeaturedBanner } from "@/src/services/admin"
import type { FirestoreDoc } from "@/src/types"

// FIX: several tables use "order" as a real column name (categories,
// featured_banners, site_banners) but "order" is a reserved SQL keyword in
// SQLite. Every place that interpolates a column name into raw SQL —
// addDoc's INSERT, updateDoc's SET clauses, and buildSelectQuery's
// WHERE/ORDER BY — was doing so unquoted, so any write or query touching
// that column threw a silent syntax error (surfaced to the admin UI only as
// a generic "Failed to add banner", with the real D1 error swallowed by the
// catch block). SQLite reserved words are quoted here with double quotes;
// this is a small, fixed list rather than a full reserved-word table since
// "order" is the only one actually used as a column name anywhere in this
// schema today — extend the set if that ever changes.
const SQL_RESERVED_COLUMNS = new Set(["order", "group", "index", "table", "select", "where"])
function quoteCol(col: string): string {
  return SQL_RESERVED_COLUMNS.has(col.toLowerCase()) ? `"${col}"` : col
}

// FIX: the naive /([A-Z])/g -> "_$1" conversion inserts an underscore before
// EVERY capital letter, so a run of capitals (an acronym) gets split one
// letter at a time — "isFBZ" became "is_f_b_z" instead of "is_fbz", which
// broke every FBZ activation with "no such column: is_f_b_z: SQLITE_ERROR"
// even though the real column (is_fbz) exists. This treats a run of two or
// more consecutive capitals as a single acronym block (only underscoring
// before the block, not inside it), while still handling ordinary
// camelCase boundaries ("sellerId" -> "seller_id") the same as before.
function camelToSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z]+)/g, (_m, a, caps) => `${a}_${caps}`)
    .replace(/([A-Z]+)([A-Z][a-z])/g, (_m, caps, tail) => `${caps}_${tail}`)
    .toLowerCase()
}

// ── D1 HTTP helper ───────────────────────────────────────────────
export async function d1Query<T = Record<string, unknown>>(
  sql:    string,
  params: unknown[] = [],
): Promise<T[]> {
  if (typeof window !== "undefined") {
    const res = await fetch("/api/d1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
      cache: "no-store",
    })
    const json = await res.json() as any
    if (!res.ok) throw new Error(json?.error ?? `D1 proxy error (HTTP ${res.status})`)
    return (json.results ?? []) as T[]
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/d1/database/${process.env.CF_D1_DATABASE_ID}/query`

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.CF_API_TOKEN}`,
    },
    body: JSON.stringify({ sql, params }),
    cache: "no-store",
  })

  const json = await res.json() as any
  if (!json.success) {
    throw new Error(`D1 error: ${json.errors?.[0]?.message ?? "unknown"}`)
  }
  return (json.result?.[0]?.results ?? []) as T[]
}

function toIsoOrNull(v: unknown): string | null {
  if (!v) return null
  return String(v)
}

// ── Primary key resolution ────────────────────────────────────────
// Most tables use "id" as their primary key, but some use a different
// column (e.g. wallets keyed by user_id). getDoc/setDoc/updateDoc/deleteDoc/
// subscribeToDoc all need the correct PK column or every write against
// these tables silently fails ("no such column: id").
const PRIMARY_KEY_COLUMN: Record<string, string> = {
  users:                   "uid",
  seller_wallets:          "user_id",
  agent_wallets:           "user_id",
  logistics_agent_wallets: "user_id",
  agent_locations:         "agent_id",
  insurance_pool:          "month",
}
function pkColumn(table: string): string {
  return PRIMARY_KEY_COLUMN[table] ?? "id"
}

// ── updated_at column availability ────────────────────────────────
// addDoc/setDoc/updateDoc all used to unconditionally write "updated_at",
// but a large group of tables in migrations/0001_baseline_schema.sql were
// never given that column — only "created_at" (or, for insurance_pool,
// neither). Every write through this service against one of these tables
// threw "SQLITE_ERROR: table X has no column named updated_at", silently
// caught in some paths (getCollection/kvGet swallow into [] / null) and
// surfaced as a bare "Error" toast in others (e.g. the seller-follow
// button, first table this was traced through). Listed here exactly as
// found in the schema so every write path can skip the column on these.
const TABLES_WITHOUT_UPDATED_AT = new Set([
  "categories",
  "saved_listings",
  "messages",
  "offers",
  "accepted_offers",
  "wallet_transactions",
  "payout_requests",
  "refund_records",
  "agent_wallets",
  "logistics_agent_wallets",
  "logistics_agent_transactions",
  "notifications",
  "disputes",
  "reports",
  "listing_reports",
  "reviews",
  "listing_qna",
  "verification_requests",
  "zla_applications",
  "adBoosts",
  "boosts",
  "bundles",
  "featured_banners",
  "search_alerts",
  "subscriptions",
  "pending_payments",
  "insurance_pool",
  "seller_follows",
  "media_library", // has created_at only, no updated_at
])
function hasUpdatedAt(table: string): boolean {
  return !TABLES_WITHOUT_UPDATED_AT.has(table)
}
// categories and insurance_pool also have no created_at column.
const TABLES_WITHOUT_CREATED_AT = new Set(["categories", "agent_wallets", "logistics_agent_wallets", "insurance_pool"])
function hasCreatedAt(table: string): boolean {
  return !TABLES_WITHOUT_CREATED_AT.has(table)
}

function rowToDoc(row: Record<string, unknown>): FirestoreDoc {
  const doc: Record<string, unknown> = { id: row.id ?? row.uid }
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    doc[camel] = v
  }
  if (doc.createdAt) doc.createdAt = toIsoOrNull(doc.createdAt)
  if (doc.updatedAt) doc.updatedAt = toIsoOrNull(doc.updatedAt)
  const boolCols = ["isActive","isBanned","isBoosted","ninVerified","bvnVerified",
                    "phoneVerified","emailVerified","isSellerReady","isZamoraxPick","isOfficial"]
  // FIX: fbz_warehouses.is_active is already covered here (isActive), kept
  // for clarity — 0/1 from D1 is coerced to a real boolean below.
  for (const col of boolCols) if (col in doc) doc[col] = !!doc[col]

  // D1 stores JSON-shaped data (images, attributes, flash deals, delivery
  // options, order line items) as TEXT columns. Callers that go through a
  // dedicated service get these parsed already, but generic AdminService
  // reads (e.g. usePaginatedCollection on the seller dashboard) were handing
  // back raw JSON strings — so listing.images?.[0] silently returned "[" and
  // broke every image on the dashboard, and orders.lineItems.map(...) threw
  // "lineItems.map is not a function" on the seller orders page since a
  // non-empty JSON string passes `?? []` unchanged. Parse them here so every
  // consumer of the generic row mapper gets real arrays/objects.
  const jsonCols = ["images", "attributes", "flashDeal", "deliveryOptions", "lineItems"]
  for (const col of jsonCols) {
    if (typeof doc[col] === "string") {
      try { doc[col] = JSON.parse(doc[col] as string) } catch { /* leave as-is */ }
    }
  }

  // The listings table's price column is just "price" (kobo) — the Listing
  // type everywhere else in the app reads it as priceSale. Alias it so
  // generic reads match what ListingCard/SellerListingCard expect.
  if ("price" in doc && !("priceSale" in doc)) doc.priceSale = doc.price

  return doc as FirestoreDoc
}

// ── Polling helper ────────────────────────────────────────────────
// Polling intervals tuned to reduce D1 reads:
//   - Chat messages : 15s  (was 5s  — 3× fewer reads)
//   - Notifications : 60s  (was 15s — 4× fewer reads; broadcast handles instant delivery)
//   - User chats    : 30s  (was 10s — 3× fewer reads)
//   - Admin/general : 60s  (was 30s — 2× fewer reads)
//   - Banners       : 120s (was 60s — 2× fewer reads; almost never changes)
function poll(
  fetcher:  () => Promise<unknown[]>,
  callback: (docs: unknown[]) => void,
  interval  = 60_000,
  onError?: (err: unknown) => void,
): () => void {
  let active = true

  const run = async () => {
    if (!active) return
    try {
      callback(await fetcher())
    } catch (err) {
      // FIX: this used to swallow every fetch error into an empty list with
      // zero trace — a table/column mismatch would render as "no items yet"
      // in the UI instead of a visible error, which is exactly what happened
      // with fbz_warehouses (writes succeeded, the read-back query failed,
      // and the admin saw "No warehouse locations yet" instead of a reason
      // why). Always log to the console so the real D1 error is visible in
      // devtools even when a fallback empty list is still shown to the user.
      console.error("[AdminService.poll] fetch failed:", err)
      if (onError) {
        onError(err)
      } else {
        try { callback([]) } catch { /* ignore */ }
      }
    }
    if (active) setTimeout(run, interval)
  }

  run()
  return () => { active = false }
}

// ── Shared constraint → SQL builder ──────────────────────────────
function buildSelectQuery(table: string, constraints?: unknown[]): { sql: string; vals: unknown[] } {
  const toCol = (f: string) => quoteCol(camelToSnake(f))

  const wheres: string[] = []
  const vals: unknown[] = []
  let orderCol = "created_at"
  let orderDir = "DESC"
  let limitN: number | null = null

  for (const c of (constraints ?? []) as any[]) {
    if (!c) continue
    if ("field" in c && "op" in c) {
      const col = toCol(c.field === "__name__" ? "id" : c.field)
      if (c.op === "in" && Array.isArray(c.value)) {
        wheres.push(`${col} IN (${c.value.map(() => "?").join(",")})`)
        vals.push(...c.value)
      } else if (c.op === "array-contains") {
        wheres.push(`${col} LIKE ?`)
        vals.push(`%"${c.value}"%`)
      } else if (c.value === null && (c.op === "==" || c.op === "!=")) {
        wheres.push(c.op === "==" ? `${col} IS NULL` : `${col} IS NOT NULL`)
      } else {
        const opMap: Record<string, string> = { "==": "=", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=" }
        wheres.push(`${col} ${opMap[c.op] ?? "="} ?`)
        vals.push(typeof c.value === "boolean" ? (c.value ? 1 : 0) : c.value)
      }
    } else if ("field" in c && "dir" in c) {
      orderCol = toCol(c.field)
      orderDir = (c.dir ?? "asc").toUpperCase() === "DESC" ? "DESC" : "ASC"
    } else if ("limit" in c) {
      limitN = c.limit
    }
  }

  let sql = `SELECT * FROM ${table}`
  if (wheres.length) sql += ` WHERE ${wheres.join(" AND ")}`
  sql += ` ORDER BY ${orderCol} ${orderDir}`
  if (limitN) sql += ` LIMIT ${limitN}`

  return { sql, vals }
}

// ── kv_store helpers ──────────────────────────────────────────────
// FIX: Removed CREATE TABLE IF NOT EXISTS from every read/write.
// The table is created once at migration time — running DDL on every
// config fetch was adding an extra D1 write/check per request.

async function kvGet(docId: string): Promise<Record<string, unknown> | null> {
  try {
    const rows = await d1Query<{ value: string }>(
      `SELECT value FROM kv_store WHERE key = ? LIMIT 1`,
      [`config:${docId}`]
    )
    if (!rows[0]) return null
    return JSON.parse(rows[0].value)
  } catch {
    return null
  }
}

async function kvSet(docId: string, data: Record<string, unknown>): Promise<void> {
  const key = `config:${docId}`
  const now = new Date().toISOString()
  const value = JSON.stringify({ ...data, updatedAt: now })
  // UPSERT in one query — no extra SELECT needed
  await d1Query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now]
  )
}

// ── Implementation ────────────────────────────────────────────────

export const AdminService: IAdminService = {

  // ── Subscribe methods ─────────────────────────────────────────

  subscribeToFeaturedBanners(callback) {
    return poll(async () => {
      const rows = await d1Query("SELECT id, tag, title, subtitle, href, image_url, color, icon, \"order\", active FROM featured_banners WHERE active = 1 ORDER BY \"order\" ASC")
      return rows.map(r => ({
        id:       r.id,
        tag:      r.tag,
        title:    r.title,
        subtitle: r.subtitle,
        href:     r.href,
        imageUrl: r.image_url,
        color:    r.color,
        icon:     r.icon,
        order:    r.order,
        active:   !!r.active,
      } as FeaturedBanner))
    }, callback as any, 120_000) // banners rarely change — poll every 2 min
  },

  subscribeToUsers(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM users ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToListings(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM listings ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToOrders(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM orders ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToDisputes(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM disputes ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToWithdrawals(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM withdrawals ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToSubscriptions(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM subscriptions ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToBoosts(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM boosts ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToPendingPayouts(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM payout_requests WHERE status = 'pending' ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToPendingReports(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM reports WHERE status = 'pending' ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToSearchAlerts(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM search_alerts ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToActiveBundles(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM bundles WHERE is_active = 1 ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToVerificationRequests(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM verification_requests ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToPayoutRequests(callback) {
    return poll(
      async () => (await d1Query("SELECT * FROM payout_requests ORDER BY created_at DESC")).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToNotifications(userId, callback) {
    // FIX: was 15s — notifications use Supabase broadcast for instant delivery
    // so polling is just a fallback. 60s is fine.
    return poll(
      async () => (await d1Query(
        "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
        [userId]
      )).map(rowToDoc),
      callback as any,
      60_000,
    )
  },

  subscribeToChat(chatId, callback) {
    // FIX: was 5s — chat uses Supabase broadcast for instant delivery.
    // 15s polling is a safe fallback without hammering D1.
    return poll(
      async () => (await d1Query(
        "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT 200",
        [chatId]
      )).map(rowToDoc),
      callback as any,
      15_000,
    )
  },

  subscribeToUserChats(userId, callback) {
    // FIX: was 10s → 30s. Broadcast handles new message badges instantly.
    return poll(
      async () => (await d1Query(
        "SELECT * FROM chats WHERE buyer_id = ? OR seller_id = ? ORDER BY updated_at DESC LIMIT 50",
        [userId, userId]
      )).map(rowToDoc),
      callback as any,
      30_000,
    )
  },

  subscribeToCollection(path, callback, constraints, onError) {
    const table = camelToSnake(path).replace(/^_/, "")
    const { sql, vals } = buildSelectQuery(table, constraints)
    return poll(
      async () => (await d1Query(sql, vals)).map(rowToDoc),
      callback as any,
      60_000,
      // FIX: previously this always resolved to an empty list on error with
      // no way for the caller to know a query actually failed vs. the table
      // genuinely being empty. Now forwards the real Error to an optional
      // onError, still falling back to [] so existing callers don't break.
      (err) => {
        if (onError) onError(err instanceof Error ? err : new Error(String(err)))
        try { (callback as any)([]) } catch { /* ignore */ }
      },
    )
  },

  subscribeToCollectionWhere(path, field, op, value, callback) {
    const table  = camelToSnake(path).replace(/^_/, "")
    const col    = camelToSnake(field)
    const sqlOp  = op === "==" ? "=" : op
    return poll(
      async () => (await d1Query(`SELECT * FROM ${table} WHERE ${col} ${sqlOp} ? ORDER BY created_at DESC`, [value])).map(rowToDoc),
      callback as any,
      60_000,
      () => { try { (callback as any)([]) } catch { /* ignore */ } },
    )
  },

  subscribeToDoc(path, docId, callback, onError) {
    const table = camelToSnake(path).replace(/^_/, "")
    const pk    = pkColumn(table)
    return poll(async () => {
      try {
        const rows = await d1Query(`SELECT * FROM ${table} WHERE ${pk} = ? LIMIT 1`, [docId])
        callback(rows[0] ? rowToDoc(rows[0] as any) : null)
      } catch (err) {
        if (onError) onError(err as Error)
        else callback(null)
      }
      return []
    }, () => {}, 15_000)
  },

  // ── One-shot read/write methods ───────────────────────────────

  _ref_(path, constraints) {
    return { _collection: path, _constraints: constraints ?? [] } as any
  },

  async getCollection(path, constraints) {
    const table = camelToSnake(path).replace(/^_/, "")
    const { sql, vals } = buildSelectQuery(table, constraints)
    try {
      const rows = await d1Query(sql, vals)
      return rows.map(r => rowToDoc(r as any))
    } catch {
      return []
    }
  },

  async updateDoc(collectionPath, docId, data) {
    const table = camelToSnake(collectionPath).replace(/^_/, "")
    const now   = new Date().toISOString()
    const sets: string[] = hasUpdatedAt(table) ? ["updated_at = ?"] : []
    const vals: unknown[] = hasUpdatedAt(table) ? [now] : []

    // arrayUnion/arrayRemove need the current column value to merge against —
    // fetch the row once up front only if one of those sentinels is present.
    const needsCurrentRow = Object.values(data).some(
      (v: any) => v && typeof v === "object" && (v._type === "arrayUnion" || v._type === "arrayRemove")
    )
    let currentRow: Record<string, unknown> | null = null
    if (needsCurrentRow) {
      const rows = await d1Query(`SELECT * FROM ${table} WHERE ${pkColumn(table)} = ? LIMIT 1`, [docId])
      currentRow = (rows[0] as any) ?? null
    }

    for (const [k, v] of Object.entries(data)) {
      if (["updatedAt","updated_at","createdAt","created_at"].includes(k)) continue
      const col  = camelToSnake(k)
      const qcol = quoteCol(col) // for SQL fragments only — `col` (unquoted) still indexes currentRow as a plain JS object below

      // Firestore-shim sentinels (increment/arrayUnion/arrayRemove) were being
      // bound to SQL as raw {_type:...} objects, which SQLite/D1 stores as the
      // literal string "[object Object]" — that's what was breaking view counts
      // (listing.views showed as an object instead of a number everywhere it
      // was rendered). Handle each sentinel properly instead of passing it through.
      if (v && typeof v === "object" && (v as any)._type === "increment") {
        sets.push(`${qcol} = COALESCE(${qcol}, 0) + ?`)
        vals.push((v as any).n)
        continue
      }
      if (v && typeof v === "object" && (v as any)._type === "arrayUnion") {
        let arr: unknown[] = []
        try { arr = JSON.parse((currentRow?.[col] as string) ?? "[]") } catch { arr = [] }
        const merged = Array.from(new Set([...arr, ...(v as any).items]))
        sets.push(`${qcol} = ?`)
        vals.push(JSON.stringify(merged))
        continue
      }
      if (v && typeof v === "object" && (v as any)._type === "arrayRemove") {
        let arr: unknown[] = []
        try { arr = JSON.parse((currentRow?.[col] as string) ?? "[]") } catch { arr = [] }
        const toRemove = new Set((v as any).items)
        const filtered = arr.filter(item => !toRemove.has(item))
        sets.push(`${qcol} = ?`)
        vals.push(JSON.stringify(filtered))
        continue
      }

      sets.push(`${qcol} = ?`)
      vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v)
    }

    vals.push(docId)
    await d1Query(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${pkColumn(table)} = ?`, vals)
  },

  async addDoc(collectionPath, data) {
    const table = camelToSnake(collectionPath).replace(/^_/, "")
    const id    = crypto.randomUUID()
    const now   = new Date().toISOString()

    const cols: string[] = ["id"]
    const placeholders:  string[] = ["?"]
    const vals: unknown[] = [id]
    if (hasCreatedAt(table)) { cols.push("created_at"); placeholders.push("?"); vals.push(now) }
    if (hasUpdatedAt(table)) { cols.push("updated_at"); placeholders.push("?"); vals.push(now) }

    for (const [k, v] of Object.entries(data)) {
      if (["createdAt","updatedAt","created_at","updated_at"].includes(k)) continue
      const col = camelToSnake(k)
      cols.push(quoteCol(col))
      placeholders.push("?")
      vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v)
    }

    await d1Query(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders.join(",")})`,
      vals,
    )
    return { id }
  },

  async deleteDoc(collectionPath, docId) {
    const table = camelToSnake(collectionPath).replace(/^_/, "")
    await d1Query(`DELETE FROM ${table} WHERE ${pkColumn(table)} = ?`, [docId])
  },

  async setDoc(collectionPath, docId, data, options) {
    if (collectionPath === "config") {
      const existing = await kvGet(docId)
      if (options?.merge && existing) {
        await kvSet(docId, { ...existing, ...data })
      } else {
        await kvSet(docId, data)
      }
      return
    }

    const table = camelToSnake(collectionPath).replace(/^_/, "")
    const pk    = pkColumn(table)
    const now   = new Date().toISOString()

    // FIX: previously assumed every non-"id"-pk table (wallet-style tables
    // keyed by user_id/agent_id/month) has updated_at and every "id"-pk
    // table has both created_at and updated_at. Neither holds for all of
    // them — agent_wallets, logistics_agent_wallets, and insurance_pool
    // have NEITHER column, so every setDoc against them threw "no column
    // named updated_at" (or created_at). Use the same table metadata
    // addDoc/updateDoc rely on instead of guessing from the PK shape.
    const cols: string[] = [pk]
    const placeholders: string[] = ["?"]
    const vals: unknown[] = [docId]
    if (hasCreatedAt(table)) { cols.push("created_at"); placeholders.push("?"); vals.push(now) }
    if (hasUpdatedAt(table)) { cols.push("updated_at"); placeholders.push("?"); vals.push(now) }
    const updateSets: string[] = hasUpdatedAt(table) ? ["updated_at = ?"] : []
    const updateVals: unknown[] = hasUpdatedAt(table) ? [now] : []

    for (const [k, v] of Object.entries(data)) {
      if (["createdAt","updatedAt","created_at","updated_at"].includes(k)) continue
      const col = camelToSnake(k)
      cols.push(col)
      placeholders.push("?")
      const sqlVal = typeof v === "boolean" ? (v ? 1 : 0) : v
      vals.push(sqlVal)
      updateSets.push(`${col} = ?`)
      updateVals.push(sqlVal)
    }

    if (options?.merge) {
      await d1Query(
        `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders.join(",")})
         ON CONFLICT(${pk}) DO UPDATE SET ${updateSets.join(", ")}`,
        [...vals, ...updateVals],
      )
    } else {
      await d1Query(
        `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${placeholders.join(",")})`,
        vals,
      )
    }
  },

  async getDoc(collectionPath, docId) {
    if (collectionPath === "config") {
      return kvGet(docId) as any
    }

    const table = camelToSnake(collectionPath).replace(/^_/, "")
    try {
      const rows  = await d1Query(`SELECT * FROM ${table} WHERE ${pkColumn(table)} = ? LIMIT 1`, [docId])
      if (!rows[0]) return null
      return rowToDoc(rows[0] as any)
    } catch (err) {
      // Only a genuinely missing row should look like "not found" to callers.
      // A thrown error here (bad column, auth failure, proxy rejection, etc.)
      // was being silently converted to null, which made real bugs look like
      // "Seller not found" / "Listing not found" instead of surfacing the
      // actual problem in logs.
      console.error(`[AdminService.getDoc] ${table}/${docId} failed:`, err)
      throw err
    }
  },

  generateId() {
    return crypto.randomUUID()
  },

  batch() {
    const ops: Array<() => Promise<void>> = []
    return {
      set:    (ref: any, data: any) => { ops.push(() => AdminService.setDoc(ref._path, ref._id, data)); return null as any },
      update: (ref: any, data: any) => { ops.push(() => AdminService.updateDoc(ref._path, ref._id, data)); return null as any },
      delete: (ref: any)            => { ops.push(() => AdminService.deleteDoc(ref._path, ref._id)); return null as any },
      commit: async () => { for (const op of ops) await op() },
    } as any
  },
}
