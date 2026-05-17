/**
 * Regression tests for the centralized readJson<T> error-handling contract
 * in api.ts:75-93 (issue #144, slice 7 — final slice).
 *
 * readJson<T> is not exported; tests exercise it through representative public
 * endpoints. All five code paths are covered:
 *
 *   Path A — 2xx: returns await response.json() as T
 *   Path B — non-2xx with parseable { error, details } body: throws `error + ' ' + details.join(' ')`
 *   Path C — non-2xx with parseable { error } body but no details (undefined or empty): throws `error`
 *   Path D — non-2xx with malformed/missing JSON body: throws `Request failed with status N`
 *   Path E — fetch rejects (network / abort): TypeError or DOMException propagates unchanged
 *
 * Additionally covers logoutOwner's special !ok-only invocation of readJson
 * (side-effect discard on 2xx, rethrow on non-2xx).
 *
 * Bug fix (issue #308): non-conforming 4xx JSON body (e.g. `{}` without an
 * `error` field) previously clobbered the fallback status message —
 * `new Error(undefined)` was thrown. Fixed and covered below.
 * Deferred: none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOwnerSession,
  loginOwner,
  logoutOwner,
} from './api'

// ---------------------------------------------------------------------------
// fetch stub setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Response-shaped stub consumable by readJson.
 * `json` is always a vi.fn() so tests can assert .toHaveBeenCalled() / .not.toHaveBeenCalled().
 */
function makeResponse({
  ok,
  status = ok ? 200 : 400,
  body,
  jsonError,
}: {
  ok: boolean
  status?: number
  body?: unknown
  jsonError?: Error
}): Response {
  const jsonMock = jsonError
    ? vi.fn().mockRejectedValue(jsonError)
    : vi.fn().mockResolvedValue(body)

  return { ok, status, json: jsonMock } as unknown as Response
}

// ---------------------------------------------------------------------------
// Path A — 2xx happy path (loginOwner)
// ---------------------------------------------------------------------------

