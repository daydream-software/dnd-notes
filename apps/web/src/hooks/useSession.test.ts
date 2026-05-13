/**
 * Regression tests for useSession.completeAuthentication ordering (item 3b).
 *
 * The auth-ordering invariant: onCampaignsReady is awaited first; only on
 * success does persistence (localStorage.setItem) and state mutation
 * (setAuthToken, setOwner) happen.  A rejection must propagate to the caller
 * without touching localStorage or state.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authTokenStorageKey, useSession } from './useSession'

const stubOwner = {
  id: 'owner-1',
  email: 'test@example.com',
  displayName: 'Test Owner',
  isSiteAdmin: false,
  keycloakSub: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('useSession — completeAuthentication ordering (3b)', () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('does not persist or set state when onCampaignsReady rejects', async () => {
    const { result } = renderHook(() => useSession())

    const rejection = new Error('campaigns load failed')
    const onCampaignsReady = vi.fn().mockRejectedValue(rejection)

    let caughtError: unknown

    await act(async () => {
      try {
        await result.current.completeAuthentication('token-abc', stubOwner, onCampaignsReady)
      } catch (err) {
        caughtError = err
      }
    })

    // The rejection must propagate to the caller.
    expect(caughtError).toBe(rejection)

    // localStorage must NOT have been written.
    expect(setItemSpy).not.toHaveBeenCalledWith(authTokenStorageKey, expect.anything())
    expect(localStorage.getItem(authTokenStorageKey)).toBeNull()

    // State must NOT have been mutated.
    expect(result.current.authToken).toBeNull()
    expect(result.current.owner).toBeNull()
  })

  it('persists and sets state when onCampaignsReady resolves', async () => {
    const { result } = renderHook(() => useSession())

    const onCampaignsReady = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      await result.current.completeAuthentication('token-abc', stubOwner, onCampaignsReady)
    })

    // onCampaignsReady must have been called with the token.
    expect(onCampaignsReady).toHaveBeenCalledWith('token-abc')

    // localStorage must have been written after onCampaignsReady resolved.
    expect(localStorage.getItem(authTokenStorageKey)).toBe('token-abc')

    // State setters must have fired.
    expect(result.current.authToken).toBe('token-abc')
    expect(result.current.owner).toEqual(stubOwner)
  })

  it('calls onCampaignsReady before writing localStorage', async () => {
    const { result } = renderHook(() => useSession())

    const callOrder: string[] = []

    const onCampaignsReady = vi.fn().mockImplementation(async () => {
      callOrder.push('onCampaignsReady')
      // setItem has not been called yet — token is not in storage.
      expect(setItemSpy).not.toHaveBeenCalledWith(authTokenStorageKey, expect.anything())
    })

    // Override setItemSpy to track order (spy already installed in beforeEach).
    setItemSpy.mockImplementation((key: string) => {
      if (key === authTokenStorageKey) {
        callOrder.push('setItem')
      }
      // Do not call through — the other tests verify the value ends up correct.
    })

    await act(async () => {
      await result.current.completeAuthentication('token-abc', stubOwner, onCampaignsReady)
    })

    expect(callOrder).toEqual(['onCampaignsReady', 'setItem'])
  })
})
