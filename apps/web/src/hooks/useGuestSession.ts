import { useCallback, useEffect, useState } from 'react'
import {
  claimSharedMembership,
  fetchSharedSession,
  joinSharedCampaign,
} from '../api'
import { isKeycloakAuthConfig } from '../keycloak-client'
import {
  missingKeycloakClientErrorMessage,
} from './useSession'
import { selectedCampaignStorageKey } from './useCampaign'
import type {
  AuthConfigResponse,
  CampaignMembership,
  CampaignShareLink,
  CampaignSummary,
  GuestJoinInput,
  Note,
  NotesOverview,
} from '../types'
import type { RuntimeKeycloakClient } from '../keycloak-client'
import type { NoteDraft, NoteBrowseMode } from './useNotes'

export interface UseGuestSessionParams {
  shareToken: string | null
  guestStorageKey: string | null
  isSharedMode: boolean
  // Campaign state setters — App owns the state, hook drives updates
  setSharedCampaign: React.Dispatch<React.SetStateAction<CampaignSummary | null>>
  setShareLink: React.Dispatch<React.SetStateAction<CampaignShareLink | null>>
  // From useSession
  authToken: string | null
  authConfig: AuthConfigResponse | null
  owner: { displayName: string } | null
  keycloakClientRef: React.RefObject<RuntimeKeycloakClient | null>
  setAccountNotice: React.Dispatch<React.SetStateAction<string | null>>
  setIsLinkingAccount: React.Dispatch<React.SetStateAction<boolean>>
  // From useCampaign
  setSelectedCampaignId: React.Dispatch<React.SetStateAction<string | null>>
  setCampaigns: React.Dispatch<React.SetStateAction<CampaignSummary[]>>
  // From useNotes
  setNoteBrowseMode: React.Dispatch<React.SetStateAction<NoteBrowseMode>>
  setSelectedSessionName: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedActivityMembershipId: React.Dispatch<React.SetStateAction<string | null>>
  setOverview: React.Dispatch<React.SetStateAction<NotesOverview | null>>
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  setSelectedNoteId: React.Dispatch<React.SetStateAction<string | null>>
  setIsCreating: React.Dispatch<React.SetStateAction<boolean>>
  setDraft: React.Dispatch<React.SetStateAction<NoteDraft>>
  // Callbacks
  loadSharedWorkspace: (
    activeGuestToken: string,
    preferredNoteId?: string | null,
    accessLevel?: CampaignShareLink['accessLevel'],
  ) => Promise<boolean | 'stale'>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  createEmptyDraft: () => NoteDraft
}

export interface UseGuestSessionResult {
  sharedMembership: CampaignMembership | null
  guestToken: string | null
  isSharedReady: boolean
  isJoining: boolean
  joinDraft: GuestJoinInput
  setSharedMembership: React.Dispatch<React.SetStateAction<CampaignMembership | null>>
  setGuestToken: React.Dispatch<React.SetStateAction<string | null>>
  setJoinDraft: React.Dispatch<React.SetStateAction<GuestJoinInput>>
  handleJoinSharedCampaign: () => Promise<void>
  handleLinkSharedMembership: () => Promise<void>
}

