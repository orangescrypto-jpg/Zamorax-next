// lib/formDraft.ts
// Generic localStorage draft save/restore for long multi-step forms, so a
// browser reload / crash / accidental back-navigation doesn't wipe out
// everything the user typed. Client-side only — every call is a no-op
// during SSR since localStorage doesn't exist there.

const PREFIX = "zamorax_draft_"

function isBrowser(): boolean {
  return typeof window !== "undefined"
}

export function saveDraft<T>(key: string, data: T): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }))
  } catch {
    // Storage full or disabled (private browsing) — drafts are a
    // convenience, not a requirement, so fail silently.
  }
}

export function loadDraft<T>(key: string, maxAgeMs = 1000 * 60 * 60 * 24 * 7): T | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { data: T; savedAt: number }
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > maxAgeMs) {
      clearDraft(key)
      return null
    }
    return parsed.data ?? null
  } catch {
    return null
  }
}

export function clearDraft(key: string): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}
