/**
 * Regression tests for useSession.handleLogout (issue #144, slice 2).
 *
 * Covers two branches:
 *   - Shared mode (isSharedMode=true) — localStorage cleanup + navigate
 *   - Keycloak mode (isKeycloakAuthConfig + keycloakClientRef set) — keycloak.logout redirect
 */
import { act, renderHook } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authTokenStorageKey, useSession } from './useSession'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAMPAIGN_KEY = 'dnd-notes:selected-campaign-id'
const GUEST_KEY = 'dnd-notes:guest-session-key'

function buildKeycloakAuthConfig() {
  return {
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
    assignMock.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  // -------------------------------------------------------------------------
  // Shared mode
  // -------------------------------------------------------------------------

  describe('shared mode (isSharedMode=true)', () => {
    it('removes required localStorage keys', async () => {
      localStorage.setItem(authTokenStorageKey, 'shared-token-abc')
      localStorage.setItem(CAMPAIGN_KEY, 'campaign-1')

      const { result } = renderHook(() => useSession())
      const onClearSession = vi.fn()

      await act(async () => {
        await result.current.handleLogout(true, null, onClearSession)
      })

      expect(localStorage.getItem(authTokenStorageKey)).toBeNull()
      expect(localStorage.getItem(CAMPAIGN_KEY)).toBeNull()
    })

    it('also removes the guest storage key when provided', async () => {
      localStorage.setItem(authTokenStorageKey, 'shared-token-xyz')
      localStorage.setItem(GUEST_KEY, 'guest-data')

      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.handleLogout(true, GUEST_KEY, vi.fn())
      })

      expect(localStorage.getItem(GUEST_KEY)).toBeNull()
    })

    it('navigates to / via window.location.assign', async () => {
      localStorage.setItem(authTokenStorageKey, 'shared-token-nav')

      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.handleLogout(true, null, vi.fn())
      })

      expect(assignMock).toHaveBeenCalledOnce()
      expect(assignMock).toHaveBeenCalledWith('/')
    })

    it('still clears keys and navigates when no token is in localStorage', async () => {
      localStorage.setItem(CAMPAIGN_KEY, 'campaign-2')

      const { result } = renderHook(() => useSession())

      await act(async () => {
        await result.current.handleLogout(true, null, vi.fn())
      })

      expect(localStorage.getItem(CAMPAIGN_KEY)).toBeNull()
      expect(assignMock).toHaveBeenCalledOnce()
    })

    it('does not invoke onClearSession in shared mode — keys + nav are the cleanup', async () => {
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
  // Owner mode (non-shared, non-keycloak)
  // -------------------------------------------------------------------------

  describe('owner mode (default, no shared/keycloak)', () => {
    it('calls onClearSession', async () => {
      const { result } = renderHook(() => useSession())
      const onClearSession = vi.fn()

      await act(async () => {
        await result.current.handleLogout(false, null, onClearSession)
      })

      expect(onClearSession).toHaveBeenCalledOnce()
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
    })
  })
})
