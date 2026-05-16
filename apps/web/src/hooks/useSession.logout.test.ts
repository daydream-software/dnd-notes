/**
 * Regression tests for useSession.handleLogout (issue #144, slice 2).
 *
 * Covers three branches:
 *   - Owner mode (no shared, no keycloak)
 *   - Shared mode (isSharedMode=true)
 *   - Keycloak mode (authConfig.mode === 'keycloak' + keycloakClientRef set)
 */
import { act, renderHook } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authTokenStorageKey, useSession } from './useSession'

// Stub logoutOwner from the API module while preserving other exports.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, logoutOwner: vi.fn() }
})

import { logoutOwner } from '../api'

const logoutOwnerMock = logoutOwner as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAMPAIGN_KEY = 'dnd-notes:selected-campaign-id'
const GUEST_KEY = 'dnd-notes:guest-session-key'

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

// jsdom does not allow vi.spyOn on window.location (non-configurable).
// Override with a plain mock fn via Object.defineProperty instead.
// Capture the original so we can restore it in afterAll to avoid cross-suite pollution.
const assignMock = vi.fn()
const originalLocation = window.location

Object.defineProperty(window, 'location', {
  configurable: true,
  writable: true,
  value: {
    ...window.location,
    assign: assignMock,
  },
})

describe('useSession — handleLogout', () => {
  afterAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
  })
  beforeEach(() => {
    logoutOwnerMock.mockReset()
    assignMock.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  // -------------------------------------------------------------------------
  // Owner mode
  // -------------------------------------------------------------------------

  describe('owner mode (default, no shared/keycloak)', () => {
    it('calls logoutOwner with the auth token then onClearSession', async () => {
      logoutOwnerMock.mockResolvedValue(undefined)
      const { result } = renderHook(() => useSession())

      // Put a token into React state via the exposed setter.
      await act(async () => {
        result.current.setAuthToken('owner-token-123')
      })

      const onClearSession = vi.fn()

      await act(async () => {
        await result.current.handleLogout(false, null, onClearSession)
      })

      expect(logoutOwnerMock).toHaveBeenCalledOnce()
      expect(logoutOwnerMock).toHaveBeenCalledWith('owner-token-123')
      expect(onClearSession).toHaveBeenCalledOnce()
    })

    it('still calls onClearSession when logoutOwner rejects (rejection is swallowed)', async () => {
      logoutOwnerMock.mockRejectedValue(new Error('network error'))
      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthToken('owner-token-456')
      })

      const onClearSession = vi.fn()

      // Must not throw.
      await act(async () => {
        await result.current.handleLogout(false, null, onClearSession)
      })

      expect(onClearSession).toHaveBeenCalledOnce()
    })

    it('does not call logoutOwner when there is no auth token, but still calls onClearSession', async () => {
      const { result } = renderHook(() => useSession())

      const onClearSession = vi.fn()

      await act(async () => {
        await result.current.handleLogout(false, null, onClearSession)
      })

      expect(logoutOwnerMock).not.toHaveBeenCalled()
      expect(onClearSession).toHaveBeenCalledOnce()
    })

    it('resets isRegisterMode to false after logout', async () => {
      const { result } = renderHook(() => useSession())

      // isRegisterMode defaults to true (line 125 of useSession.ts).
      expect(result.current.isRegisterMode).toBe(true)

      await act(async () => {
        await result.current.handleLogout(false, null, vi.fn())
      })

      expect(result.current.isRegisterMode).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Shared mode
  // -------------------------------------------------------------------------

  describe('shared mode (isSharedMode=true)', () => {
    it('calls logoutOwner with the stored token and removes required localStorage keys', async () => {
      logoutOwnerMock.mockResolvedValue(undefined)
      localStorage.setItem(authTokenStorageKey, 'shared-token-abc')
      localStorage.setItem(CAMPAIGN_KEY, 'campaign-1')

      const { result } = renderHook(() => useSession())
      const onClearSession = vi.fn()

      await act(async () => {
        await result.current.handleLogout(true, null, onClearSession)
      })

      expect(logoutOwnerMock).toHaveBeenCalledOnce()
      expect(logoutOwnerMock).toHaveBeenCalledWith('shared-token-abc')
      expect(localStorage.getItem(authTokenStorageKey)).toBeNull()
      expect(localStorage.getItem(CAMPAIGN_KEY)).toBeNull()
    })

    it('also removes the guest storage key when provided', async () => {
      logoutOwnerMock.mockResolvedValue(undefined)
      localStorage.setItem(authTokenStorageKey, 'shared-token-xyz')
      localStorage.setItem(GUEST_KEY, 'guest-data')

      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.handleLogout(true, GUEST_KEY, vi.fn())
      })

      expect(localStorage.getItem(GUEST_KEY)).toBeNull()
    })

    it('navigates to / via window.location.assign', async () => {
      logoutOwnerMock.mockResolvedValue(undefined)
      localStorage.setItem(authTokenStorageKey, 'shared-token-nav')

      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.handleLogout(true, null, vi.fn())
      })

      expect(assignMock).toHaveBeenCalledOnce()
      expect(assignMock).toHaveBeenCalledWith('/')
    })

    it('does not call logoutOwner when no token is in localStorage, but still clears keys and navigates', async () => {
      // No token set in localStorage.
      localStorage.setItem(CAMPAIGN_KEY, 'campaign-2')

      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.handleLogout(true, null, vi.fn())
      })

      expect(logoutOwnerMock).not.toHaveBeenCalled()
      expect(localStorage.getItem(CAMPAIGN_KEY)).toBeNull()
      expect(assignMock).toHaveBeenCalledOnce()
    })

    it('still removes keys and navigates when logoutOwner rejects (rejection is swallowed)', async () => {
      logoutOwnerMock.mockRejectedValue(new Error('server error'))
      localStorage.setItem(authTokenStorageKey, 'shared-token-err')
      localStorage.setItem(CAMPAIGN_KEY, 'campaign-3')

      const onClearSession = vi.fn()
      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.handleLogout(true, null, onClearSession)
      })

      expect(localStorage.getItem(authTokenStorageKey)).toBeNull()
      expect(localStorage.getItem(CAMPAIGN_KEY)).toBeNull()
      expect(assignMock).toHaveBeenCalledOnce()
      // Shared mode does not invoke onClearSession — keys + nav are the cleanup.
      // Canary: a future normalization that adds the call must update this test.
      expect(onClearSession).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Keycloak mode
  // -------------------------------------------------------------------------

  describe('keycloak mode', () => {
    it('calls onClearSession BEFORE keycloakClient.logout, then redirects', async () => {
      const callOrder: string[] = []
      const keycloakLogoutMock = vi.fn().mockImplementation(async () => {
        callOrder.push('keycloak.logout')
      })
      const fakeKeycloakClient = {
        init: vi.fn(),
        login: vi.fn(),
        logout: keycloakLogoutMock,
        refresh: vi.fn(),
        clear: vi.fn(),
      }

      const { result } = renderHook(() => useSession())

      // Inject keycloak auth config and fake client via the hook's exposed surface.
      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        result.current.keycloakClientRef.current = fakeKeycloakClient
      })

      const onClearSession = vi.fn().mockImplementation(() => {
        callOrder.push('onClearSession')
      })

      await act(async () => {
        await result.current.handleLogout(false, null, onClearSession)
      })

      expect(onClearSession).toHaveBeenCalledOnce()
      expect(keycloakLogoutMock).toHaveBeenCalledOnce()
      expect(keycloakLogoutMock).toHaveBeenCalledWith(`${window.location.origin}/`)
      // Ordering: onClearSession runs first, then the redirect.
      expect(callOrder).toEqual(['onClearSession', 'keycloak.logout'])
    })

    it('does NOT touch localStorage or navigate when taking the keycloak path', async () => {
      const keycloakLogoutMock = vi.fn().mockResolvedValue(undefined)
      const fakeKeycloakClient = {
        init: vi.fn(),
        login: vi.fn(),
        logout: keycloakLogoutMock,
        refresh: vi.fn(),
        clear: vi.fn(),
      }

      localStorage.setItem(authTokenStorageKey, 'kc-token')

      const { result } = renderHook(() => useSession())

      await act(async () => {
        result.current.setAuthConfig(buildKeycloakAuthConfig())
        result.current.keycloakClientRef.current = fakeKeycloakClient
      })

      await act(async () => {
        await result.current.handleLogout(false, null, vi.fn())
      })

      // Keycloak path early-returns before shared/owner localStorage work.
      expect(localStorage.getItem(authTokenStorageKey)).toBe('kc-token')
      expect(assignMock).not.toHaveBeenCalled()
      expect(logoutOwnerMock).not.toHaveBeenCalled()
    })
  })
})
