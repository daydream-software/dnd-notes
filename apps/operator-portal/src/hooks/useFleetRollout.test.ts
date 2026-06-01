import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJsonResponse, readMockRequest } from '../test-helpers'
import type { FleetRollout } from '../types'
import { useFleetRollout } from './useFleetRollout'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRollout(overrides: Partial<FleetRollout> = {}): FleetRollout {
  return {
    id: 'rl_test',
    targetVersion: '1.4.3',
    status: 'running',
    triggeredBy: 'operator@example.com',
    startedAt: '2026-06-01T14:32:08.000Z',
    endedAt: null,
    abortReason: null,
    failedTenant: null,
    failedError: null,
    total: 5,
    completed: 2,
    failed: 0,
    skipped: 1,
    pending: 2,
    currentTenant: 'iron-vault',
    elapsedSeconds: 252,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useFleetRollout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not poll when authToken is null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { result } = renderHook(() => useFleetRollout(null))

    // Advance time well past both poll intervals.
    await act(() => vi.advanceTimersByTimeAsync(15_000))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.rollout).toBeNull()
  })

  it('starts polling immediately on mount and sets rollout', async () => {
    const runningRollout = makeRollout()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createJsonResponse(runningRollout))

    const { result } = renderHook(() => useFleetRollout('test-token'))

    // Let the first tick fire.
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(result.current.rollout?.status).toBe('running')
  })

  it('polls at fast cadence (2500ms) when rollout is running', async () => {
    let callCount = 0
    const runningRollout = makeRollout({ status: 'running' })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++
      return createJsonResponse(runningRollout)
    })

    renderHook(() => useFleetRollout('test-token'))

    // Initial tick
    await act(() => vi.advanceTimersByTimeAsync(0))
    const afterFirstTick = callCount

    // One fast-cadence interval (2500ms)
    await act(() => vi.advanceTimersByTimeAsync(2500))
    expect(callCount).toBeGreaterThan(afterFirstTick)
  })

  it('switches to slow cadence (10000ms) when rollout becomes terminal', async () => {
    let callCount = 0
    const completedRollout = makeRollout({ status: 'completed', currentTenant: null, endedAt: '2026-06-01T14:44:11.000Z' })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++
      return createJsonResponse(completedRollout)
    })

    renderHook(() => useFleetRollout('test-token'))

    // Initial tick
    await act(() => vi.advanceTimersByTimeAsync(0))
    const afterFirstTick = callCount

    // Fast interval shouldn't fire (status is completed → slow cadence)
    await act(() => vi.advanceTimersByTimeAsync(2500))
    // Should not have polled again within the slow interval
    expect(callCount).toBe(afterFirstTick)

    // Slow interval fires at 10000ms
    await act(() => vi.advanceTimersByTimeAsync(7500)) // total 10000ms
    expect(callCount).toBeGreaterThan(afterFirstTick)
  })

  it('stops polling on unmount — no further fetches after cleanup', async () => {
    let callCount = 0
    const runningRollout = makeRollout({ status: 'running' })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++
      return createJsonResponse(runningRollout)
    })

    const { unmount } = renderHook(() => useFleetRollout('test-token'))

    // Let the first tick fire.
    await act(() => vi.advanceTimersByTimeAsync(0))
    const countBeforeUnmount = callCount

    unmount()

    // Advance well past the fast cadence.
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(callCount).toBe(countBeforeUnmount)
  })

  it('returns null rollout when server returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 404 }),
    )

    const { result } = renderHook(() => useFleetRollout('test-token'))
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(result.current.rollout).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('sets error state on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'))

    const { result } = renderHook(() => useFleetRollout('test-token'))
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(result.current.error).toBe('Network failure')
  })

  it('sets provisioningNotConfigured when server returns 501', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({ error: 'Not implemented' }, 501),
    )

    const { result } = renderHook(() => useFleetRollout('test-token'))
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(result.current.provisioningNotConfigured).toBe(true)
    expect(result.current.error).toBeNull()
  })

  // ── startRollout ────────────────────────────────────────────────────────────

  it('startRollout POSTs and immediately refetches rollout', async () => {
    const runningRollout = makeRollout()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/rollout' && method === 'GET') {
        return createJsonResponse(runningRollout)
      }

      if (path === '/operator-api/internal/fleet/rollout' && method === 'POST') {
        return createJsonResponse({ id: 'rl_test', status: 'running', startedAt: '2026-06-01T14:32:08.000Z' }, 201)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const { result } = renderHook(() => useFleetRollout('test-token'))

    await act(async () => {
      await result.current.startRollout({ version: '1.4.3', triggeredBy: 'operator@example.com' })
    })

    expect(result.current.rollout?.status).toBe('running')
    expect(result.current.isStarting).toBe(false)
  })

  it('startRollout on 409 rethrows to the caller but still refetches the active rollout', async () => {
    const existingRollout = makeRollout()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/rollout' && method === 'GET') {
        return createJsonResponse(existingRollout)
      }

      if (path === '/operator-api/internal/fleet/rollout' && method === 'POST') {
        return createJsonResponse({ error: 'A rollout is already running.' }, 409)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const { result } = renderHook(() => useFleetRollout('test-token'))

    // 409 is re-thrown — the panel catches it silently.
    await act(async () => {
      await expect(
        result.current.startRollout({ version: '1.4.3', triggeredBy: 'operator@example.com' }),
      ).rejects.toThrow()
    })

    // But the rollout was refetched and is now visible.
    expect(result.current.rollout?.id).toBe('rl_test')
  })

  // ── abortRollout ────────────────────────────────────────────────────────────

  it('abortRollout POSTs to the abort endpoint and refetches', async () => {
    const runningRollout = makeRollout({ status: 'running' })
    const abortedRollout = makeRollout({ status: 'aborted', currentTenant: null, endedAt: '2026-06-01T14:37:55.000Z', abortReason: 'Test abort.' })

    let abortCalled = false

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/rollout' && method === 'GET') {
        return createJsonResponse(abortCalled ? abortedRollout : runningRollout)
      }

      if (path.endsWith('/abort') && method === 'POST') {
        abortCalled = true
        return createJsonResponse({ status: 'aborted' })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const { result } = renderHook(() => useFleetRollout('test-token'))

    // Let initial poll run so rollout is populated.
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.rollout?.status).toBe('running')

    await act(async () => {
      await result.current.abortRollout({ reason: 'Test abort.' })
    })

    expect(abortCalled).toBe(true)
    expect(result.current.rollout?.status).toBe('aborted')
    expect(result.current.isAborting).toBe(false)
  })
})
