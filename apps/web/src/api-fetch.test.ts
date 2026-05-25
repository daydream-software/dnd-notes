/**
 * Tests for apiFetch — transparent wake/maintenance retry (epic #393, issue #394).
 *
 * Timing is driven by injected deps (fetch/sleep/now) so the budget and
 * Retry-After honoring are deterministic without fake timers. `sleep` advances
 * a virtual clock so the retry budget is consumed exactly as in production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiFetch,
  parseRetryAfter,
  DEFAULT_RETRY_AFTER_MS,
  WAKE_RETRY_MAX_ATTEMPTS,
  type ApiFetchDeps,
} from './api-fetch'
import { isWakeRetryActive } from './wake-retry-status'

afterEach(() => {
  vi.restoreAllMocks()
})

interface FakeResponseInit {
  status: number
  body?: unknown
  retryAfter?: string
  warming?: boolean
}

function fakeResponse({ status, body, retryAfter, warming }: FakeResponseInit): Response {
  const headers = new Headers()
  if (retryAfter !== undefined) headers.set('Retry-After', retryAfter)
  if (warming) headers.set('X-Activator-Wake', 'warming')

  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
    // retryableDelayMs reads the marker off a clone so the original stays intact.
    clone: () => ({ json: async () => body }) as unknown as Response,
  } as unknown as Response
}

/**
 * Build injectable deps that serve `responses` in order (repeating the last),
 * record the sleep durations, and advance a virtual clock by each slept ms.
 */
function makeDeps(responses: Response[]) {
  let index = 0
  let clock = 0
  const sleeps: number[] = []

  const deps: ApiFetchDeps = {
    fetch: vi.fn(async () => responses[Math.min(index++, responses.length - 1)]),
    sleep: vi.fn(async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('aborted', 'AbortError')
      }
      sleeps.push(ms)
      clock += ms
    }),
    now: () => clock,
  }

  return { deps, sleeps }
}

const maintenance503 = (retryAfter?: string) =>
  fakeResponse({ status: 503, body: { code: 'tenant_in_maintenance', error: 'paused' }, retryAfter })

describe('parseRetryAfter', () => {
  it('parses delta-seconds to milliseconds', () => {
    expect(parseRetryAfter('5')).toBe(5000)
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('returns null for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
  })

  it('parses an HTTP-date relative to the injected clock (deterministic)', () => {
    const now = Date.parse('2026-05-25T12:00:00Z')
    const future = new Date(now + 30_000).toUTCString()
    expect(parseRetryAfter(future, now)).toBe(30_000)
    // A past date clamps to 0 rather than going negative.
    expect(parseRetryAfter(new Date(now - 60_000).toUTCString(), now)).toBe(0)
  })
})

describe('apiFetch', () => {
  it('returns a 2xx response immediately without retrying', async () => {
    const { deps, sleeps } = makeDeps([fakeResponse({ status: 200, body: { ok: true } })])

    const response = await apiFetch('/api/x', {}, deps)

    expect(response.status).toBe(200)
    expect(sleeps).toEqual([])
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(isWakeRetryActive()).toBe(false)
  })

  it('passes a non-503 error response straight through (no retry)', async () => {
    const { deps, sleeps } = makeDeps([fakeResponse({ status: 400, body: { error: 'bad' } })])

    const response = await apiFetch('/api/x', {}, deps)

    expect(response.status).toBe(400)
    expect(sleeps).toEqual([])
    expect(deps.fetch).toHaveBeenCalledTimes(1)
  })

  it('passes an unmarked 503 straight through (not a wake/maintenance signal)', async () => {
    const { deps, sleeps } = makeDeps([fakeResponse({ status: 503, body: { error: 'down' } })])

    const response = await apiFetch('/api/x', {}, deps)

    expect(response.status).toBe(503)
    expect(sleeps).toEqual([])
    expect(isWakeRetryActive()).toBe(false)
  })

  it('honors Retry-After on a maintenance 503 and returns the eventual success', async () => {
    const { deps, sleeps } = makeDeps([maintenance503('5'), fakeResponse({ status: 200, body: { ok: true } })])

    const response = await apiFetch('/api/notes', { method: 'POST', body: '{}' }, deps)

    expect(response.status).toBe(200)
    expect(sleeps).toEqual([5000])
    expect(deps.fetch).toHaveBeenCalledTimes(2)
    expect(isWakeRetryActive()).toBe(false)
  })

  it('falls back to the default delay when a warming 503 carries no Retry-After', async () => {
    const { deps, sleeps } = makeDeps([
      fakeResponse({ status: 503, body: {}, warming: true }),
      fakeResponse({ status: 200, body: { ok: true } }),
    ])

    const response = await apiFetch('/api/x', {}, deps)

    expect(response.status).toBe(200)
    expect(sleeps).toEqual([DEFAULT_RETRY_AFTER_MS])
  })

  it('surfaces the 503 once the retry budget is exhausted instead of hanging', async () => {
    // Retry-After 60s, budget 90s: one sleep, then the next wait would overrun
    // the budget, so the 503 is returned for readJson to throw.
    const { deps, sleeps } = makeDeps([maintenance503('60')])

    const response = await apiFetch('/api/x', {}, deps)

    expect(response.status).toBe(503)
    expect(sleeps).toEqual([60000])
    expect(deps.fetch).toHaveBeenCalledTimes(2)
    expect(isWakeRetryActive()).toBe(false)
  })

  it('caps total attempts even when Retry-After is zero (bounds request fan-out)', async () => {
    // Retry-After: 0 means the virtual clock never advances, so the time budget
    // alone would never stop the loop — the attempt cap must.
    const { deps, sleeps } = makeDeps([maintenance503('0')])

    const response = await apiFetch('/api/x', {}, deps)

    expect(response.status).toBe(503)
    expect(sleeps).toHaveLength(WAKE_RETRY_MAX_ATTEMPTS)
    expect(deps.fetch).toHaveBeenCalledTimes(WAKE_RETRY_MAX_ATTEMPTS + 1)
    expect(isWakeRetryActive()).toBe(false)
  })

  it('marks the retry indicator active while waiting and clears it when done', async () => {
    let activeDuringSleep = false
    const { deps } = makeDeps([maintenance503('5'), fakeResponse({ status: 200, body: {} })])
    const innerSleep = deps.sleep
    deps.sleep = vi.fn(async (ms: number, signal?: AbortSignal) => {
      activeDuringSleep = isWakeRetryActive()
      return innerSleep(ms, signal)
    })

    await apiFetch('/api/x', {}, deps)

    expect(activeDuringSleep).toBe(true)
    expect(isWakeRetryActive()).toBe(false)
  })

  it('aborts a pending retry and clears the indicator', async () => {
    const controller = new AbortController()
    const { deps } = makeDeps([maintenance503('5'), fakeResponse({ status: 200, body: {} })])
    // Abort during the first wait.
    deps.sleep = vi.fn(async (_ms: number, signal?: AbortSignal) => {
      controller.abort(new DOMException('aborted', 'AbortError'))
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('aborted', 'AbortError')
      }
    })

    await expect(
      apiFetch('/api/x', { signal: controller.signal }, deps),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(isWakeRetryActive()).toBe(false)
  })
})