describe('readJson — Path A: 2xx returns parsed body', () => {
  it('loginOwner resolves with the parsed AuthSessionResponse on 200', async () => {
    const sessionData = { token: 'tok-abc', user: { id: 'u1', email: 'a@example.com' } }
    const mockResponse = makeResponse({ ok: true, body: sessionData })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    const result = await loginOwner({ email: 'a@example.com', password: 'pw' })

    expect(result).toEqual(sessionData)
    // json must have been called to parse the body
    expect((mockResponse.json as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Path B — non-2xx with parseable error body and details
// ---------------------------------------------------------------------------

describe('readJson — Path B: non-2xx with { error, details }', () => {
  it('throws with error message joined with details when both are present', async () => {
    const mockResponse = makeResponse({
      ok: false,
      status: 400,
      body: { error: 'Invalid input', details: ['email missing', 'password too short'] },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(
      loginOwner({ email: '', password: '' }),
    ).rejects.toThrow('Invalid input email missing password too short')
  })

  it('single detail string is appended without extra punctuation', async () => {
    const mockResponse = makeResponse({
      ok: false,
      status: 400,
      body: { error: 'Invalid input', details: ['email missing'] },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(
      loginOwner({ email: '', password: '' }),
    ).rejects.toThrow('Invalid input email missing')
  })
})

// ---------------------------------------------------------------------------
// Path C — non-2xx with parseable error body but no details
// ---------------------------------------------------------------------------

describe('readJson — Path C: non-2xx with { error } and no details', () => {
  it('throws with only the error field when details is undefined', async () => {
    const mockResponse = makeResponse({
      ok: false,
      status: 401,
      body: { error: 'Not authorized' },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    const rejection = loginOwner({ email: 'a@example.com', password: 'bad' })
    await expect(rejection).rejects.toThrow('Not authorized')
    // No trailing space — message must be exactly the error string
    await expect(rejection).rejects.toSatisfy((e: Error) => e.message === 'Not authorized')
  })

  it('throws with only the error field when details is an empty array (join produces empty string)', async () => {
    const mockResponse = makeResponse({
      ok: false,
      status: 422,
      body: { error: 'Validation failed', details: [] },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    // details.join(' ') === '' which is falsy — must take the no-details branch
    await expect(
      loginOwner({ email: 'a@example.com', password: 'pw' }),
    ).rejects.toSatisfy((e: Error) => e.message === 'Validation failed')
  })

  it('500 server error propagates the error field unchanged (no special status handling)', async () => {
    const mockResponse = makeResponse({
      ok: false,
      status: 500,
      body: { error: 'Internal server error' },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(
      loginOwner({ email: 'a@example.com', password: 'pw' }),
    ).rejects.toThrow('Internal server error')
  })
})

// ---------------------------------------------------------------------------
// Path D — non-2xx with malformed / unparseable JSON body
// ---------------------------------------------------------------------------

describe('readJson — Path D: non-2xx with malformed JSON body', () => {
  it('falls back to "Request failed with status N" when json() rejects', async () => {
    const mockResponse = makeResponse({
      ok: false,
      status: 400,
      jsonError: new SyntaxError('Unexpected token < in JSON'),
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(
      loginOwner({ email: 'a@example.com', password: 'pw' }),
    ).rejects.toThrow('Request failed with status 400')
  })

  it('preserves the status code verbatim in the fallback message for 502', async () => {
    const mockResponse = makeResponse({
      ok: false,
      status: 502,
      jsonError: new SyntaxError('Bad gateway HTML response'),
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(
      fetchOwnerSession('tok', undefined),
    ).rejects.toThrow('Request failed with status 502')
  })
})

// ---------------------------------------------------------------------------
// Path E — fetch rejects (network / abort) — bypasses readJson entirely
// ---------------------------------------------------------------------------

describe('readJson — Path E: fetch rejection propagates unchanged', () => {
  it('network failure (TypeError) propagates from loginOwner unchanged', async () => {
    const networkError = new TypeError('Failed to fetch')
    vi.mocked(fetch).mockRejectedValueOnce(networkError)

    await expect(
      loginOwner({ email: 'a@example.com', password: 'pw' }),
    ).rejects.toThrow('Failed to fetch')

    // The propagated error must be the exact same instance (no wrapping)
    await expect(
      (async () => {
        vi.mocked(fetch).mockRejectedValueOnce(networkError)
        return loginOwner({ email: 'a@example.com', password: 'pw' })
      })(),
    ).rejects.toBe(networkError)
  })

  it('AbortError propagates from fetchOwnerSession unchanged', async () => {
    // DOMException with name 'AbortError' is what fetch throws on abort.
    // Using a stub here because wiring a real AbortController through a stubbed
    // fetch is more ceremony than signal: the stub never reads signal.aborted.
    const abortError = new DOMException('aborted', 'AbortError')
    vi.mocked(fetch).mockRejectedValueOnce(abortError)

    const rejection = fetchOwnerSession('tok', undefined)
    await expect(rejection).rejects.toThrow('aborted')
    await expect(rejection).rejects.toSatisfy((e: DOMException) => e.name === 'AbortError')
  })
})

// ---------------------------------------------------------------------------
// logoutOwner special contract
// ---------------------------------------------------------------------------

describe('logoutOwner — !ok-only readJson invocation', () => {
  it('2xx: resolves to undefined and does NOT call response.json()', async () => {
    const mockResponse = makeResponse({ ok: true, status: 204, body: undefined })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    const result = await logoutOwner('auth-token')

    expect(result).toBeUndefined()
    // Critical: json must NOT have been called — readJson is skipped on 2xx logout
    expect((mockResponse.json as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('4xx: rejects with the error message from the response body', async () => {
    const mockResponse = makeResponse({
      ok: false,
      status: 403,
      body: { error: 'Token expired' },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(logoutOwner('stale-token')).rejects.toThrow('Token expired')
  })

  it('4xx with malformed JSON falls back to status-based message', async () => {
    const mockResponse = makeResponse({
      ok: false,
      status: 500,
      jsonError: new SyntaxError('unexpected EOF'),
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(logoutOwner('auth-token')).rejects.toThrow('Request failed with status 500')
  })
})

// ---------------------------------------------------------------------------
// Bug fix #308 — non-conformant body shapes must not clobber the status fallback
// ---------------------------------------------------------------------------

describe('readJson — bug fix #308: non-conformant body shapes', () => {
  it('body {} on 400 falls back to "Request failed with status 400" (not "undefined")', async () => {
    const mockResponse = makeResponse({ ok: false, status: 400, body: {} })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(
      loginOwner({ email: 'a@example.com', password: 'pw' }),
    ).rejects.toThrow('Request failed with status 400')
  })

  it('body { message: "unauth" } on 401 ignores non-conformant field and falls back to status', async () => {
    // The ErrorResponse contract requires an `error` field; a `message` field is
    // non-conformant. The guard `errorBody.error != null` keeps errorMessage intact.
    const mockResponse = makeResponse({
      ok: false,
      status: 401,
      body: { message: 'unauth' },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(
      loginOwner({ email: 'a@example.com', password: 'pw' }),
    ).rejects.toThrow('Request failed with status 401')
  })

  it('body { details: ["x"] } on 400 falls back to status (details without error is non-conformant; dropped rather than synthesized)', async () => {
    // Synthesizing a message from `details` alone when `error` is absent would
    // be ambiguous and misleading. We drop `details` and keep the status fallback.
    const mockResponse = makeResponse({
      ok: false,
      status: 400,
      body: { details: ['x'] },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(
      loginOwner({ email: 'a@example.com', password: 'pw' }),
    ).rejects.toThrow('Request failed with status 400')
  })

  it('body { error: null } on 400 falls back to status — null is explicitly nullish (covers the != vs !== intent)', async () => {
    // `errorBody.error != null` catches both undefined (missing field) and
    // null (explicit null). Using `!= null` rather than `!== null` is intentional
    // so both values fall through to the status-code fallback.
    const mockResponse = makeResponse({
      ok: false,
      status: 400,
      body: { error: null },
    })
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

    await expect(
      loginOwner({ email: 'a@example.com', password: 'pw' }),
    ).rejects.toThrow('Request failed with status 400')
  })
})
