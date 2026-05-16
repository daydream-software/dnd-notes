/**
 * Regression tests for useNotes — handleSaveNote shared mode branch (issue #144, slice 5b).
 *
 * Covers isSharedModeArg=true path (lines 1082-1147):
 *   - Early bail: !guestToken
 *   - Early bail: !selectedCampaignId
 *   - Early bail: !canEditWorkspace  (new third guard vs owner mode's two)
 *   - Create happy path: createSharedNote + loadSharedWorkspace + onNarrowPanel
 *   - Update happy path: updateSharedNote + loadSharedWorkspace + onNarrowPanel
 *   - createSharedNote rejection: onError with shared-specific message
 *   - loadSharedWorkspace false failure: no double-toast, onError exactly once
 *   - onNarrowPanel NOT called when refreshOk===false (silent-return contract)
 *
 * Notable difference from owner mode (slice 5):
 *   - loadSharedWorkspace calls only fetchSharedOverview + fetchSharedNotes in
 *     parallel (no fetchSharedSessions — the shared loader omits sessions).
 *   - onNarrowPanel fires after success; owner mode does NOT call onNarrowPanel.
 *   - Third guard canEditWorkspace has no owner-mode counterpart.
 *   - Error fallback message is 'Could not save the shared note.' (owner uses
 *     'Could not save the note.').
 *   - createNotePayload receives null as campaignId (shared mode: no campaign scoping).
 *
 * Deferred (intentional, consistent with slice 5):
 *   - refreshOk==='stale' path — deterministic setup requires intrusive ref
 *     manipulation to bump workspaceRequestIdRef mid-flight; the stale race
 *     is already covered at the loadSharedWorkspace level by the race-guard
 *     tests in useNotes.test.ts.
 *   - updateSharedNote rejection — outer catch is shared between create and
 *     update paths; create rejection (test 6) exercises the same branch.
 *     Consistent with slice 5's missing updateNote rejection test.
 *   - Update-path campaignId:null payload assertion — only pinned on the
 *     create path (test 4); same consistent gap as slice 5's owner update.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotes } from './useNotes'

// ---------------------------------------------------------------------------
// API mock — preserve all other exports, stub the write + read functions
// that loadSharedWorkspace and handleSaveNote call in shared mode.
//
// loadSharedWorkspace (lines 916-919) calls two parallel fetchers:
//   fetchSharedOverview, fetchSharedNotes
// There is NO fetchSharedSessions call in the shared loader.
// ---------------------------------------------------------------------------
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    createSharedNote: vi.fn(),
    updateSharedNote: vi.fn(),
    // loadSharedWorkspace calls these two in parallel:
    fetchSharedOverview: vi.fn(),
    fetchSharedNotes: vi.fn(),
  }
})

import {
  createSharedNote,
  fetchSharedNotes,
  fetchSharedOverview,
  updateSharedNote,
} from '../api'
import type { Note } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal NotesOverview stub typed to satisfy the NotesOverview interface. */
const stubOverview = {
  campaign: {
    id: 'camp-shared',
    name: 'Shared Campaign',
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
    totalNotes: 1,
    draftNotes: 1,
    activeNotes: 0,
    archivedNotes: 0,
    sessionLinkedNotes: 0,
  },
  recentNotes: [],
}

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-shared-1',
    campaignId: 'camp-shared',
    title: 'Shared Note',
    body: '## Shared Body',
    tags: ['lore'],
    status: 'draft',
    sessionName: null,
    linkedNoteIds: [],
    references: [],
    createdBy: null,
    lastEditedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Configure the two fetch mocks that loadSharedWorkspace needs. */
function mockLoadSharedWorkspaceOk(note: Note) {
  vi.mocked(fetchSharedOverview).mockResolvedValue(stubOverview)
  vi.mocked(fetchSharedNotes).mockResolvedValue({ notes: [note] })
}

