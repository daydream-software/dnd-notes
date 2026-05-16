/**
 * Regression tests for useCampaign — create branch (issue #144, slice 4).
 *
 * Covers:
 *   - createCampaignDraft            — fresh defaults; from-existing copies
 *   - handleCampaignDraftChange      — field merge; sequential independence
 *   - handleSaveCampaign create path — success (no template), success with starter
 *     template, starter template partial failure, createCampaign rejection,
 *     synchronous onError reset on entry
 *
 * Deferred: edit branch (campaignFormMode === 'edit'), deletion, membership
 * consolidation, transfer — out of scope for this slice.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  blankCampaignTemplateId,
  createCampaignDraft,
  useCampaign,
} from './useCampaign'

// ---------------------------------------------------------------------------
// API mock — preserve all other exports, stub only the two write functions
// used in the create branch.
// ---------------------------------------------------------------------------
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    createCampaign: vi.fn(),
    createNote: vi.fn(),
  }
})

import { createCampaign, createNote } from '../api'

const createCampaignMock = createCampaign as ReturnType<typeof vi.fn>
const createNoteMock = createNote as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCampaign(overrides: Partial<import('../types').CampaignSummary> = {}): import('../types').CampaignSummary {
  return {
    id: 'campaign-1',
    name: 'Test Campaign',
    tagline: 'A tagline',
    system: 'D&D 5e',
    setting: 'Forgotten Realms',
    nextSession: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// Import the 'starter-pack' template id so tests can reference it without
// hard-coding the string literal everywhere.
import { campaignStarterTemplates, getCampaignStarterTemplate } from '../templates'

const starterPackId = campaignStarterTemplates.find((t) => t.id !== blankCampaignTemplateId)!.id

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useCampaign — create branch', () => {
  beforeEach(() => {
    createCampaignMock.mockReset()
    createNoteMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // createCampaignDraft (pure factory — no hook needed)
  // -------------------------------------------------------------------------

  describe('createCampaignDraft', () => {
    it('returns blank defaults when called with no argument', () => {
      const draft = createCampaignDraft()
      expect(draft).toEqual({
        name: '',
        tagline: '',
        system: '',
        setting: '',
        nextSession: '',
      })
    })

    it('copies relevant fields from an existing campaign, mapping null nextSession to empty string', () => {
      const campaign = buildCampaign({
        name: 'My Campaign',
        tagline: 'The tagline',
        system: 'Pathfinder 2e',
        setting: 'Golarion',
        nextSession: null,
      })
      const draft = createCampaignDraft(campaign)
      expect(draft).toEqual({
        name: 'My Campaign',
        tagline: 'The tagline',
        system: 'Pathfinder 2e',
        setting: 'Golarion',
        nextSession: '',
      })
    })

    it('preserves a non-null nextSession when copying from campaign', () => {
      const campaign = buildCampaign({ nextSession: '2026-06-01' })
      const draft = createCampaignDraft(campaign)
      expect(draft.nextSession).toBe('2026-06-01')
    })
  })

  // -------------------------------------------------------------------------
  // handleCampaignDraftChange
  // -------------------------------------------------------------------------

  describe('handleCampaignDraftChange', () => {
    it('merges a single field into the draft without touching other fields', async () => {
      const { result } = renderHook(() => useCampaign())

      await act(async () => {
        result.current.handleCampaignDraftChange('name', 'Curse of Strahd')
      })

      expect(result.current.campaignDraft.name).toBe('Curse of Strahd')
      // Other fields must remain at defaults
      expect(result.current.campaignDraft.tagline).toBe('')
      expect(result.current.campaignDraft.system).toBe('')
    })

    it('handles sequential field updates independently', async () => {
      const { result } = renderHook(() => useCampaign())

      await act(async () => {
        result.current.handleCampaignDraftChange('system', 'D&D 5e')
      })

      await act(async () => {
        result.current.handleCampaignDraftChange('setting', 'Ravenloft')
      })

      expect(result.current.campaignDraft.system).toBe('D&D 5e')
      expect(result.current.campaignDraft.setting).toBe('Ravenloft')
      // name must still be the default
      expect(result.current.campaignDraft.name).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // handleSaveCampaign — create branch
  // -------------------------------------------------------------------------

  describe('handleSaveCampaign (create mode)', () => {
    it('success without starter template: calls createCampaign, triggers onLoadCampaigns with new id, closes form, and does not call onError', async () => {
      const createdCampaign = buildCampaign({ id: 'new-campaign-id' })
      createCampaignMock.mockResolvedValue(createdCampaign)

      const onLoadCampaigns = vi.fn().mockResolvedValue(undefined)
      const onError = vi.fn()

      const { result } = renderHook(() => useCampaign())

      // Drive hook into create mode with blank template (default)
      await act(async () => {
        result.current.setCampaignFormMode('create')
        result.current.handleCampaignDraftChange('name', 'New Campaign')
      })

      await act(async () => {
        await result.current.handleSaveCampaign('auth-token', onLoadCampaigns, onError)
      })

      expect(createCampaignMock).toHaveBeenCalledOnce()
      expect(createCampaignMock).toHaveBeenCalledWith('auth-token', expect.objectContaining({ name: 'New Campaign' }))

      expect(onLoadCampaigns).toHaveBeenCalledOnce()
      expect(onLoadCampaigns).toHaveBeenCalledWith('auth-token', 'new-campaign-id')

      // Form must close
      expect(result.current.campaignFormMode).toBe('closed')

      // Template id must be reset to blank
      expect(result.current.selectedCampaignTemplateId).toBe(blankCampaignTemplateId)

      // isSavingCampaign must be cleared by the finally block
      expect(result.current.isSavingCampaign).toBe(false)

      // onError must only have been called once with null (the entry reset)
      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith(null)
    })

    it('success with starter template: createNote called once per starter note in order', async () => {
      const createdCampaign = buildCampaign({ id: 'campaign-with-template' })
      createCampaignMock.mockResolvedValue(createdCampaign)
      createNoteMock.mockResolvedValue({})

      const onLoadCampaigns = vi.fn().mockResolvedValue(undefined)
      const onError = vi.fn()

      const { result } = renderHook(() => useCampaign())

      await act(async () => {
        result.current.setCampaignFormMode('create')
        result.current.setSelectedCampaignTemplateId(starterPackId)
      })

      await act(async () => {
        await result.current.handleSaveCampaign('auth-token', onLoadCampaigns, onError)
      })

      const template = getCampaignStarterTemplate(starterPackId)
      expect(createNoteMock).toHaveBeenCalledTimes(template.starterNotes.length)

      // Verify order: titles match template order
      const calledTitles = vi.mocked(createNote).mock.calls.map((c) => c[1].title)
      const expectedTitles = template.starterNotes.map((n) => n.title)
      expect(calledTitles).toEqual(expectedTitles)

      // All createNote calls must pass the new campaign id and the auth token
      for (const call of vi.mocked(createNote).mock.calls) {
        expect(call[0]).toBe('auth-token')
        expect(call[1].campaignId).toBe('campaign-with-template')
      }

      // Form still closes
      expect(result.current.campaignFormMode).toBe('closed')
      expect(result.current.isSavingCampaign).toBe(false)

      // Happy path: onError only fired once, the entry-reset to null.
      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith(null)
    })

    it('starter template partial failure: campaign still registered, form closes, onError called with starter error message', async () => {
      const createdCampaign = buildCampaign({ id: 'campaign-partial' })
      createCampaignMock.mockResolvedValue(createdCampaign)
      // First createNote fails — `Once` makes intent explicit (the loop aborts on first throw anyway).
      createNoteMock.mockRejectedValueOnce(new Error('Note creation failed'))

      const onLoadCampaigns = vi.fn().mockResolvedValue(undefined)
      const onError = vi.fn()

      const { result } = renderHook(() => useCampaign())

      await act(async () => {
        result.current.setCampaignFormMode('create')
        result.current.setSelectedCampaignTemplateId(starterPackId)
      })

      await act(async () => {
        await result.current.handleSaveCampaign('auth-token', onLoadCampaigns, onError)
      })

      // Pin the causal ordering: campaign creation succeeded BEFORE the note
      // loop fired. The inner catch must only swallow the note-loop error.
      expect(createCampaignMock).toHaveBeenCalledOnce()

      // onLoadCampaigns must still be called (campaign was created)
      expect(onLoadCampaigns).toHaveBeenCalledOnce()
      expect(onLoadCampaigns).toHaveBeenCalledWith('auth-token', 'campaign-partial')

      // Form closes despite starter note failure
      expect(result.current.campaignFormMode).toBe('closed')
      expect(result.current.selectedCampaignTemplateId).toBe(blankCampaignTemplateId)
      expect(result.current.isSavingCampaign).toBe(false)

      // onError must have been called: once with null (entry reset) and once
      // with the starter template error message
      expect(onError).toHaveBeenCalledTimes(2)
      expect(onError).toHaveBeenNthCalledWith(1, null)
      expect(onError).toHaveBeenNthCalledWith(
        2,
        'Campaign created, but the starter notes could not be added. You can still add notes manually.',
      )
    })

    it('createCampaign rejection: calls onError with error message, form stays open, onLoadCampaigns not called', async () => {
      createCampaignMock.mockRejectedValue(new Error('Server error'))

      const onLoadCampaigns = vi.fn()
      const onError = vi.fn()

      const { result } = renderHook(() => useCampaign())

      await act(async () => {
        result.current.setCampaignFormMode('create')
      })

      await act(async () => {
        await result.current.handleSaveCampaign('auth-token', onLoadCampaigns, onError)
      })

      // Form must NOT close
      expect(result.current.campaignFormMode).toBe('create')

      // createNote must not have been reached
      expect(createNoteMock).not.toHaveBeenCalled()

      // onLoadCampaigns must not have been called
      expect(onLoadCampaigns).not.toHaveBeenCalled()

      // isSavingCampaign must still flip back in the finally block
      expect(result.current.isSavingCampaign).toBe(false)

      // onError: first call is the entry null reset; second is the rejection message
      expect(onError).toHaveBeenCalledTimes(2)
      expect(onError).toHaveBeenNthCalledWith(1, null)
      expect(onError).toHaveBeenNthCalledWith(2, 'Server error')
    })

    it('synchronous onError reset on entry: null is passed to onError before createCampaign resolves', async () => {
      // Use a deferred promise so we can observe the in-flight state.
      // onError(null) must fire synchronously when handleSaveCampaign is called,
      // not as a side-effect of the success branch.
      let resolveCreate: (value: import('../types').CampaignSummary) => void = () => {}
      createCampaignMock.mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
      )

      const onLoadCampaigns = vi.fn().mockResolvedValue(undefined)
      const onError = vi.fn()

      const { result } = renderHook(() => useCampaign())

      await act(async () => {
        result.current.setCampaignFormMode('create')
      })

      // Kick off save — do NOT await; we want to inspect mid-flight.
      let savePromise!: Promise<void>
      act(() => {
        savePromise = result.current.handleSaveCampaign('auth-token', onLoadCampaigns, onError)
      })

      // onError must already have been called once with null even though
      // createCampaign has not yet resolved.
      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith(null)

      // isSavingCampaign must be true (in-flight)
      expect(result.current.isSavingCampaign).toBe(true)

      // Clean up: resolve and let the chain settle.
      const createdCampaign = buildCampaign({ id: 'resolved-id' })
      await act(async () => {
        resolveCreate(createdCampaign)
        await savePromise
      })
    })
  })
})
