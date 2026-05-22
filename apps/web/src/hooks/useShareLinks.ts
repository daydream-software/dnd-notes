import { useCallback, useState } from 'react'
import {
  createCampaignShareLink,
  revealCampaignShareLink,
  revokeCampaignShareLink,
} from '../api'
import type { CampaignShareLink, CampaignShareLinkInput, ShareAccessLevel } from '../types'

export interface ShareLinkDraft {
  label: string
  accessLevel: ShareAccessLevel
  frameAncestors: string
  allowExtensions: boolean
}

export interface RevealedShareLink {
  url: string
  isVisible: boolean
}

/** The three extension scheme-sources, in a stable order. */
export const EXTENSION_SCHEME_SOURCES = [
  'chrome-extension:',
  'moz-extension:',
  'safari-web-extension:',
] as const

const extensionSchemeSet = new Set<string>(EXTENSION_SCHEME_SOURCES)

/**
 * Parse a stored `frameAncestors` string into the form's two-part representation:
 * - `origins`: the portion the user types (everything that is not an extension scheme-source)
 * - `allowExtensions`: whether any of the three extension scheme-sources were present
 */
export function parseFrameAncestors(stored: string): {
  origins: string
  allowExtensions: boolean
} {
  const parts = stored.trim().split(/\s+/).filter(Boolean)
  const origins = parts.filter((p) => !extensionSchemeSet.has(p)).join(' ')
  const allowExtensions = parts.some((p) => extensionSchemeSet.has(p))
  return { origins, allowExtensions }
}

/**
 * Compose the stored `frameAncestors` value from the form's two-part representation.
 * Returns `null` when the composed value would be empty.
 */
export function composeFrameAncestors(
  origins: string,
  allowExtensions: boolean,
): string | null {
  // Extension scheme-sources are controlled solely by the checkbox, so strip any
  // a user typed into the origins field — keeps the checkbox authoritative and
  // avoids duplicates when it is also checked.
  const parts: string[] = origins
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '' && !extensionSchemeSet.has(part))
  if (allowExtensions) {
    parts.push(...EXTENSION_SCHEME_SOURCES)
  }
  const composed = parts.join(' ')
  return composed === '' ? null : composed
}

export function createShareLinkDraft(): ShareLinkDraft {
  return {
    label: '',
    accessLevel: 'editor',
    frameAncestors: '',
    allowExtensions: false,
  }
}

function trimToNull(value: string): string | null {
  const trimmedValue = value.trim()
  return trimmedValue === '' ? null : trimmedValue
}

function createShareLinkPayload(draft: ShareLinkDraft): CampaignShareLinkInput {
  return {
    label: trimToNull(draft.label),
    accessLevel: draft.accessLevel,
    frameAncestors: composeFrameAncestors(draft.frameAncestors, draft.allowExtensions),
  }
}

function deleteRecordKey<Value>(record: Record<string, Value>, key: string): Record<string, Value> {
  const nextRecord = { ...record }
  delete nextRecord[key]
  return nextRecord
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof window !== 'undefined' && window.navigator.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(value)
    return
  }

  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    document.body.append(textarea)
    textarea.select()

    try {
      if (document.execCommand('copy')) {
        return
      }
    } finally {
      document.body.removeChild(textarea)
    }
  }

  throw new Error('Clipboard access is unavailable. Reveal the link and copy it manually.')
}

