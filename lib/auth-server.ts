// lib/auth-server.ts  — REPLACE EXISTING FILE
// Server-side auth helpers for API routes.
// Verifies Supabase session from cookies, looks up role from D1.

import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { d1Query } from "@/lib/d1"

// ── Build a Supabase client from a raw NextRequest (no next/headers) ──────────
function buildSupabaseFromRequest(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll() {
          // Read-only in API route context — session refresh handled by middleware
        },
      },
    },
  )
}

// adminFetch (lib/admin-fetch.ts) forces a fresh Supabase token before every
// admin request specifically to dodge a stale/expired session cookie — but
// buildSupabaseFromRequest above only ever reads cookies, so that fresh
// token was silently ignored and a request could still fail on a cookie
// that lagged behind. If the client sent "Authorization: Bearer <token>",
// verify that token directly via getUser(token) instead of falling back to
// cookies — this is the token adminFetch just refreshed, so it's the more
// current credential when both are present.
async function getUserFromRequest(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization")
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null

  const supabase = buildSupabaseFromRequest(req)

  if (bearerToken) {
    const { data, error } = await supabase.auth.getUser(bearerToken)
    if (!error && data.user) return { user: data.user, error: null }
    // Bearer token present but invalid/expired — fall through to cookies
    // rather than failing outright, in case the cookie session is still good.
  }

  const { data, error } = await supabase.auth.getUser()
  return { user: data.user, error }
}

// ── Role lookup from D1 ───────────────────────────────────────────────────────
// nativeDB: pass context.env.DB from the calling route when running on
// Cloudflare Pages so this uses the native binding instead of the HTTP API.
async function getRoleByUid(uid: string, nativeDB?: unknown): Promise<string | null> {
  try {
    const result = await d1Query("SELECT role FROM users WHERE uid = ? LIMIT 1", [uid], nativeDB)
    const rows = (result as any)?.results ?? []
    return rows[0]?.role ?? null
  } catch {
    return null
  }
}

// ── Auth result type ──────────────────────────────────────────────────────────
type AuthResult =
  | { ok: true;  uid: string; role: string; error: null }
  | { ok: false; uid: null;   role: null;   error: NextResponse }

// ── Core resolver ─────────────────────────────────────────────────────────────
async function requireRole(req: NextRequest, allowedRoles: string[], nativeDB?: unknown): Promise<AuthResult> {
  const { user, error } = await getUserFromRequest(req)

  if (error || !user) {
    return {
      ok: false, uid: null, role: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  // Role is stored in user_metadata (set on register) AND in D1.
  // Use D1 as source of truth so admins can change roles without re-registering.
  const role = await getRoleByUid(user.id, nativeDB)

  if (!role || !allowedRoles.includes(role)) {
    return {
      ok: false, uid: null, role: null,
      error: NextResponse.json(
        { error: "Unauthorized", required: allowedRoles.join(" or "), got: role ?? "none" },
        { status: 401 },
      ),
    }
  }

  return { ok: true, uid: user.id, role, error: null }
}

// ── Public helpers ────────────────────────────────────────────────────────────
// nativeDB is optional — omit it on Vercel, pass context.env.DB on Cloudflare Pages.

export async function requireAdmin(req: NextRequest, nativeDB?: unknown): Promise<AuthResult> {
  return requireRole(req, ["admin"], nativeDB)
}

export async function requireModerator(req: NextRequest, nativeDB?: unknown): Promise<AuthResult> {
  return requireRole(req, ["admin", "moderator"], nativeDB)
}

export async function requireAuth(req: NextRequest, nativeDB?: unknown): Promise<AuthResult> {
  const { user, error } = await getUserFromRequest(req)

  if (error || !user) {
    return {
      ok: false, uid: null, role: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const role = await getRoleByUid(user.id, nativeDB)
  if (!role) {
    return {
      ok: false, uid: null, role: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  return { ok: true, uid: user.id, role, error: null }
}
