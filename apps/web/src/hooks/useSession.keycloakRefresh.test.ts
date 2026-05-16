/**
 * Regression tests for useSession.startKeycloakRefresh (issue #144, slice 3).
 *
 * Covers:
 *   - Three guard paths that return undefined early
 *   - Active refresh success (tokens persisted to localStorage + state updated)
 *   - Active refresh failure (clearSession + onError called)
 *   - Multiple interval ticks (refresh called on each)
 *   - Cleanup cancels an in-flight success (setAuthToken NOT called with new token)
 *   - Cleanup cancels an in-flight failure (clearSession/onError NOT called)
 *   - Cleanup stops further intervals (no more refresh calls after cancel)
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authTokenStorageKey,
  keycloakTokensStorageKey,
  useSession,
} from './useSession'
import type { RuntimeKeycloakClient, StoredKeycloakTokens } from '../keycloak-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildKeycloakAuthConfig() {
  return {
    mode: 'keycloak' as const,
    keycloak: {
      url: 'https://auth.example.com',
      realm: 'dnd-notes',
      clientId: 'dnd-notes-web',
    },
  }
}

function buildFakeTokens(suffix = ''): StoredKeycloakTokens {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    idToken: `id-${suffix}`,
  }
}

// Build a fake RuntimeKeycloakClient with a controllable refresh function.
// Use the interface type for refresh so callers can pass `vi.fn().mockResolvedValue(...)`
// without widening it to `Mock<Procedure | Constructable>` (which fails strict assignment
// to RuntimeKeycloakClient at the keycloakClientRef.current = fakeClient site).
function buildFakeClient(
  refreshFn: RuntimeKeycloakClient['refresh'] = vi.fn(async () => buildFakeTokens('new')),
): RuntimeKeycloakClient {
  return {
    init: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: refreshFn,
    clear: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useSession — startKeycloakRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  // -------------------------------------------------------------------------
  // Guard paths — return undefined
  // -------------------------------------------------------------------------

  describe('guard: returns undefined', () => {
    it('returns undefined when authConfig is not keycloak mode', () => {
      const { result } = renderHook(() => useSession())
      // authConfig defaults to null — not keycloak mode
      const cleanup = result.current.startKeycloakRefresh(vi.fn(), vi.fn())
      expect(cleanup).toBeUndefined()
    })

    it('returns undefined when authConfig is keycloak but authToken is not set', async () => {
      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        // Deliberately do NOT call setAuthToken
      })

      const cleanup = result.current.startKeycloakRefresh(vi.fn(), vi.fn())
      expect(cleanup).toBeUndefined()
    })

    it('returns undefined when authConfig and authToken are set but keycloakClientRef.current is null', async () => {
      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        result.current.setAuthToken('existing-token')
        // Deliberately do NOT set keycloakClientRef.current
      })

      const cleanup = result.current.startKeycloakRefresh(vi.fn(), vi.fn())
      expect(cleanup).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Active refresh — success path
  // -------------------------------------------------------------------------

  describe('active refresh — success', () => {
    it('calls refresh(30), persists both localStorage keys, and updates authToken after 15s', async () => {
      const newTokens = buildFakeTokens('new')
      const fakeClient = buildFakeClient(vi.fn().mockResolvedValue(newTokens))
      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        result.current.setAuthToken('initial-token')
        result.current.keycloakClientRef.current = fakeClient
      })

      let cleanup: (() => void) | undefined
      act(() => {
        cleanup = result.current.startKeycloakRefresh(vi.fn(), vi.fn())
      })

      expect(cleanup).toBeTypeOf('function')

      // Advance 15s and flush microtasks via the Async variant
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
      })

      expect(fakeClient.refresh).toHaveBeenCalledOnce()
      expect(fakeClient.refresh).toHaveBeenCalledWith(30)

      // Both localStorage keys must be written
      expect(localStorage.getItem(keycloakTokensStorageKey)).toBe(
        JSON.stringify(newTokens),
      )
      expect(localStorage.getItem(authTokenStorageKey)).toBe(newTokens.accessToken)

      // React state must also be updated
      expect(result.current.authToken).toBe(newTokens.accessToken)

      cleanup!()
    })
  })

  // -------------------------------------------------------------------------
  // Active refresh — failure path
  // -------------------------------------------------------------------------

  describe('active refresh — failure', () => {
    it('calls clearSession and onError with the session-expired message when refresh rejects', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const fakeClient = buildFakeClient(
        vi.fn().mockRejectedValue(new Error('token expired')),
      )
      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        result.current.setAuthToken('initial-token')
        result.current.keycloakClientRef.current = fakeClient
      })

      const clearSession = vi.fn()
      const onError = vi.fn()

      let cleanup: (() => void) | undefined
      act(() => {
        cleanup = result.current.startKeycloakRefresh(clearSession, onError)
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
      })

      expect(fakeClient.refresh).toHaveBeenCalledOnce()
      expect(clearSession).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith('Your session expired. Sign in again.')
      expect(consoleErrorSpy).toHaveBeenCalledOnce()

      cleanup!()
    })
  })

  // -------------------------------------------------------------------------
  // Multiple ticks
  // -------------------------------------------------------------------------

  describe('multiple interval ticks', () => {
    it('calls refresh on each 15s tick', async () => {
      const fakeClient = buildFakeClient(
        vi.fn().mockResolvedValue(buildFakeTokens('tick')),
      )
      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        result.current.setAuthToken('initial-token')
        result.current.keycloakClientRef.current = fakeClient
      })

      let cleanup: (() => void) | undefined
      act(() => {
        cleanup = result.current.startKeycloakRefresh(vi.fn(), vi.fn())
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })

      expect(fakeClient.refresh).toHaveBeenCalledTimes(2)

      cleanup!()
    })
  })

  // -------------------------------------------------------------------------
  // Cleanup — cancels in-flight success
  // -------------------------------------------------------------------------

  describe('cleanup — cancels in-flight success', () => {
    it('does not call setAuthToken with the new token if cleanup is called before resolve', async () => {
      // Use a deferred promise so we control when refresh resolves
      let resolveRefresh!: (tokens: StoredKeycloakTokens) => void
      const pendingRefresh = new Promise<StoredKeycloakTokens>((res) => {
        resolveRefresh = res
      })
      const fakeClient = buildFakeClient(vi.fn().mockReturnValue(pendingRefresh))
      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        result.current.setAuthToken('initial-token')
        result.current.keycloakClientRef.current = fakeClient
      })

      const initialToken = result.current.authToken

      let cleanup: (() => void) | undefined
      act(() => {
        cleanup = result.current.startKeycloakRefresh(vi.fn(), vi.fn())
      })

      // Fire the interval synchronously — refresh(30) is called, promise stays pending
      vi.advanceTimersByTime(15_000)

      // Flip cancelled before promise resolves
      cleanup!()

      // Now resolve and flush microtasks
      await act(async () => {
        resolveRefresh(buildFakeTokens('cancelled-success'))
        await Promise.resolve()
      })

      // authToken must remain the initial value, not the new one
      expect(result.current.authToken).toBe(initialToken)
      expect(localStorage.getItem(keycloakTokensStorageKey)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Cleanup — cancels in-flight failure
  // -------------------------------------------------------------------------

  describe('cleanup — cancels in-flight failure', () => {
    it('does not call clearSession or onError if cleanup is called before rejection settles', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})

      let rejectRefresh!: (err: unknown) => void
      const pendingRefresh = new Promise<StoredKeycloakTokens>((_, rej) => {
        rejectRefresh = rej
      })
      const fakeClient = buildFakeClient(vi.fn().mockReturnValue(pendingRefresh))
      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        result.current.setAuthToken('initial-token')
        result.current.keycloakClientRef.current = fakeClient
      })

      const clearSession = vi.fn()
      const onError = vi.fn()

      let cleanup: (() => void) | undefined
      act(() => {
        cleanup = result.current.startKeycloakRefresh(clearSession, onError)
      })

      // Fire interval synchronously — refresh is called, promise stays pending
      vi.advanceTimersByTime(15_000)

      // Flip cancelled before rejection settles
      cleanup!()

      // Now reject and flush microtasks
      await act(async () => {
        rejectRefresh(new Error('token expired after cancel'))
        await Promise.resolve()
      })

      expect(clearSession).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Cleanup — stops further intervals
  // -------------------------------------------------------------------------

  describe('cleanup — stops further intervals', () => {
    it('does not call refresh again after cleanup, even when 15s passes', async () => {
      const fakeClient = buildFakeClient(
        vi.fn().mockResolvedValue(buildFakeTokens('stopped')),
      )
      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        result.current.setAuthToken('initial-token')
        result.current.keycloakClientRef.current = fakeClient
      })

      let cleanup: (() => void) | undefined
      act(() => {
        cleanup = result.current.startKeycloakRefresh(vi.fn(), vi.fn())
      })

      // One tick fires normally
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
      })

      expect(fakeClient.refresh).toHaveBeenCalledOnce()

      // Call cleanup — clears the interval
      cleanup!()

      // Another 15s passes — no more refresh calls
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
      })

      expect(fakeClient.refresh).toHaveBeenCalledOnce()
    })
  })
})
