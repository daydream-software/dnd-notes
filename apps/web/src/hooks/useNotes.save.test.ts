/**
 * Regression tests for useNotes — save flow (issue #144, slice 5).
 *
 * Covers:
 *   - createEmptyDraft         — blank defaults
 *   - createDraftFromNote      — copies fields from existing note; normalizeTags applied
 *   - handleDraftChange        — field merge; sequential independence
 *   - handleSaveNote (owner mode only, isSharedModeArg=false):
 *       create happy path, update happy path, early bail on !authToken,
 *       early bail on !selectedCampaignId, createNote rejection,
 *       loadWorkspace returns false (refreshOk===false, no double-toast),
 *       activity reload branch triggered when noteBrowseMode==='activity'
 *
 * Deferred:
 *   - Shared mode branch (isSharedModeArg=true) — future sub-slice
 *   - Stale refresh (refreshOk==='stale') — requires concurrent loadWorkspace
 *     in flight; omitted because deterministic setup would require intrusive
 *     ref manipulation; existing race tests in useNotes.test.ts already
 *     cover the stale logic at the loadWorkspace level
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDraftFromNote,
  createEmptyDraft,
  useNotes,
} from './useNotes'

// ---------------------------------------------------------------------------
// API mock — preserve all other exports, stub the write + read functions
// that loadWorkspace and handleSaveNote call underneath.
// ---------------------------------------------------------------------------
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    createNote: vi.fn(),
    updateNote: vi.fn(),
    // loadWorkspace calls these three in parallel:
    fetchOverview: vi.fn(),
    fetchNotes: vi.fn(),
    fetchSessions: vi.fn(),
    // loadActivity calls this:
    fetchNoteActivity: vi.fn(),
  }
})

import {
  createNote,
  fetchNoteActivity,
  fetchNotes,
  fetchOverview,
  fetchSessions,
  updateNote,
} from '../api'
import type { Note } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal NotesOverview stub (typed to satisfy NotesOverview interface). */
const stubOverview = {
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
    id: 'note-1',
    campaignId: 'camp-1',
    title: 'Test Note',
    body: '## Body',
    tags: ['lore', 'npc'],
    status: 'draft',
    sessionName: 'Session 1',
    linkedNoteIds: ['linked-note-a'],
    references: [],
    createdBy: null,
    lastEditedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Stub NotesResponse with a single note. */
function stubNotesResponse(note: Note) {
  return { notes: [note] }
}

const stubSessionsResponse = { sessions: [] }

/** Configure the three fetchXxx mocks that loadWorkspace needs. */
function mockLoadWorkspaceOk(note: Note) {
  vi.mocked(fetchOverview).mockResolvedValue(stubOverview)
  vi.mocked(fetchNotes).mockResolvedValue(stubNotesResponse(note))
  vi.mocked(fetchSessions).mockResolvedValue(stubSessionsResponse)
}

/** Convenience: reset all mocks before each test. */
function resetMocks() {
  vi.mocked(createNote).mockReset()
  vi.mocked(updateNote).mockReset()
  vi.mocked(fetchOverview).mockReset()
  vi.mocked(fetchNotes).mockReset()
  vi.mocked(fetchSessions).mockReset()
  vi.mocked(fetchNoteActivity).mockReset()
}

// ---------------------------------------------------------------------------
// createEmptyDraft — pure factory, no hook needed
// ---------------------------------------------------------------------------

describe('createEmptyDraft', () => {
  it('returns blank defaults for every NoteDraft field', () => {
    const draft = createEmptyDraft()
    expect(draft).toEqual({
      title: '',
      body: '',
      tagsText: '',
      status: 'draft',
      sessionName: '',
      linkedNoteIds: [],
    })
  })
})

// ---------------------------------------------------------------------------
// createDraftFromNote — pure factory, no hook needed
// ---------------------------------------------------------------------------

describe('createDraftFromNote', () => {
  it('copies title, body, status, sessionName, and linkedNoteIds from the note', () => {
    const note = buildNote()
    const draft = createDraftFromNote(note)
    expect(draft.title).toBe('Test Note')
    expect(draft.body).toBe('## Body')
    expect(draft.status).toBe('draft')
    expect(draft.sessionName).toBe('Session 1')
    expect(draft.linkedNoteIds).toEqual(['linked-note-a'])
  })

  it('converts null sessionName to empty string', () => {
    const note = buildNote({ sessionName: null })
    const draft = createDraftFromNote(note)
    expect(draft.sessionName).toBe('')
  })

  it('applies normalizeTags: deduplicates and trims tags from the note', () => {
    // Tags include a duplicate with extra whitespace — normalizeTags should
    // collapse them so tagsText has unique, trimmed values.
    const note = buildNote({ tags: ['lore', ' lore ', 'npc'] })
    const draft = createDraftFromNote(note)
    expect(draft.tagsText).toBe('lore, npc')
  })
})

// ---------------------------------------------------------------------------
// handleDraftChange
// ---------------------------------------------------------------------------

describe('useNotes — handleDraftChange', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges a single field without touching other draft fields', async () => {
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      result.current.handleDraftChange('title', 'My new title')
    })

    expect(result.current.draft.title).toBe('My new title')
    // All other fields must remain at their initial empty-draft defaults
    expect(result.current.draft.body).toBe('')
    expect(result.current.draft.tagsText).toBe('')
    expect(result.current.draft.status).toBe('draft')
    expect(result.current.draft.sessionName).toBe('')
    expect(result.current.draft.linkedNoteIds).toEqual([])
  })

  it('handles sequential field updates independently', async () => {
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      result.current.handleDraftChange('title', 'First Title')
    })

    await act(async () => {
      result.current.handleDraftChange('body', 'Some body text')
    })

    expect(result.current.draft.title).toBe('First Title')
    expect(result.current.draft.body).toBe('Some body text')
    // tagsText must still be the default
    expect(result.current.draft.tagsText).toBe('')
  })
})

