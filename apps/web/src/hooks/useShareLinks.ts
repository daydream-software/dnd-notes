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
}

export interface RevealedShareLink {
  url: string
  isVisible: boolean
}

export function createShareLinkDraft(): ShareLinkDraft {
  return {
    label: '',
    accessLevel: 'editor',
    frameAncestors: '',
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
    frameAncestors: trimToNull(draft.frameAncestors),
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
    handleShareLinkDraftChange,
    handleCreateShareLink,
    handleRevealShareLink,
    handleToggleShareLinkVisibility,
    handleCopyShareLink,
    handleRevokeShareLink,
  }
}
