// lib/admin-fetch.ts
// Shared fetch wrapper for all admin/authenticated API calls.
// Gets a fresh Supabase access token before every request to avoid
// sending a stale JWT (Supabase tokens expire after 1 hour; the SDK
// refreshes in the background but can lag on idle/woken tabs).

import { createClient } from "@/lib/supabase/client"
import { fetchWithRetry, type FetchWithRetryOptions } from "@/lib/fetch-with-retry"

async function getFreshToken(): Promise<string | null> {
  const supabase = createClient()

  // refreshSession() forces a round-trip to Supabase Auth to get a
  // non-expired token, equivalent to Firebase's getIdToken(true).
  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session) return null
  return data.session.access_token
}

// This runs in the browser (admin panel), so it's the call most exposed
// to real-world flaky mobile connections. Defaults to retrying GET
// requests only — admin actions that change data (approve, ban, refund,
// etc.) are POST/PATCH/DELETE and won't auto-retry, since re-sending a
// write after an ambiguous network failure could double-apply it.
// Pass { retryUnsafe: true } at the call site for a write you know is
// safe to repeat (e.g. one your backend already treats idempotently).
export async function adminFetch(
  url: string,
  options: RequestInit = {},
  retryOpts?: FetchWithRetryOptions,
): Promise<Response> {
  const token = await getFreshToken()

  const authHeaders: Record<string, string> = {}
  if (token) authHeaders["Authorization"] = `Bearer ${token}`

  return fetchWithRetry(
    url,
    {
      ...options,
      credentials: "include",
      headers: {
        ...((options.headers as Record<string, string>) ?? {}),
        ...authHeaders,
      },
    },
    { retries: 3, timeoutMs: 10_000, ...retryOpts },
  )
}
