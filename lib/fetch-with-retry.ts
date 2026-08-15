// lib/fetch-with-retry.ts
// Shared network resilience helper. Wraps fetch() with:
//   1. A timeout (fetch alone will hang forever on a dead connection —
//      common on 2G/3G Nigerian networks where a request neither
//      succeeds nor fails, it just stalls).
//   2. Automatic retry with exponential backoff + jitter, but ONLY for
//      failures that are actually safe/likely to be transient
//      (network drop, timeout, 502/503/504). We never retry 4xx client
//      errors (bad request, auth failure, validation) since retrying
//      those just repeats the same failure.
//   3. Retry is skipped by default for non-idempotent methods (POST,
//      PATCH, DELETE) unless the caller explicitly opts in, since
//      blindly retrying "create shipment" or "charge card" on a flaky
//      connection can double-submit. GET/HEAD retry by default.
//
// Usage:
//   const res = await fetchWithRetry(url, { method: "GET" })
//   const res = await fetchWithRetry(url, { method: "POST", body }, { retryUnsafe: true })

export interface FetchWithRetryOptions {
  /** Max attempts including the first try. Default 3. */
  retries?: number
  /** Per-attempt timeout in ms. Default 10000 (10s). */
  timeoutMs?: number
  /** Base delay in ms for exponential backoff. Default 500. */
  baseDelayMs?: number
  /** Allow retrying non-idempotent methods (POST/PATCH/DELETE). Default false. */
  retryUnsafe?: boolean
}

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"])
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Adds jitter so many parallel requests don't retry in lockstep (thundering herd). */
function backoffDelay(attempt: number, baseDelayMs: number) {
  const exp = baseDelayMs * 2 ** attempt
  const jitter = Math.random() * baseDelayMs
  return exp + jitter
}

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    retries = 3,
    timeoutMs = 10_000,
    baseDelayMs = 500,
    retryUnsafe = false,
  } = opts

  const method = (init.method ?? "GET").toUpperCase()
  const canRetry = retryUnsafe || IDEMPOTENT_METHODS.has(method)

  let lastError: unknown

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController()
    // If the caller already passed a signal, respect it alongside ours.
    const externalSignal = init.signal
    const onExternalAbort = () => controller.abort()
    externalSignal?.addEventListener("abort", onExternalAbort)

    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(input, { ...init, signal: controller.signal })
      clearTimeout(timeout)
      externalSignal?.removeEventListener("abort", onExternalAbort)

      // Success or a non-retryable status — return as-is and let the
      // caller handle res.ok / error body, same as a plain fetch() would.
      if (res.ok || !canRetry || !RETRYABLE_STATUS.has(res.status)) {
        return res
      }

      // Retryable status (e.g. 503 while a server restarts) — only
      // retry if we have attempts left, otherwise return the response
      // so the caller sees the real failure instead of a thrown error.
      if (attempt === retries - 1) return res

      await sleep(backoffDelay(attempt, baseDelayMs))
      continue
    } catch (err) {
      clearTimeout(timeout)
      externalSignal?.removeEventListener("abort", onExternalAbort)
      lastError = err

      const isAbort = err instanceof Error && err.name === "AbortError"
      const isLastAttempt = attempt === retries - 1

      if (!canRetry || isLastAttempt) {
        if (isAbort) {
          throw new Error(
            `Request timed out after ${timeoutMs}ms (${method} ${String(input)})`,
          )
        }
        throw err
      }

      await sleep(backoffDelay(attempt, baseDelayMs))
    }
  }

  // Unreachable in practice, but keeps TypeScript happy.
  throw lastError instanceof Error ? lastError : new Error("fetchWithRetry failed")
}
