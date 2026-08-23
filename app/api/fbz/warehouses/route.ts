// app/api/fbz/warehouses/route.ts
// Dedicated endpoint for FBZ drop-off/warehouse locations — split out from
// the generic /api/d1/query proxy so this table's read/write path is
// simple, direct, and easy to verify independently (no shared allowlist,
// table-extraction regex, or staff/public branching to reason through).
//
// GET  — list all warehouses (any authenticated user; sellers need this to
//        pick a nearest drop-off location, same trust level fbz_warehouses
//        already had in PUBLIC_TABLES on the old proxy)
// POST — create a warehouse (admin/moderator only)

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { d1Query } from "@/lib/d1"

type RouteContext = { params: Promise<Record<string, string>>; env?: { DB?: unknown } }

async function getSessionUser(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function getRole(uid: string, nativeDB?: unknown): Promise<string | null> {
  try {
    const result: any = await d1Query("SELECT role FROM users WHERE uid = ? LIMIT 1", [uid], nativeDB)
    const rows = result?.results ?? []
    return rows[0]?.role ?? null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  const nativeDB = (context as any)?.env?.DB

  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result: any = await d1Query(
      "SELECT id, name, address, phone, hours, state, city, is_active, current_stock, capacity, created_at, updated_at FROM fbz_warehouses ORDER BY created_at DESC",
      [],
      nativeDB,
    )
    const rows = result?.results ?? []
    return NextResponse.json({ results: rows })
  } catch (err) {
    console.error("[api/fbz/warehouses] GET failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  const nativeDB = (context as any)?.env?.DB

  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const role = await getRole(user.id, nativeDB)
  if (role !== "admin" && role !== "moderator") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const body = await req.json()
    const { name, address, phone, hours, state, city, isActive, capacity } = body as Record<string, unknown>

    if (!name || !address || !state || !city) {
      return NextResponse.json({ error: "name, address, state, and city are required" }, { status: 400 })
    }

    const id = crypto.randomUUID()
    await d1Query(
      `INSERT INTO fbz_warehouses
         (id, name, address, phone, hours, state, city, is_active, current_stock, capacity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))`,
      [
        id,
        name,
        address,
        phone ?? "",
        hours ?? "",
        state,
        city,
        isActive === false ? 0 : 1,
        typeof capacity === "number" ? capacity : 500,
      ],
      nativeDB,
    )

    return NextResponse.json({ id })
  } catch (err) {
    console.error("[api/fbz/warehouses] POST failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
