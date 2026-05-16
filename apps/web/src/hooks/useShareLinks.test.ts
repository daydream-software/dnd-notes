/**
 * Regression tests for useShareLinks (issue #144, slice 6).
 *
 * Covers five handlers + the draft-change setter:
 *   - handleShareLinkDraftChange — field-level merge into draft
 *   - handleCreateShareLink — success (prepend + reset + notice) and error path
 *   - handleRevealShareLink — success (stores {url, isVisible:false}), error, clears prior
 *     action error for the same id, clears copiedShareLinkId when matched
 *   - handleToggleShareLinkVisibility — no-op when not revealed; flips isVisible when revealed
 *   - handleCopyShareLink — silent return when not revealed; success sets copiedShareLinkId
 *     and clears prior action error; error sets per-link error AND calls onError
 *   - handleRevokeShareLink — success removes link + clears revealed/errors/copied; error path
 *
 * Deferred: document.execCommand clipboard fallback (marked below) — more complex DOM
 * manipulation; deferred to a follow-up slice.
 */
import { act, renderHook } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useShareLinks } from './useShareLinks'

// ---------------------------------------------------------------------------
// API mock — preserve all other exports, stub only the three write functions
// ---------------------------------------------------------------------------
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    createCampaignShareLink: vi.fn(),
    revealCampaignShareLink: vi.fn(),
    revokeCampaignShareLink: vi.fn(),
  }
})

import {
  createCampaignShareLink,
  revealCampaignShareLink,
  revokeCampaignShareLink,
} from '../api'
import type { CampaignShareLink } from '../types'