// ---------------------------------------------------------------------------
// handleSaveNote — owner mode (isSharedModeArg = false)
// ---------------------------------------------------------------------------

describe('useNotes — handleSaveNote (owner mode)', () => {
  beforeEach(() => {
    resetMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Create happy path
  // -------------------------------------------------------------------------

  it('create happy path: calls createNote, then loadWorkspace with the new note id, flips isSaving back, no onError', async () => {
    const createdNote = buildNote({ id: 'new-note-id' })
    vi.mocked(createNote).mockResolvedValueOnce(createdNote)
    mockLoadWorkspaceOk(createdNote)

    const onError = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    // isCreating starts false and selectedNoteId is null, so isCreating||!selectedNoteId
    // evaluates to true — lands in the create branch.
    await act(async () => {
      result.current.setIsCreating(true)
    })

    await act(async () => {
      await result.current.handleSaveNote(
        false,
        null,
        null,
        'camp-1',
        'auth-token',
        true,
        undefined,
        onError,
      )
    })

    // createNote called with the auth token and a payload containing the campaign id
    expect(vi.mocked(createNote)).toHaveBeenCalledOnce()
    expect(vi.mocked(createNote).mock.calls[0][0]).toBe('auth-token')
    expect(vi.mocked(createNote).mock.calls[0][1]).toMatchObject({ campaignId: 'camp-1' })

    // loadWorkspace called with the new note id and false promote-flag (4th arg)
    expect(vi.mocked(fetchOverview)).toHaveBeenCalledOnce()
    expect(vi.mocked(fetchNotes)).toHaveBeenCalledOnce()

    // Verify that the correct preferredNoteId propagated through loadWorkspace:
    // selectedNoteId must be the newly created note's id, not null or stale.
    expect(result.current.selectedNoteId).toBe('new-note-id')
    expect(result.current.isCreating).toBe(false)

    // isSaving must be cleared in the finally block
    expect(result.current.isSaving).toBe(false)

    // Happy path: onError must never be called
    expect(onError).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Update happy path
  // -------------------------------------------------------------------------

  it('update happy path: calls updateNote with the existing note id, loadWorkspace, no onError', async () => {
    const existingNote = buildNote({ id: 'existing-note-id' })
    vi.mocked(updateNote).mockResolvedValueOnce(existingNote)
    mockLoadWorkspaceOk(existingNote)

    const onError = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    // Put the hook in a state where isCreating=false and selectedNoteId is set
    // to drive the update branch (isCreating || !selectedNoteId must be false).
    await act(async () => {
      result.current.setSelectedNoteId('existing-note-id')
      result.current.setIsCreating(false)
    })

    // Sanity check: must be on the update branch
    expect(result.current.isCreating).toBe(false)
    expect(result.current.selectedNoteId).toBe('existing-note-id')

    await act(async () => {
      await result.current.handleSaveNote(
        false,
        null,
        null,
        'camp-1',
        'auth-token',
        true,
        undefined,
        onError,
      )
    })

    // updateNote — NOT createNote — must have been called
    expect(vi.mocked(updateNote)).toHaveBeenCalledOnce()
    expect(vi.mocked(updateNote).mock.calls[0][0]).toBe('auth-token')
    expect(vi.mocked(updateNote).mock.calls[0][1]).toBe('existing-note-id')
    expect(vi.mocked(createNote)).not.toHaveBeenCalled()

    // loadWorkspace was triggered (fetch functions called)
    expect(vi.mocked(fetchOverview)).toHaveBeenCalledOnce()

    // Verify the correct preferredNoteId propagated: selectedNoteId must still
    // be the existing note's id, not clobbered to null or another value.
    expect(result.current.selectedNoteId).toBe('existing-note-id')

    expect(result.current.isSaving).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Early bail: !authToken
  // -------------------------------------------------------------------------

  it('bails early when authToken is null: nothing called, isSaving remains false', async () => {
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      await result.current.handleSaveNote(
        false,
        null,
        null,
        'camp-1',
        null, // authToken is null
        true,
      )
    })

    expect(vi.mocked(createNote)).not.toHaveBeenCalled()
    expect(vi.mocked(updateNote)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchOverview)).not.toHaveBeenCalled()
    expect(result.current.isSaving).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Early bail: !selectedCampaignId
  // -------------------------------------------------------------------------

  it('bails early when selectedCampaignId is null: nothing called, isSaving remains false', async () => {
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      await result.current.handleSaveNote(
        false,
        null,
        null,
        null, // selectedCampaignId is null
        'auth-token',
        true,
      )
    })

    expect(vi.mocked(createNote)).not.toHaveBeenCalled()
    expect(vi.mocked(updateNote)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchOverview)).not.toHaveBeenCalled()
    expect(result.current.isSaving).toBe(false)
  })

  // -------------------------------------------------------------------------
  // createNote rejection
  // -------------------------------------------------------------------------

  it('createNote rejection: calls onError with the error message, isSaving flips back, loadWorkspace not called', async () => {
    vi.mocked(createNote).mockRejectedValueOnce(new Error('API error'))

    const onError = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      result.current.setIsCreating(true)
    })

    await act(async () => {
      await result.current.handleSaveNote(
        false,
        null,
        null,
        'camp-1',
        'auth-token',
        true,
        undefined,
        onError,
      )
    })

    // createNote was attempted
    expect(vi.mocked(createNote)).toHaveBeenCalledOnce()

    // loadWorkspace must NOT have been reached (createNote threw before it)
    expect(vi.mocked(fetchOverview)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchNotes)).not.toHaveBeenCalled()

    // onError must be called with the thrown message
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('API error')

    // isSaving must be cleared by the finally block
    expect(result.current.isSaving).toBe(false)
  })

  // -------------------------------------------------------------------------
  // refreshOk === false (loadWorkspace hard failure — no double-toast)
  // -------------------------------------------------------------------------

  it('loadWorkspace failure (refreshOk===false): onError called exactly once by loadWorkspace, not again from handleSaveNote', async () => {
    const createdNote = buildNote({ id: 'note-from-create' })
    vi.mocked(createNote).mockResolvedValueOnce(createdNote)

    // Make fetchOverview fail — loadWorkspace catches it, calls onError, returns false.
    vi.mocked(fetchOverview).mockRejectedValueOnce(new Error('load failed'))
    vi.mocked(fetchNotes).mockResolvedValue({ notes: [] })
    vi.mocked(fetchSessions).mockResolvedValue(stubSessionsResponse)

    const onError = vi.fn()
    const { result } = renderHook(() => useNotes(false))

    await act(async () => {
      result.current.setIsCreating(true)
    })

    await act(async () => {
      await result.current.handleSaveNote(
        false,
        null,
        null,
        'camp-1',
        'auth-token',
        true,
        undefined,
        onError,
      )
    })

    // createNote succeeded
    expect(vi.mocked(createNote)).toHaveBeenCalledOnce()

    // onError must have been called EXACTLY ONCE (from loadWorkspace),
    // not a second time with 'Could not save the note.' from the outer catch.
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('load failed')

    // isSaving cleared by finally
    expect(result.current.isSaving).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Activity reload branch
  // -------------------------------------------------------------------------

  it('activity reload branch: loadActivity is called after save when noteBrowseMode is "activity"', async () => {
    const createdNote = buildNote({ id: 'activity-test-note' })
    vi.mocked(createNote).mockResolvedValueOnce(createdNote)
    mockLoadWorkspaceOk(createdNote)

    // fetchNoteActivity must resolve for the branch to complete cleanly
    vi.mocked(fetchNoteActivity).mockResolvedValueOnce({
      campaign: stubOverview.campaign,
      activity: [],
      collaborators: [],
    })

    const { result } = renderHook(() => useNotes(false))

    // Set browse mode to 'activity' to trigger the reload branch
    await act(async () => {
      result.current.setIsCreating(true)
      result.current.setNoteBrowseMode('activity')
    })

    await act(async () => {
      await result.current.handleSaveNote(
        false,
        null,
        null,
        'camp-1',
        'auth-token',
        true,
      )
    })

    // loadActivity calls fetchNoteActivity internally
    expect(vi.mocked(fetchNoteActivity)).toHaveBeenCalledOnce()
    expect(result.current.isSaving).toBe(false)
  })
})