export interface UseShareLinksResult {
  shareLinks: CampaignShareLink[]
  shareLinkDraft: ShareLinkDraft
  shareLinkNotice: string | null
  revealedShareLinks: Record<string, RevealedShareLink>
  shareLinkActionErrors: Record<string, string>
  revealingShareLinkId: string | null
  copiedShareLinkId: string | null
  isCreatingShareLink: boolean
  setShareLinks: React.Dispatch<React.SetStateAction<CampaignShareLink[]>>
  setShareLinkDraft: React.Dispatch<React.SetStateAction<ShareLinkDraft>>
  setShareLinkNotice: React.Dispatch<React.SetStateAction<string | null>>
  setRevealedShareLinks: React.Dispatch<React.SetStateAction<Record<string, RevealedShareLink>>>
  setShareLinkActionErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setRevealingShareLinkId: React.Dispatch<React.SetStateAction<string | null>>
  setCopiedShareLinkId: React.Dispatch<React.SetStateAction<string | null>>
  resetShareLinkInteractionState: () => void
  resetShareLinks: () => void
  handleShareLinkDraftChange: <Field extends keyof ShareLinkDraft>(
    field: Field,
    value: ShareLinkDraft[Field],
  ) => void
  handleCreateShareLink: (
    authToken: string,
    selectedCampaignId: string,
    onError: (message: string) => void,
  ) => Promise<void>
  handleRevealShareLink: (
    shareLinkId: string,
    authToken: string,
    selectedCampaignId: string,
  ) => Promise<void>
  handleToggleShareLinkVisibility: (shareLinkId: string) => void
  handleCopyShareLink: (
    shareLinkId: string,
    onError: (message: string) => void,
  ) => Promise<void>
  handleRevokeShareLink: (
    shareLinkId: string,
    authToken: string,
    selectedCampaignId: string,
    onError: (message: string) => void,
  ) => Promise<void>
}

