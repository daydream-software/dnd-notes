/**
 * fetch wrapper that transparently retries while a tenant is waking from
 * scale-to-zero or paused for maintenance (part of epic #393).
 *
 * The activator (cold-start wake) and apps/api (maintenance write-gate) both
 * answer with `503 + Retry-After` and a recognizable marker when the request
 * could not be served *yet* but should be retried shortly. Crucially the marker
 * is emitted **before** the request reaches the tenant app, so no mutation has
 * happened — retrying is safe even for POST/PUT/PATCH.
 *
 * apiFetch honors Retry-After, retries within a bounded budget, respects the
 * caller's AbortSignal, and drives the "reconnecting" indicator. For every
 * other response (ok, non-retryable error) it is transparent: it returns the
 * Response untouched so the existing readJson<T> contract in api.ts is
 * unchanged.
 */

import { beginWakeRetry, endWakeRetry } from './wake-retry-status'

/** Markers that mean "not ready yet, retry" — extensible as new ones appear. */
export const RETRYABLE_WAKE_CODES = new Set<string>([
  'tenant_in_maintenance', // apps/api maintenance write-gate
  'tenant_waking', // activator cold-start (epic #393, future child)
])

/** Fallback wait when a retryable response carries no usable Retry-After. */
export const DEFAULT_RETRY_AFTER_MS = 2_000

/**
 * Total time budget across all retries for a single call. A blocked request
 * surfaces its error after this, rather than hanging indefinitely — bounded by
 * design even if the tenant takes longer (e.g. a long maintenance window).
 */
export const WAKE_RETRY_BUDGET_MS = 90_000

/**
 * Hard cap on retry attempts, independent of the time budget. Guards against a
 * burst of replayed requests when a server returns a very small or zero
 * Retry-After: the time budget alone does not bound request count when the
 * delay is ~0. Set above the ~45 attempts the 2s default would reach within the
 * budget, so it never clips a legitimate slow maintenance retry.
 */
export const WAKE_RETRY_MAX_ATTEMPTS = 50

/** Injectable dependencies — overridden in tests for deterministic timing. */
export interface ApiFetchDeps {
  fetch: typeof fetch
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  now: () => number
}

/**
 * Parse a Retry-After header (delta-seconds or HTTP-date) to milliseconds.
 * Returns null when absent or unparseable, so the caller can fall back.
 */
export function parseRetryAfter(header: string | null, nowMs: number = Date.now()): number | null {
  if (header == null || header.trim() === '') {
    return null
  }

  const seconds = Number(header)
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000)
  }

  const dateMs = Date.parse(header)
  if (!Number.isNaN(dateMs)) {
    // Relative to the injected clock so the HTTP-date branch is deterministic
    // under the deps contract.
    return Math.max(0, dateMs - nowMs)
  }

  return null
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }
    const onAbort = () => {
      clearTimeout(id)
      signal?.removeEventListener('abort', onAbort)
      reject(abortReason(signal))
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort)
  })
}

const defaultDeps: ApiFetchDeps = {
  fetch: (input, init) => globalThis.fetch(input, init),
  sleep: defaultSleep,
  now: () => Date.now(),
}

/**
 * When `response` is a retryable wake/maintenance 503, return the delay (ms)
 * before retrying; otherwise null. Reads the body via clone() so the original
 * stays intact for the caller's readJson.
 */
async function retryableDelayMs(response: Response, nowMs: number): Promise<number | null> {
  if (response.status !== 503) {
    return null
  }

  let marked = response.headers.get('X-Activator-Wake') === 'warming'
  if (!marked) {
    try {
      const body = (await response.clone().json()) as { code?: unknown; retryable?: unknown }
      marked =
        body?.retryable === true ||
        (typeof body?.code === 'string' && RETRYABLE_WAKE_CODES.has(body.code))
    } catch {
      // Non-JSON 503 body (e.g. an intermediary's HTML error page) — not a
      // recognized wake marker, so treat as non-retryable.
    }
  }

  if (!marked) {
    return null
  }

  return parseRetryAfter(response.headers.get('Retry-After'), nowMs) ?? DEFAULT_RETRY_AFTER_MS
}

/**
 * fetch with transparent wake/maintenance retry. Drop-in for fetch() in the
 * api.ts call sites.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  deps: ApiFetchDeps = defaultDeps,
): Promise<Response> {
  const signal = init.signal ?? undefined
  const deadline = deps.now() + WAKE_RETRY_BUDGET_MS
  let retrying = false
  let attempts = 0

  try {
    for (;;) {
      const response = await deps.fetch(input, init)
      if (response.ok) {
        return response
      }

      const delayMs = await retryableDelayMs(response, deps.now())
      if (delayMs === null) {
        // Not a wake/maintenance signal — hand the response back so readJson
        // throws the normal error.
        return response
      }

      // Stop on either bound: the time budget, or the attempt cap (which bounds
      // request fan-out even when Retry-After is ~0). Surface the 503 so
      // readJson throws rather than hanging.
      if (attempts >= WAKE_RETRY_MAX_ATTEMPTS || deps.now() + delayMs > deadline) {
        return response
      }

      if (!retrying) {
        retrying = true
        beginWakeRetry()
      }
      attempts += 1
      await deps.sleep(delayMs, signal) // rejects with the abort reason if aborted
    }
  } finally {
    if (retrying) {
      endWakeRetry()
    }
  }
}
