/**
 * Named rate-limit middleware factories for the tenant API.
 *
 * Each factory creates a fresh rateLimit() instance with its own in-memory
 * store. Call these once per Express app instance (in the app factory), not
 * at module scope, so test isolation is preserved.
 *
 * Policy summary:
 *   auth-register   5 req / 15 min  — brute-force protection for account creation
 *   auth-login      5 req / 15 min  — brute-force protection for credential auth
 *   auth-logout     30 req / 15 min — logout is cheap but still bounded
 *   shared-join     10 req / 10 min — guest join is per-IP across all share links
 *   shared-claim    5 req / 15 min  — membership claim is sensitive
 *   write           100 req / 15 min — authenticated write operations (POST/PUT/DELETE)
 *   read            300 req / 15 min — authenticated read operations (GET)
 *
 * All limits are configurable via environment variables:
 *   RATE_LIMIT_WINDOW_MS       — window length in milliseconds (default varies per policy)
 *   RATE_LIMIT_AUTH_MAX        — max requests for auth endpoints (default 5)
 *   RATE_LIMIT_WRITE_MAX       — max requests for write endpoints (default 100)
 *   RATE_LIMIT_READ_MAX        — max requests for read endpoints (default 300)
 *
 * Headers: standardHeaders 'draft-6' emits RateLimit-* and Retry-After on 429.
 */

import { rateLimit, type Options as RateLimitOptions } from 'express-rate-limit'

/**
 * Parse a non-negative integer from an environment variable.
 *
 * Returns `fallback` when:
 *   - the variable is absent or empty, OR
 *   - the value is not a finite number (e.g. "abc", "NaN"), OR
 *   - the value is negative.
 *
 * Explicitly allows 0 — operators may intentionally disable a limit by setting
 * the variable to "0". For this to have the intended effect, callers must route
 * through makeRateLimiter (or apply the equivalent skip workaround themselves),
 * because express-rate-limit v8 treats limit=0 as "block every request" rather
 * than "no limit".
 */
export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const normalized = raw?.trim()
  if (normalized === undefined || normalized === '') return fallback
  const parsed = Number(normalized)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

const defaultWindowMs = readPositiveIntEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000)
const authMax = readPositiveIntEnv('RATE_LIMIT_AUTH_MAX', 5)
const writeMax = readPositiveIntEnv('RATE_LIMIT_WRITE_MAX', 100)
const readMax = readPositiveIntEnv('RATE_LIMIT_READ_MAX', 300)

const rateLimitDefaults: Partial<RateLimitOptions> = {
  standardHeaders: 'draft-6',
  legacyHeaders: false,
}

export function makeRateLimiter(options: Partial<RateLimitOptions>) {
  // express-rate-limit v8 treats limit=0 as "block everything".
  // Preserve the documented "0 disables limiting" semantics.
  if (options.limit === 0) {
    return rateLimit({ ...rateLimitDefaults, ...options, limit: 1, skip: () => true })
  }
  return rateLimit({ ...rateLimitDefaults, ...options })
}

export function createAuthRegisterLimiter() {
  return makeRateLimiter({
    windowMs: defaultWindowMs,
    limit: authMax,
    message: { error: 'Too many registration attempts. Please wait before trying again.' },
  })
}

export function createAuthLoginLimiter() {
  return makeRateLimiter({
    windowMs: defaultWindowMs,
    limit: authMax,
    message: { error: 'Too many login attempts. Please wait before trying again.' },
  })
}

export function createAuthLogoutLimiter() {
  return makeRateLimiter({
    windowMs: defaultWindowMs,
    limit: 30,
    message: { error: 'Too many logout attempts. Please wait before trying again.' },
  })
}

export function createSharedJoinLimiter() {
  return makeRateLimiter({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    message: { error: 'Too many guest join attempts. Please wait before trying again.' },
  })
}

export function createSharedClaimLimiter() {
  return makeRateLimiter({
    windowMs: defaultWindowMs,
    limit: authMax,
    message: { error: 'Too many membership claim attempts. Please wait before trying again.' },
  })
}

export function createWriteLimiter() {
  return makeRateLimiter({
    windowMs: defaultWindowMs,
    limit: writeMax,
    message: { error: 'Too many requests. Please wait before trying again.' },
  })
}

export function createReadLimiter() {
  return makeRateLimiter({
    windowMs: defaultWindowMs,
    limit: readMax,
    message: { error: 'Too many requests. Please wait before trying again.' },
  })
}