export function useShareLinks(): UseShareLinksResult {
  const [shareLinks, setShareLinks] = useState<CampaignShareLink[]>([])
  const [shareLinkDraft, setShareLinkDraft] = useState<ShareLinkDraft>(createShareLinkDraft)
  const [shareLinkNotice, setShareLinkNotice] = useState<string | null>(null)
  const [revealedShareLinks, setRevealedShareLinks] = useState<Record<string, RevealedShareLink>>(
    {},
  )
  const [shareLinkActionErrors, setShareLinkActionErrors] = useState<Record<string, string>>({})
  const [revealingShareLinkId, setRevealingShareLinkId] = useState<string | null>(null)
  const [copiedShareLinkId, setCopiedShareLinkId] = useState<string | null>(null)
  const [isCreatingShareLink, setIsCreatingShareLink] = useState(false)

  const resetShareLinkInteractionState = useCallback(() => {
    setShareLinkNotice(null)
    setRevealedShareLinks({})
    setShareLinkActionErrors({})
    setRevealingShareLinkId(null)
    setCopiedShareLinkId(null)
  }, [])

  const resetShareLinks = useCallback(() => {
    setShareLinks([])
    setShareLinkDraft(createShareLinkDraft())
    setShareLinkNotice(null)
    setRevealedShareLinks({})
    setShareLinkActionErrors({})
    setRevealingShareLinkId(null)
    setCopiedShareLinkId(null)
  }, [])

  const handleShareLinkDraftChange = useCallback(
    <Field extends keyof ShareLinkDraft>(field: Field, value: ShareLinkDraft[Field]) => {
      setShareLinkDraft((currentDraft) => ({
        ...currentDraft,
        [field]: value,
      }))
    },
    [],
  )

  const handleCreateShareLink = useCallback(
    async (
      authToken: string,
      selectedCampaignId: string,
      onError: (message: string) => void,
    ): Promise<void> => {
      setIsCreatingShareLink(true)

      try {
        const created = await createCampaignShareLink(
          authToken,
          selectedCampaignId,
          createShareLinkPayload(shareLinkDraft),
        )

        setShareLinks((currentLinks) => [created.shareLink, ...currentLinks])
        setShareLinkDraft(createShareLinkDraft())
        resetShareLinkInteractionState()
        setShareLinkNotice(
          'Shared link created. Reveal it on the card when you need to copy it again.',
        )
      } catch (shareLinkError) {
        onError(
          shareLinkError instanceof Error
            ? shareLinkError.message
            : 'Could not create the share link.',
        )
      } finally {
        setIsCreatingShareLink(false)
      }
    },
    [resetShareLinkInteractionState, shareLinkDraft],
  )

  const handleRevealShareLink = useCallback(
    async (
      shareLinkId: string,
      authToken: string,
      selectedCampaignId: string,
    ): Promise<void> => {
      setShareLinkNotice(null)
      setCopiedShareLinkId((currentId) => (currentId === shareLinkId ? null : currentId))
      setShareLinkActionErrors((currentErrors) => deleteRecordKey(currentErrors, shareLinkId))
      setRevealingShareLinkId(shareLinkId)

      try {
        const revealed = await revealCampaignShareLink(authToken, selectedCampaignId, shareLinkId)

        setRevealedShareLinks((currentLinks) => ({
          ...currentLinks,
          [shareLinkId]: {
            url: revealed.url,
            isVisible: false,
          },
        }))
      } catch (shareLinkError) {
        setShareLinkActionErrors((currentErrors) => ({
          ...currentErrors,
          [shareLinkId]:
            shareLinkError instanceof Error
              ? shareLinkError.message
              : 'Could not reveal the shared link.',
        }))
      } finally {
        setRevealingShareLinkId((currentId) => (currentId === shareLinkId ? null : currentId))
      }
    },
    [],
  )

  const handleToggleShareLinkVisibility = useCallback((shareLinkId: string) => {
    setRevealedShareLinks((currentLinks) => {
      const revealedShareLink = currentLinks[shareLinkId]

      if (!revealedShareLink) {
        return currentLinks
      }

      return {
        ...currentLinks,
        [shareLinkId]: {
          ...revealedShareLink,
          isVisible: !revealedShareLink.isVisible,
        },
      }
    })
  }, [])

  const handleCopyShareLink = useCallback(
    async (
      shareLinkId: string,
      onError: (message: string) => void,
    ): Promise<void> => {
      const revealedShareLink = revealedShareLinks[shareLinkId]

      if (!revealedShareLink) {
        return
      }

      setShareLinkNotice(null)

      try {
        await copyTextToClipboard(revealedShareLink.url)
        setShareLinkActionErrors((currentErrors) => deleteRecordKey(currentErrors, shareLinkId))
        setCopiedShareLinkId(shareLinkId)
      } catch (shareLinkError) {
        setShareLinkActionErrors((currentErrors) => ({
          ...currentErrors,
          [shareLinkId]:
            shareLinkError instanceof Error
              ? shareLinkError.message
              : 'Could not copy the shared link.',
        }))
        onError(
          shareLinkError instanceof Error
            ? shareLinkError.message
            : 'Could not copy the shared link.',
        )
      }
    },
    [revealedShareLinks],
  )

  const handleRevokeShareLink = useCallback(
    async (
      shareLinkId: string,
      authToken: string,
      selectedCampaignId: string,
      onError: (message: string) => void,
    ): Promise<void> => {
      try {
        await revokeCampaignShareLink(authToken, selectedCampaignId, shareLinkId)
        setShareLinks((currentLinks) =>
          currentLinks.filter((link) => link.id !== shareLinkId),
        )
        setRevealedShareLinks((currentLinks) => deleteRecordKey(currentLinks, shareLinkId))
        setShareLinkActionErrors((currentErrors) =>
          deleteRecordKey(currentErrors, shareLinkId),
        )
        setCopiedShareLinkId((currentId) => (currentId === shareLinkId ? null : currentId))
        setShareLinkNotice(null)
      } catch (shareLinkError) {
        onError(
          shareLinkError instanceof Error
            ? shareLinkError.message
            : 'Could not revoke the share link.',
        )
      }
    },
    [],
  )

  return {
    shareLinks,
    shareLinkDraft,
    shareLinkNotice,
    revealedShareLinks,
    shareLinkActionErrors,
    revealingShareLinkId,
    copiedShareLinkId,
    isCreatingShareLink,
    setShareLinks,
    setShareLinkDraft,
    setShareLinkNotice,
    setRevealedShareLinks,
    setShareLinkActionErrors,
    setRevealingShareLinkId,
    setCopiedShareLinkId,
    resetShareLinkInteractionState,
    resetShareLinks,
    handleShareLinkDraftChange,
    handleCreateShareLink,
    handleRevealShareLink,
    handleToggleShareLinkVisibility,
    handleCopyShareLink,
    handleRevokeShareLink,
  }
}