/** Reset all shared-mode mocks before each test. */
function resetMocks() {
  vi.mocked(createSharedNote).mockReset()
  vi.mocked(updateSharedNote).mockReset()
  vi.mocked(fetchSharedOverview).mockReset()
  vi.mocked(fetchSharedNotes).mockReset()
}

// Convenience constants used in most tests
const SHARE_TOKEN = 'share-token'
const GUEST_TOKEN = 'guest-token'
const CAMPAIGN_ID = 'camp-shared'

// ---------------------------------------------------------------------------
// handleSaveNote — shared mode (isSharedModeArg = true)
// ---------------------------------------------------------------------------

describe('useNotes — handleSaveNote (shared mode)', () => {
  beforeEach(() => {
    resetMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Early bail: !guestToken
  // -------------------------------------------------------------------------

  it('bails early when guestToken is null: nothing called, isSaving remains false', async () => {
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      await result.current.handleSaveNote(
        true,
        SHARE_TOKEN,
        null, // guestToken null
        CAMPAIGN_ID,
        null,
        true,
      )
    })

    expect(vi.mocked(createSharedNote)).not.toHaveBeenCalled()
    expect(vi.mocked(updateSharedNote)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchSharedOverview)).not.toHaveBeenCalled()
    expect(result.current.isSaving).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Early bail: !selectedCampaignId
  // -------------------------------------------------------------------------

  it('bails early when selectedCampaignId is null: nothing called, isSaving remains false', async () => {
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      await result.current.handleSaveNote(
        true,
        SHARE_TOKEN,
        GUEST_TOKEN,
        null, // selectedCampaignId null
        null,
        true,
      )
    })

    expect(vi.mocked(createSharedNote)).not.toHaveBeenCalled()
    expect(vi.mocked(updateSharedNote)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchSharedOverview)).not.toHaveBeenCalled()
    expect(result.current.isSaving).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Early bail: !canEditWorkspace  (new third guard — differentiator vs owner mode)
  // Both guestToken and selectedCampaignId are truthy to isolate this guard.
  // -------------------------------------------------------------------------

  it('bails early when canEditWorkspace is false: nothing called, isSaving remains false', async () => {
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      await result.current.handleSaveNote(
        true,
        SHARE_TOKEN,
        GUEST_TOKEN,      // truthy — not the cause of bail
        CAMPAIGN_ID,      // truthy — not the cause of bail
        null,
        false,            // canEditWorkspace = false — the new third guard
      )
    })

    expect(vi.mocked(createSharedNote)).not.toHaveBeenCalled()
    expect(vi.mocked(updateSharedNote)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchSharedOverview)).not.toHaveBeenCalled()
    expect(result.current.isSaving).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Create happy path
  // -------------------------------------------------------------------------

  it('create happy path: createSharedNote called with (shareToken, guestToken, payload), loadSharedWorkspace fires, onNarrowPanel called after create, no onError', async () => {
    const createdNote = buildNote({ id: 'new-shared-note-id' })
    vi.mocked(createSharedNote).mockResolvedValueOnce(createdNote)
    mockLoadSharedWorkspaceOk(createdNote)

    const onError = vi.fn()
    const onNarrowPanel = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    // isCreating=true drives the create branch (isCreating || !selectedNoteId)
    await act(async () => {
      result.current.setIsCreating(true)
    })

    await act(async () => {
      await result.current.handleSaveNote(
        true,
        SHARE_TOKEN,
        GUEST_TOKEN,
        CAMPAIGN_ID,
        null,
        true,
        onNarrowPanel,
        onError,
      )
    })

    // createSharedNote called with correct token args
    expect(vi.mocked(createSharedNote)).toHaveBeenCalledOnce()
    expect(vi.mocked(createSharedNote).mock.calls[0][0]).toBe(SHARE_TOKEN)
    expect(vi.mocked(createSharedNote).mock.calls[0][1]).toBe(GUEST_TOKEN)
    // payload is 3rd arg — campaignId must be null in shared mode
    expect(vi.mocked(createSharedNote).mock.calls[0][2]).toMatchObject({ campaignId: null })

    // loadSharedWorkspace fetchers were called
    expect(vi.mocked(fetchSharedOverview)).toHaveBeenCalledOnce()
    expect(vi.mocked(fetchSharedNotes)).toHaveBeenCalledOnce()

    // selectedNoteId is the newly created note's id
    expect(result.current.selectedNoteId).toBe('new-shared-note-id')
    expect(result.current.isCreating).toBe(false)

    // isSaving cleared by finally
    expect(result.current.isSaving).toBe(false)

    // onNarrowPanel called after success
    expect(onNarrowPanel).toHaveBeenCalledOnce()

    // Happy path: onError never called
    expect(onError).not.toHaveBeenCalled()

    // Ordering: onNarrowPanel must fire AFTER createSharedNote
    expect(vi.mocked(createSharedNote).mock.invocationCallOrder[0]).toBeLessThan(
      onNarrowPanel.mock.invocationCallOrder[0],
    )
  })

  // -------------------------------------------------------------------------
  // Update happy path
  // -------------------------------------------------------------------------

  it('update happy path: updateSharedNote called with existing selectedNoteId, loadSharedWorkspace fires, onNarrowPanel called, no onError', async () => {
    const existingNote = buildNote({ id: 'existing-shared-note-id' })
    vi.mocked(updateSharedNote).mockResolvedValueOnce(existingNote)
    mockLoadSharedWorkspaceOk(existingNote)

    const onError = vi.fn()
    const onNarrowPanel = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    // isCreating=false + selectedNoteId set drives the update branch
    await act(async () => {
      result.current.setSelectedNoteId('existing-shared-note-id')
      result.current.setIsCreating(false)
    })

    expect(result.current.isCreating).toBe(false)
    expect(result.current.selectedNoteId).toBe('existing-shared-note-id')

    await act(async () => {
      await result.current.handleSaveNote(
        true,
        SHARE_TOKEN,
        GUEST_TOKEN,
        CAMPAIGN_ID,
        null,
        true,
        onNarrowPanel,
        onError,
      )
    })

    // updateSharedNote — NOT createSharedNote — called
    expect(vi.mocked(updateSharedNote)).toHaveBeenCalledOnce()
    expect(vi.mocked(updateSharedNote).mock.calls[0][0]).toBe(SHARE_TOKEN)
    expect(vi.mocked(updateSharedNote).mock.calls[0][1]).toBe(GUEST_TOKEN)
    expect(vi.mocked(updateSharedNote).mock.calls[0][2]).toBe('existing-shared-note-id')
    expect(vi.mocked(createSharedNote)).not.toHaveBeenCalled()

    // loadSharedWorkspace triggered
    expect(vi.mocked(fetchSharedOverview)).toHaveBeenCalledOnce()
    expect(vi.mocked(fetchSharedNotes)).toHaveBeenCalledOnce()

    expect(result.current.selectedNoteId).toBe('existing-shared-note-id')
    expect(result.current.isSaving).toBe(false)
    expect(onNarrowPanel).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // createSharedNote rejection
  // -------------------------------------------------------------------------

  it('createSharedNote rejection: onError called once with shared-specific message, isSaving cleared, loadSharedWorkspace not called', async () => {
    vi.mocked(createSharedNote).mockRejectedValueOnce(new Error('Shared API error'))

    const onError = vi.fn()
    const onNarrowPanel = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      result.current.setIsCreating(true)
    })

    await act(async () => {
      await result.current.handleSaveNote(
        true,
        SHARE_TOKEN,
        GUEST_TOKEN,
        CAMPAIGN_ID,
        null,
        true,
        onNarrowPanel,
        onError,
      )
    })

    // createSharedNote attempted
    expect(vi.mocked(createSharedNote)).toHaveBeenCalledOnce()

    // loadSharedWorkspace must NOT have been reached
    expect(vi.mocked(fetchSharedOverview)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchSharedNotes)).not.toHaveBeenCalled()

    // onError called with the thrown message (Error.message path)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('Shared API error')

    // onNarrowPanel must NOT have been called
    expect(onNarrowPanel).not.toHaveBeenCalled()

    // isSaving cleared by finally
    expect(result.current.isSaving).toBe(false)
  })

  it('createSharedNote rejection with non-Error throw: onError called with shared-specific fallback string', async () => {
    // Non-Error throw exercises the fallback string branch
    vi.mocked(createSharedNote).mockRejectedValueOnce('unexpected string error')

    const onError = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      result.current.setIsCreating(true)
    })

    await act(async () => {
      await result.current.handleSaveNote(
        true,
        SHARE_TOKEN,
        GUEST_TOKEN,
        CAMPAIGN_ID,
        null,
        true,
        undefined,
        onError,
      )
    })

    // Fallback message is the shared-mode string, NOT the owner-mode 'Could not save the note.'
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('Could not save the shared note.')
  })

  // -------------------------------------------------------------------------
  // loadSharedWorkspace returns false — no double-toast
  // -------------------------------------------------------------------------

  it('loadSharedWorkspace failure (refreshOk===false): onError called exactly once by loadSharedWorkspace, not again from handleSaveNote', async () => {
    const createdNote = buildNote({ id: 'note-from-shared-create' })
    vi.mocked(createSharedNote).mockResolvedValueOnce(createdNote)

    // Make fetchSharedOverview fail — loadSharedWorkspace catches it, calls onError, returns false
    vi.mocked(fetchSharedOverview).mockRejectedValueOnce(new Error('shared load failed'))
    vi.mocked(fetchSharedNotes).mockResolvedValue({ notes: [] })

    const onError = vi.fn()
    const onNarrowPanel = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      result.current.setIsCreating(true)
    })

    await act(async () => {
      await result.current.handleSaveNote(
        true,
        SHARE_TOKEN,
        GUEST_TOKEN,
        CAMPAIGN_ID,
        null,
        true,
        onNarrowPanel,
        onError,
      )
    })

    // createSharedNote succeeded
    expect(vi.mocked(createSharedNote)).toHaveBeenCalledOnce()

    // onError must be called EXACTLY ONCE (from loadSharedWorkspace),
    // NOT a second time with 'Could not save the shared note.' from the outer catch
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('shared load failed')

    // isSaving cleared by finally
    expect(result.current.isSaving).toBe(false)
  })

  // -------------------------------------------------------------------------
  // onNarrowPanel NOT called when refreshOk === false
  // -------------------------------------------------------------------------

  it('onNarrowPanel not called when refreshOk===false: silent-return contract respected', async () => {
    const createdNote = buildNote({ id: 'note-silent-return' })
    vi.mocked(createSharedNote).mockResolvedValueOnce(createdNote)

    // loadSharedWorkspace will return false (error path)
    vi.mocked(fetchSharedOverview).mockRejectedValueOnce(new Error('load error'))
    vi.mocked(fetchSharedNotes).mockResolvedValue({ notes: [] })

    const onError = vi.fn()
    const onNarrowPanel = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      result.current.setIsCreating(true)
    })

    await act(async () => {
      await result.current.handleSaveNote(
        true,
        SHARE_TOKEN,
        GUEST_TOKEN,
        CAMPAIGN_ID,
        null,
        true,
        onNarrowPanel,
        onError,
      )
    })

    // refreshOk===false triggered early return before onNarrowPanel
    expect(onNarrowPanel).not.toHaveBeenCalled()

    // onError was called (by loadSharedWorkspace) — confirm the failure did occur
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('load error')
  })
})
