/**
 * Regression tests for useNotes hook semantics introduced in PRs #251 / #252.
 *
 * Covers:
 *   3a — Race guard: concurrent loadWorkspace/loadSharedWorkspace calls.
 *        The first (slower) call must return 'stale', apply no state mutations,
 *        and have its AbortSignal aborted by the time the second call fires.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import type { NotesOverview, NotesResponse, SessionsResponse } from '../types'
import { useNotes } from './useNotes'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A deferred promise + resolver pair. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Minimal NotesOverview stub. */
const stubOverview: NotesOverview = {
  campaign: {
    id: 'camp-1',
    name: 'Test Campaign',
    tagline: '',
    system: '',
    setting: '',
    nextSession: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  membership: null,
  stats: {
    totalNotes: 0,
    draftNotes: 0,
    activeNotes: 0,
    archivedNotes: 0,
    sessionLinkedNotes: 0,
  },
  recentNotes: [],
}

/** Minimal NotesResponse stub. */
const stubNotesResponse: NotesResponse = {
  notes: [
    {
      id: 'note-1',
      campaignId: 'camp-1',
      title: 'First note',
      body: '',
      tags: [],
      linkedNoteIds: [],
      status: 'draft' as const,
      sessionName: null,
      references: [],
      createdBy: null,
      lastEditedBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}

/** Minimal SessionsResponse stub. */
const stubSessionsResponse: SessionsResponse = { sessions: [] }

// ---------------------------------------------------------------------------
// 3a: Race guard — loadWorkspace
// ---------------------------------------------------------------------------

describe('useNotes — loadWorkspace race guard (3a)', () => {
  let fetchOverviewSpy: ReturnType<typeof vi.spyOn>
  let fetchNotesSpy: ReturnType<typeof vi.spyOn>
  let fetchSessionsSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchOverviewSpy = vi.spyOn(api, 'fetchOverview')
    fetchNotesSpy = vi.spyOn(api, 'fetchNotes')
    fetchSessionsSpy = vi.spyOn(api, 'fetchSessions')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns stale and applies no state for the first call when a second fires before it resolves', async () => {
    // We need the signal that was passed to the first batch of fetches so we
    // can verify it got aborted.  Capture it from the first fetchOverview call.
    let firstSignal: AbortSignal | undefined

    const firstOverviewDeferred = deferred<typeof stubOverview>()
    let secondCallCount = 0

    fetchOverviewSpy.mockImplementation(
      (_token: string, _campaignId?: string | null, signal?: AbortSignal) => {
        if (firstSignal === undefined) {
          // First call — capture signal, return a promise we control.
          firstSignal = signal
          return firstOverviewDeferred.promise
        }
        secondCallCount++
        return Promise.resolve(stubOverview)
      },
    )
    fetchNotesSpy.mockResolvedValue(stubNotesResponse)
    fetchSessionsSpy.mockResolvedValue(stubSessionsResponse)

    const { result } = renderHook(() => useNotes(false))

    let firstResult: boolean | 'stale' | undefined
    let secondResult: boolean | 'stale' | undefined

    // Fire first (slow) load — not awaited yet.
    act(() => {
      void result.current.loadWorkspace('token', 'camp-1', undefined).then((r) => {
        firstResult = r
      })
    })

    // Signal should not be aborted yet.
    expect(firstSignal).toBeDefined()
    expect(firstSignal!.aborted).toBe(false)

    // Fire second (fast) load — this will abort the first.
    await act(async () => {
      secondResult = await result.current.loadWorkspace('token', 'camp-1', undefined)
    })

    // After the second call fired, the first call's signal must be aborted.
    expect(firstSignal!.aborted).toBe(true)

    // Let the first call's fetch resolve (too late — it was superseded).
    await act(async () => {
      firstOverviewDeferred.resolve(stubOverview)
      // Flush microtasks.
      await Promise.resolve()
    })

    // Second call succeeded.
    expect(secondResult).toBe(true)
    expect(secondCallCount).toBe(1)

    // First call must have returned 'stale'.
    expect(firstResult).toBe('stale')

    // State should reflect the second call's data.
    expect(result.current.notes).toHaveLength(1)
    expect(result.current.notes[0].id).toBe('note-1')
  })

  it('returns stale (not false) and does not call onError when fetch throws AbortError', async () => {
    // Simulate the browser throwing an AbortError when the signal fires.
    let callIndex = 0

    fetchOverviewSpy.mockImplementation(
      (_token: string, _campaignId?: string | null, signal?: AbortSignal) => {
        callIndex++
        if (callIndex === 1) {
          return new Promise<typeof stubOverview>((_, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
            // Never resolves on its own — only rejects when aborted.
          })
        }
        return Promise.resolve(stubOverview)
      },
    )
    fetchNotesSpy.mockResolvedValue(stubNotesResponse)
    fetchSessionsSpy.mockResolvedValue(stubSessionsResponse)

    const onErrorMock = vi.fn()

    const { result } = renderHook(() => useNotes(false))

    let firstResult: boolean | 'stale' | undefined

    act(() => {
      void result.current
        .loadWorkspace('token', 'camp-1', undefined, false, undefined, undefined, onErrorMock)
        .then((r) => {
          firstResult = r
        })
    })

    // Second call aborts the first via the new AbortController.
    await act(async () => {
      await result.current.loadWorkspace('token', 'camp-1', undefined, false, undefined, undefined, onErrorMock)
    })

    // Let the AbortError rejection settle.
    await act(async () => {
      await Promise.resolve()
    })

    // First must return 'stale', not false — abort is not a real error.
    expect(firstResult).toBe('stale')
    // onError must not have been called for the aborted first load.
    expect(onErrorMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 3a: Race guard — loadSharedWorkspace
// ---------------------------------------------------------------------------

describe('useNotes — loadSharedWorkspace race guard (3a)', () => {
  let fetchSharedOverviewSpy: ReturnType<typeof vi.spyOn>
  let fetchSharedNotesSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSharedOverviewSpy = vi.spyOn(api, 'fetchSharedOverview')
    fetchSharedNotesSpy = vi.spyOn(api, 'fetchSharedNotes')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns stale and applies no state for the first call when a second fires before it resolves', async () => {
    let firstSignal: AbortSignal | undefined
    const firstOverviewDeferred = deferred<typeof stubOverview>()
    let secondCallCount = 0

    fetchSharedOverviewSpy.mockImplementation(
      (_shareToken: string, _guestToken: string, signal?: AbortSignal) => {
        if (firstSignal === undefined) {
          firstSignal = signal
          return firstOverviewDeferred.promise
        }
        secondCallCount++
        return Promise.resolve(stubOverview)
      },
    )
    fetchSharedNotesSpy.mockResolvedValue(stubNotesResponse)

    const { result } = renderHook(() => useNotes(true))

    let firstResult: boolean | 'stale' | undefined
    let secondResult: boolean | 'stale' | undefined

    act(() => {
      void result.current.loadSharedWorkspace('share-token', 'guest-token', undefined).then((r) => {
        firstResult = r
      })
    })

    expect(firstSignal).toBeDefined()
    expect(firstSignal!.aborted).toBe(false)

    await act(async () => {
      secondResult = await result.current.loadSharedWorkspace('share-token', 'guest-token', undefined)
    })

    expect(firstSignal!.aborted).toBe(true)

    await act(async () => {
      firstOverviewDeferred.resolve(stubOverview)
      await Promise.resolve()
    })

    expect(secondResult).toBe(true)
    expect(secondCallCount).toBe(1)
    expect(firstResult).toBe('stale')
    expect(result.current.notes).toHaveLength(1)
  })
})