export function useGuestSession({
  shareToken,
  guestStorageKey,
  isSharedMode,
  setSharedCampaign,
  setShareLink,
  authToken,
  authConfig,
  owner,
  keycloakClientRef,
  setAccountNotice,
  setIsLinkingAccount,
  setSelectedCampaignId,
  setCampaigns,
  setNoteBrowseMode,
  setSelectedSessionName,
  setSelectedActivityMembershipId,
  setOverview,
  setNotes,
  setSelectedNoteId,
  setIsCreating,
  setDraft,
  loadSharedWorkspace,
  setError,
  createEmptyDraft,
}: UseGuestSessionParams): UseGuestSessionResult {
  const [sharedMembership, setSharedMembership] = useState<CampaignMembership | null>(null)
  const [guestToken, setGuestToken] = useState<string | null>(null)
  const [isSharedReady, setIsSharedReady] = useState(!isSharedMode)
  const [isJoining, setIsJoining] = useState(false)
  const [joinDraft, setJoinDraft] = useState<GuestJoinInput>({ displayName: '' })

  // Bootstrap shared session
  useEffect(() => {
    if (!isSharedMode || !shareToken || !guestStorageKey) {
      return
    }

    let cancelled = false

    const bootstrapSharedSession = async () => {
      const storedGuestToken = localStorage.getItem(guestStorageKey)

      try {
        const session = await fetchSharedSession(shareToken, storedGuestToken)

        if (cancelled) {
          return
        }

        setSharedCampaign(session.campaign)
        setShareLink(session.shareLink)
        setSharedMembership(session.membership)
        setSelectedCampaignId(session.campaign.id)
        setCampaigns([session.campaign])
        setError(null)

        if (session.membership && storedGuestToken) {
          setGuestToken(storedGuestToken)
          await loadSharedWorkspace(storedGuestToken, undefined, session.shareLink.accessLevel)
        } else {
          localStorage.removeItem(guestStorageKey)
          setGuestToken(null)
          setOverview(null)
          setNotes([])
          setSelectedNoteId(null)
          setIsCreating(false)
          setDraft(createEmptyDraft())
          setAccountNotice(null)
        }
      } catch (sessionError) {
        if (!cancelled) {
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : 'Could not load the shared campaign.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsSharedReady(true)
        }
      }
    }

    void bootstrapSharedSession()

    return () => {
      cancelled = true
    }
  }, [
    createEmptyDraft,
    guestStorageKey,
    isSharedMode,
    loadSharedWorkspace,
    setAccountNotice,
    setCampaigns,
    setDraft,
    setError,
    setIsCreating,
    setNotes,
    setOverview,
    setSelectedCampaignId,
    setSelectedNoteId,
    setShareLink,
    setSharedCampaign,
    shareToken,
  ])

  const handleJoinSharedCampaign = useCallback(async () => {
    if (!shareToken || !guestStorageKey) {
      return
    }

    setError(null)
    setAccountNotice(null)
    setIsJoining(true)

    try {
      const response = await joinSharedCampaign(shareToken, joinDraft)

      localStorage.setItem(guestStorageKey, response.guestToken)
      setGuestToken(response.guestToken)
      setSharedCampaign(response.campaign)
      setShareLink(response.shareLink)
      setSharedMembership(response.membership)
      setSelectedCampaignId(response.campaign.id)
      setCampaigns([response.campaign])
      setNoteBrowseMode('notes')
      setSelectedSessionName(null)
      setSelectedActivityMembershipId(null)
      await loadSharedWorkspace(response.guestToken, undefined, response.shareLink.accessLevel)
    } catch (joinError) {
      setError(
        joinError instanceof Error ? joinError.message : 'Could not join the shared campaign.',
      )
    } finally {
      setIsJoining(false)
    }
  }, [
    guestStorageKey,
    joinDraft,
    loadSharedWorkspace,
    setAccountNotice,
    setCampaigns,
    setError,
    setNoteBrowseMode,
    setSelectedActivityMembershipId,
    setSelectedCampaignId,
    setSelectedSessionName,
    setShareLink,
    setSharedCampaign,
    shareToken,
  ])

  const handleLinkSharedMembership = useCallback(async () => {
    if (!shareToken || !guestToken || !sharedMembership || !guestStorageKey) {
      return
    }

    setError(null)
    setAccountNotice(null)
    setIsLinkingAccount(true)

    try {
      if (isKeycloakAuthConfig(authConfig)) {
        if (!authToken) {
          const keycloakClient = keycloakClientRef.current

          if (!keycloakClient) {
            throw new Error(missingKeycloakClientErrorMessage)
          }

          await keycloakClient.login(window.location.href)
          return
        }

        const claimedMembership = await claimSharedMembership(
          shareToken,
          authToken,
          guestToken,
        )

        if (claimedMembership.guestToken) {
          localStorage.setItem(guestStorageKey, claimedMembership.guestToken)
          setGuestToken(claimedMembership.guestToken)
        }

        localStorage.setItem(selectedCampaignStorageKey, claimedMembership.membership.campaignId)
        setSharedMembership(claimedMembership.membership)
        setAccountNotice(
          owner ? `Linked to ${owner.displayName}.` : 'Linked this guest membership.',
        )
      }
    } catch (linkError) {
      setError(
        linkError instanceof Error
          ? linkError.message
          : 'Could not link this guest membership to a real account.',
      )
    } finally {
      setIsLinkingAccount(false)
    }
  }, [
    authConfig,
    authToken,
    guestStorageKey,
    guestToken,
    keycloakClientRef,
    owner,
    setAccountNotice,
    setError,
    setIsLinkingAccount,
    sharedMembership,
    shareToken,
  ])

  return {
    sharedMembership,
    guestToken,
    isSharedReady,
    isJoining,
    joinDraft,
    setSharedMembership,
    setGuestToken,
    setJoinDraft,
    handleJoinSharedCampaign,
    handleLinkSharedMembership,
  }
}