const createCampaignShareLinkMock = createCampaignShareLink as ReturnType<typeof vi.fn>
const revealCampaignShareLinkMock = revealCampaignShareLink as ReturnType<typeof vi.fn>
const revokeCampaignShareLinkMock = revokeCampaignShareLink as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1
function buildShareLink(overrides: Partial<CampaignShareLink> = {}): CampaignShareLink {
  const id = String(nextId++)
  return {
    id,
    campaignId: 'campaign-1',
    label: null,
    accessLevel: 'editor',
    frameAncestors: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Clipboard mock (navigator.clipboard)
// navigator.clipboard is not configurable in jsdom by default — override via
// Object.defineProperty, same documented workaround as window.location in slice 2.
// ---------------------------------------------------------------------------
const writeTextMock = vi.fn()
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  writable: true,
  value: { writeText: writeTextMock },
})

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useShareLinks', () => {
  afterAll(() => {
    // Restore clipboard
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    } else {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  beforeEach(() => {
    nextId = 1
    createCampaignShareLinkMock.mockReset()
    revealCampaignShareLinkMock.mockReset()
    revokeCampaignShareLinkMock.mockReset()
    writeTextMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // handleShareLinkDraftChange
  // -------------------------------------------------------------------------

  describe('handleShareLinkDraftChange', () => {
    it('merges a single field into the existing draft without touching other fields', async () => {
      const { result } = renderHook(() => useShareLinks())

      await act(async () => {
        result.current.handleShareLinkDraftChange('label', 'My Link')
      })

      expect(result.current.shareLinkDraft.label).toBe('My Link')
      // Other draft fields must remain at defaults
      expect(result.current.shareLinkDraft.accessLevel).toBe('editor')
      expect(result.current.shareLinkDraft.frameAncestors).toBe('')
    })

    it('handles sequential field updates independently', async () => {
      const { result } = renderHook(() => useShareLinks())

      await act(async () => {
        result.current.handleShareLinkDraftChange('accessLevel', 'viewer')
      })

      await act(async () => {
        result.current.handleShareLinkDraftChange('frameAncestors', 'https://example.com')
      })

      expect(result.current.shareLinkDraft.accessLevel).toBe('viewer')
      expect(result.current.shareLinkDraft.frameAncestors).toBe('https://example.com')
      // label must still be the default
      expect(result.current.shareLinkDraft.label).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // handleCreateShareLink
  // -------------------------------------------------------------------------

  describe('handleCreateShareLink', () => {
    it('success: prepends new link to list, resets draft, and sets shareLinkNotice', async () => {
      const newLink = buildShareLink({ label: 'Campaign link' })
      createCampaignShareLinkMock.mockResolvedValue({ shareLink: newLink })

      const { result } = renderHook(() => useShareLinks())

      // Seed an existing link to verify prepend behaviour
      const existingLink = buildShareLink()
      await act(async () => {
        result.current.setShareLinks([existingLink])
        result.current.handleShareLinkDraftChange('label', 'Campaign link')
      })

      await act(async () => {
        await result.current.handleCreateShareLink('auth-token', 'campaign-1', vi.fn())
      })

      // New link must be first
      expect(result.current.shareLinks).toHaveLength(2)
      expect(result.current.shareLinks[0]).toBe(newLink)
      expect(result.current.shareLinks[1]).toBe(existingLink)

      // Draft must reset to defaults
      expect(result.current.shareLinkDraft.label).toBe('')
      expect(result.current.shareLinkDraft.accessLevel).toBe('editor')

      // Notice must be set
      expect(result.current.shareLinkNotice).not.toBeNull()
      expect(result.current.shareLinkNotice).toContain('Shared link created')

      // isCreatingShareLink must be cleared (finally block)
      expect(result.current.isCreatingShareLink).toBe(false)
    })

    it('error: calls onError with the error message and does not mutate shareLinks', async () => {
      createCampaignShareLinkMock.mockRejectedValue(new Error('Network failure'))

      const { result } = renderHook(() => useShareLinks())
      const onError = vi.fn()

      await act(async () => {
        await result.current.handleCreateShareLink('auth-token', 'campaign-1', onError)
      })

      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith('Network failure')
      expect(result.current.shareLinks).toHaveLength(0)
      expect(result.current.isCreatingShareLink).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // handleRevealShareLink
  // -------------------------------------------------------------------------

  describe('handleRevealShareLink', () => {
    it('success: stores { url, isVisible: false } keyed by shareLinkId', async () => {
      revealCampaignShareLinkMock.mockResolvedValue({ url: 'https://share.example.com/abc', token: 'tok' })

      const { result } = renderHook(() => useShareLinks())

      await act(async () => {
        await result.current.handleRevealShareLink('link-1', 'auth-token', 'campaign-1')
      })

      expect(result.current.revealedShareLinks['link-1']).toEqual({
        url: 'https://share.example.com/abc',
        isVisible: false,
      })
      expect(result.current.revealingShareLinkId).toBeNull()
    })

    it('error: stores per-link error in shareLinkActionErrors', async () => {
      revealCampaignShareLinkMock.mockRejectedValue(new Error('Forbidden'))

      const { result } = renderHook(() => useShareLinks())

      await act(async () => {
        await result.current.handleRevealShareLink('link-2', 'auth-token', 'campaign-1')
      })

      expect(result.current.shareLinkActionErrors['link-2']).toBe('Forbidden')
      expect(result.current.revealedShareLinks['link-2']).toBeUndefined()
      expect(result.current.revealingShareLinkId).toBeNull()
    })

    it('clears a prior action error for the same id before the API resolves (synchronous, not post-success)', async () => {
      // Use a never-resolving promise so we can observe the in-flight state:
      // the action error must be gone BEFORE the API resolves, not as a side-
      // effect of the success branch. A future refactor that moves the clear
      // into the try block would silently break UX and must fail this test.
      let resolveReveal: (value: { url: string; token: string }) => void = () => {}
      revealCampaignShareLinkMock.mockReturnValue(
        new Promise((resolve) => {
          resolveReveal = resolve
        }),
      )

      const { result } = renderHook(() => useShareLinks())

      // Seed a prior error for this id
      await act(async () => {
        result.current.setShareLinkActionErrors({ 'link-3': 'Old error' })
      })

      // Kick off the reveal — DO NOT await; we want to inspect mid-flight.
      let revealPromise: Promise<void> = Promise.resolve()
      act(() => {
        revealPromise = result.current.handleRevealShareLink('link-3', 'auth-token', 'campaign-1')
      })

      // Synchronously after the call: error already cleared, reveal is in flight.
      expect(result.current.shareLinkActionErrors['link-3']).toBeUndefined()
      expect(result.current.revealingShareLinkId).toBe('link-3')

      // Clean up: resolve and let the promise settle.
      await act(async () => {
        resolveReveal({ url: 'https://share.example.com/xyz', token: 'tok' })
        await revealPromise
      })
    })

    it('clears copiedShareLinkId when it matches the id being revealed', async () => {
      revealCampaignShareLinkMock.mockResolvedValue({ url: 'https://share.example.com/def', token: 'tok' })

      const { result } = renderHook(() => useShareLinks())

      // Seed a copied id that matches the reveal target
      await act(async () => {
        result.current.setCopiedShareLinkId('link-4')
      })

      await act(async () => {
        await result.current.handleRevealShareLink('link-4', 'auth-token', 'campaign-1')
      })

      expect(result.current.copiedShareLinkId).toBeNull()
    })

    it('does not clear copiedShareLinkId when it is a different id', async () => {
      revealCampaignShareLinkMock.mockResolvedValue({ url: 'https://share.example.com/ghi', token: 'tok' })

      const { result } = renderHook(() => useShareLinks())

      // Seed a copied id for a different link
      await act(async () => {
        result.current.setCopiedShareLinkId('other-link')
      })

      await act(async () => {
        await result.current.handleRevealShareLink('link-5', 'auth-token', 'campaign-1')
      })

      expect(result.current.copiedShareLinkId).toBe('other-link')
    })
  })

  // -------------------------------------------------------------------------
  // handleToggleShareLinkVisibility
  // -------------------------------------------------------------------------

  describe('handleToggleShareLinkVisibility', () => {
    it('no-op when the link is not revealed', async () => {
      const { result } = renderHook(() => useShareLinks())

      await act(async () => {
        result.current.handleToggleShareLinkVisibility('not-revealed')
      })

      expect(result.current.revealedShareLinks['not-revealed']).toBeUndefined()
    })

    it('flips isVisible from false to true when the link is already revealed', async () => {
      const { result } = renderHook(() => useShareLinks())

      // Seed a revealed link with isVisible: false
      await act(async () => {
        result.current.setRevealedShareLinks({
          'link-v': { url: 'https://example.com', isVisible: false },
        })
      })

      await act(async () => {
        result.current.handleToggleShareLinkVisibility('link-v')
      })

      expect(result.current.revealedShareLinks['link-v'].isVisible).toBe(true)
    })

    it('flips isVisible from true back to false on a second call', async () => {
      const { result } = renderHook(() => useShareLinks())

      await act(async () => {
        result.current.setRevealedShareLinks({
          'link-v2': { url: 'https://example.com', isVisible: true },
        })
      })

      await act(async () => {
        result.current.handleToggleShareLinkVisibility('link-v2')
      })

      expect(result.current.revealedShareLinks['link-v2'].isVisible).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // handleCopyShareLink
  // -------------------------------------------------------------------------

  describe('handleCopyShareLink', () => {
    it('returns silently without touching state when the link is not revealed', async () => {
      const { result } = renderHook(() => useShareLinks())
      const onError = vi.fn()

      await act(async () => {
        await result.current.handleCopyShareLink('not-revealed', onError)
      })

      expect(writeTextMock).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(result.current.copiedShareLinkId).toBeNull()
    })

    it('success: sets copiedShareLinkId and clears any prior action error for that id', async () => {
      writeTextMock.mockResolvedValue(undefined)

      const { result } = renderHook(() => useShareLinks())

      await act(async () => {
        result.current.setRevealedShareLinks({
          'link-c': { url: 'https://copy.example.com', isVisible: false },
        })
        // Seed a prior error
        result.current.setShareLinkActionErrors({ 'link-c': 'Old copy error' })
      })

      await act(async () => {
        await result.current.handleCopyShareLink('link-c', vi.fn())
      })

      expect(writeTextMock).toHaveBeenCalledOnce()
      expect(writeTextMock).toHaveBeenCalledWith('https://copy.example.com')
      expect(result.current.copiedShareLinkId).toBe('link-c')
      // Prior error must be cleared on success
      expect(result.current.shareLinkActionErrors['link-c']).toBeUndefined()
    })

    it('error: sets per-link error AND calls onError when clipboard rejects', async () => {
      writeTextMock.mockRejectedValue(new Error('Clipboard denied'))

      const { result } = renderHook(() => useShareLinks())

      await act(async () => {
        result.current.setRevealedShareLinks({
          'link-ce': { url: 'https://err.example.com', isVisible: false },
        })
      })

      const onError = vi.fn()

      await act(async () => {
        await result.current.handleCopyShareLink('link-ce', onError)
      })

      expect(result.current.shareLinkActionErrors['link-ce']).toBe('Clipboard denied')
      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith('Clipboard denied')
      expect(result.current.copiedShareLinkId).toBeNull()
    })

    // The execCommand fallback path is non-trivial: the file-level
    // Object.defineProperty(navigator, 'clipboard', ...) provides `writeText`,
    // so the fallback test will need to TEMPORARILY remove `writeText` from
    // the existing mock (not redefine `clipboard` to `{}`, which would shadow
    // the override and leak across tests). Then `vi.spyOn(document, 'execCommand')`
    // plus DOM-lifecycle assertions on the hidden textarea. Deferred to a
    // follow-up slice.
    it.todo('falls back to execCommand when clipboard.writeText is unavailable')
  })

  // -------------------------------------------------------------------------
  // handleRevokeShareLink
  // -------------------------------------------------------------------------

  describe('handleRevokeShareLink', () => {
    it('success: removes the link from shareLinks and clears revealed/errors/copied state for that id', async () => {
      revokeCampaignShareLinkMock.mockResolvedValue(undefined)

      const { result } = renderHook(() => useShareLinks())
      const linkToRevoke = buildShareLink({ id: 'link-r' })
      const otherLink = buildShareLink({ id: 'link-keep' })

      // Seed state
      await act(async () => {
        result.current.setShareLinks([linkToRevoke, otherLink])
        result.current.setRevealedShareLinks({
          'link-r': { url: 'https://revoke.example.com', isVisible: true },
          'link-keep': { url: 'https://keep.example.com', isVisible: false },
        })
        result.current.setShareLinkActionErrors({ 'link-r': 'Some error' })
        result.current.setCopiedShareLinkId('link-r')
      })

      await act(async () => {
        await result.current.handleRevokeShareLink('link-r', 'auth-token', 'campaign-1', vi.fn())
      })

      // Revoked link removed; other link intact
      expect(result.current.shareLinks).toHaveLength(1)
      expect(result.current.shareLinks[0].id).toBe('link-keep')

      // Revealed state cleared for revoked id; other id preserved
      expect(result.current.revealedShareLinks['link-r']).toBeUndefined()
      expect(result.current.revealedShareLinks['link-keep']).toBeDefined()

      // Error cleared for revoked id
      expect(result.current.shareLinkActionErrors['link-r']).toBeUndefined()

      // Copied id cleared
      expect(result.current.copiedShareLinkId).toBeNull()
    })

    it('error: calls onError with the error message and leaves shareLinks unchanged', async () => {
      revokeCampaignShareLinkMock.mockRejectedValue(new Error('Server error'))

      const { result } = renderHook(() => useShareLinks())
      const link = buildShareLink({ id: 'link-re' })
      const onError = vi.fn()

      await act(async () => {
        result.current.setShareLinks([link])
      })

      await act(async () => {
        await result.current.handleRevokeShareLink('link-re', 'auth-token', 'campaign-1', onError)
      })

      expect(onError).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith('Server error')
      expect(result.current.shareLinks).toHaveLength(1)
    })
  })
})
