import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  claimSharedMembership,
  fetchAuthConfig,
  fetchCampaignShareLinks,
  fetchCampaignMemberships,
  fetchCampaigns,
  fetchOwnerSession,
  fetchSessionNotes,
  fetchSharedSession,
  joinSharedCampaign,
  loginOwner,
  registerOwner,
} from './api'
import {
  createRuntimeKeycloakClient,
  isKeycloakAuthConfig,
} from './keycloak-client'
import { getNoteStarterTemplate } from './templates'
import type {
  CampaignMembership,
  CampaignShareLink,
  CampaignSummary,
  GuestJoinInput,
  Note,
  NoteActivityEntry,
} from './types'
import CampaignDetailPage from './pages/CampaignDetailPage'
import CampaignListPage from './pages/CampaignListPage'
import LoginPage from './pages/LoginPage'
import { WorkspaceLoadingView } from './WorkspaceLoadingView'
import { useShareLinks, createShareLinkDraft as createShareLinkDraftFn } from './hooks/useShareLinks'
import {
  useSession,
  authTokenStorageKey,
  missingKeycloakClientErrorMessage,
  readStoredKeycloakTokens,
  persistKeycloakTokens,
  clearStoredKeycloakTokens,
} from './hooks/useSession'
import {
  useCampaign,
  createCampaignDraft,
  createMembershipConsolidationDraft,
  selectedCampaignStorageKey,
  blankCampaignTemplateId,
  blankNoteTemplateId,
  type MembershipConsolidationDraft,
} from './hooks/useCampaign'

import {
  useNotes,
  createEmptyDraft as createEmptyDraftFn,
  createDraftFromNote,
} from './hooks/useNotes'

type NarrowWorkspacePanel = 'browse' | 'editor'

const guestTokenStoragePrefix = 'dnd-notes:guest-token:'

function getShareTokenFromPath(pathname: string) {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

function sortActivityEntries(entries: NoteActivityEntry[]) {
  return [...entries].sort((leftEntry, rightEntry) =>
    rightEntry.updatedAt.localeCompare(leftEntry.updatedAt),
  )
}

const heroCardRadius = '32px'
const surfaceRadius = '24px'

function getActivityAttribution(entry: NoteActivityEntry) {
  return entry.action === 'created'
    ? (entry.createdBy ?? entry.lastEditedBy)
    : (entry.lastEditedBy ?? entry.createdBy)
}

function App() {
  const theme = useTheme()
  const canSplitNoteWorkspace = useMediaQuery(theme.breakpoints.up('lg'))
  const shareToken = useMemo(
    () =>
      typeof window === 'undefined'
        ? null
        : getShareTokenFromPath(window.location.pathname),
    [],
  )
  const isSharedMode = shareToken !== null
  const guestStorageKey = shareToken ? `${guestTokenStoragePrefix}${shareToken}` : null
  const {
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
    resetShareLinkInteractionState,
    handleShareLinkDraftChange,
    handleRevealShareLink: handleRevealShareLinkFromHook,
    handleToggleShareLinkVisibility,
    handleCopyShareLink: handleCopyShareLinkFromHook,
    handleRevokeShareLink: handleRevokeShareLinkFromHook,
    handleCreateShareLink: handleCreateShareLinkFromHook,
  } = useShareLinks()
  const {
    authToken,
    owner,
    authConfig,
    isAuthReady,
    isRegisterMode,
    registerDraft,
    loginDraft,
    isSubmittingAuth,
    isLinkingAccount,
    accountNotice,
    keycloakClientRef,
    setAuthToken,
    setOwner,
    setAuthConfig,
    setIsAuthReady,
    setIsRegisterMode,
    setRegisterDraft,
    setLoginDraft,
    setIsLinkingAccount,
    setAccountNotice,
    handleSubmitAuth: handleSubmitAuthFromHook,
    handleLogout: handleLogoutFromHook,
  } = useSession()
  const {
    campaigns,
    selectedCampaignId,
    memberships,
    campaignDraft,
    campaignFormMode,
    selectedCampaignTemplateId,
    isSavingCampaign,
    membershipConsolidationDraft,
    membershipConsolidationPreview,
    membershipConsolidationNotice,
    isPreviewingMembershipConsolidation,
    isApplyingMembershipConsolidation,
    setCampaigns,
    setSelectedCampaignId,
    setMemberships,
    setCampaignDraft,
    setCampaignFormMode,
    setSelectedCampaignTemplateId,
    setMembershipConsolidationDraft,
    resetMembershipConsolidationState,
    handleCampaignDraftChange,
    handleMembershipConsolidationDraftChange: handleMembershipConsolidationDraftChangeFromHook,
    handleSaveCampaign: handleSaveCampaignFromHook,
    handlePreviewMembershipConsolidation: handlePreviewMembershipConsolidationFromHook,
    handleApplyMembershipConsolidation: handleApplyMembershipConsolidationFromHook,
    handleOpenCampaignCreate: handleOpenCampaignCreateFromHook,
    handleOpenCampaignSettings: handleOpenCampaignSettingsFromHook,
    handleCancelCampaignForm: handleCancelCampaignFormFromHook,
  } = useCampaign()
  const [sharedCampaign, setSharedCampaign] = useState<CampaignSummary | null>(null)
  const [shareLink, setShareLink] = useState<CampaignShareLink | null>(null)
  const [sharedMembership, setSharedMembership] = useState<CampaignMembership | null>(null)
  const [guestToken, setGuestToken] = useState<string | null>(null)
  const {
    overview,
    noteBrowseMode,
    sessionSummaries,
    selectedSessionName,
    activityEntries,
    activityCollaborators,
    selectedActivityMembershipId,
    selectedTagFilter,
    searchText,
    draft,
    tagInputValue,
    selectedNoteId,
    isCreating,
    isLoadingWorkspace,
    isLoadingSessionNotes,
    isLoadingActivity,
    isQuickCapturing,
    isSaving,
    isDeleting,
    selectedNoteTemplateId,
    quickCaptureTitle,
    isQuickCaptureOpen,
    selectedNote,
    filteredNotes,
    displayedNotes,
    tagFacets,
    draftTags,
    noteLinkOptions,
    linkedNotes,
    backlinks,
    sharedSessionSummaries,
    sharedActivityEntries,
    sharedActivityCollaborators,
    selectedNoteIdRef,
    selectedActivityMembershipIdRef,
    sessionRequestIdRef,
    sessionAbortControllerRef,
    setOverview,
    setNotes,
    setNoteBrowseMode,
    setSessionSummaries,
    setSelectedSessionName,
    setSessionNotes,
    setSelectedActivityMembershipId,
    setSelectedTagFilter,
    setSearchText,
    setDraft,
    setTagInputValue,
    setSelectedNoteId,
    setIsCreating,
    setIsLoadingSessionNotes,
    setSelectedNoteTemplateId,
    setQuickCaptureTitle,
    setIsQuickCaptureOpen,
    resetSessionBrowserState,
    resetActivityState,
    loadActivity,
    loadWorkspace: loadWorkspaceFromHook,
    loadSharedWorkspace: loadSharedWorkspaceFromHook,
    handleDraftChange,
    handleDraftTagsChange,
    commitPendingTagInput,
    handleSelectNote: handleSelectNoteFromHook,
    handleStartNote: handleStartNoteFromHook,
    handleSelectNoteTemplate: handleSelectNoteTemplateFromHook,
    handleSaveNote: handleSaveNoteFromHook,
    handleDeleteNote: handleDeleteNoteFromHook,
    handleQuickCapture: handleQuickCaptureFromHook,
  } = useNotes(isSharedMode)
  const [isSharedReady, setIsSharedReady] = useState(!isSharedMode)
  const [isJoining, setIsJoining] = useState(false)
  const [joinDraft, setJoinDraft] = useState<GuestJoinInput>({ displayName: '' })
  const [error, setError] = useState<string | null>(null)
  const [narrowWorkspacePanel, setNarrowWorkspacePanel] =
    useState<NarrowWorkspacePanel>('browse')
  const [wantsSplitNoteWorkspace, setWantsSplitNoteWorkspace] = useState(false)
  const showSplitNoteWorkspace = canSplitNoteWorkspace && wantsSplitNoteWorkspace
  const isBootstrapping = !isAuthReady || !isSharedReady

  const selectedCampaign = useMemo(
    () =>
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ??
      overview?.campaign ??
      null,
    [campaigns, overview, selectedCampaignId],
  )
  const resolvedCampaign = isSharedMode
    ? sharedCampaign ?? overview?.campaign ?? null
    : selectedCampaign
  const resolvedMembership = isSharedMode
    ? sharedMembership ?? overview?.membership ?? null
    : overview?.membership ?? null
  const canEditWorkspace = isSharedMode ? shareLink?.accessLevel === 'editor' : true

  const currentCampaignMemberships = useMemo(
    () =>
      memberships.filter(
        (membership) => membership.campaignId === selectedCampaignId,
      ),
    [memberships, selectedCampaignId],
  )
  const activeMembership = overview?.membership ?? null
  const canManageSelectedCampaign = activeMembership?.role === 'owner'
  const selectedNoteTemplate = getNoteStarterTemplate(selectedNoteTemplateId)
  const resolvedSessionSummaries = isSharedMode ? sharedSessionSummaries : sessionSummaries
  const resolvedSelectedSessionSummary = useMemo(
    () =>
      resolvedSessionSummaries.find(
        (sessionSummary) => sessionSummary.sessionName === selectedSessionName,
      ) ?? null,
    [resolvedSessionSummaries, selectedSessionName],
  )
  const resolvedActivityCollaborators = isSharedMode
    ? sharedActivityCollaborators
    : activityCollaborators
  const resolvedSelectedActivityCollaborator = useMemo(
    () =>
      resolvedActivityCollaborators.find(
        (collaborator) => collaborator.membershipId === selectedActivityMembershipId,
      ) ?? null,
    [resolvedActivityCollaborators, selectedActivityMembershipId],
  )
  const selectedSourceMembership = useMemo(
    () =>
      currentCampaignMemberships.find(
        (membership) => membership.id === membershipConsolidationDraft.sourceMembershipId,
      ) ?? null,
    [currentCampaignMemberships, membershipConsolidationDraft.sourceMembershipId],
  )
  const selectedTargetMembership = useMemo(
    () =>
      currentCampaignMemberships.find(
        (membership) => membership.id === membershipConsolidationDraft.targetMembershipId,
      ) ?? null,
    [currentCampaignMemberships, membershipConsolidationDraft.targetMembershipId],
  )
  const selectedTagFacet = useMemo(
    () =>
      selectedTagFilter
        ? tagFacets.find((tagFacet) => tagFacet.tag === selectedTagFilter) ?? null
        : null,
    [selectedTagFilter, tagFacets],
  )
  const hasValidMembershipConsolidationSelection =
    membershipConsolidationDraft.sourceMembershipId.length > 0 &&
    membershipConsolidationDraft.targetMembershipId.length > 0 &&
    membershipConsolidationDraft.sourceMembershipId !==
      membershipConsolidationDraft.targetMembershipId
  const canApplyMembershipConsolidation =
    membershipConsolidationPreview !== null &&
    !membershipConsolidationPreview.applied &&
    membershipConsolidationPreview.sourceMembership.id ===
      membershipConsolidationDraft.sourceMembershipId &&
    membershipConsolidationPreview.targetMembership.id ===
      membershipConsolidationDraft.targetMembershipId &&
    (!membershipConsolidationPreview.requiresRoleMismatchConfirmation ||
      membershipConsolidationDraft.confirmRoleMismatch)
  const sortedActivityEntries = useMemo(
    () =>
      sortActivityEntries(
        isSharedMode
          ? selectedActivityMembershipId
            ? sharedActivityEntries.filter(
                (entry) =>
                  getActivityAttribution(entry)?.membershipId === selectedActivityMembershipId,
              )
            : sharedActivityEntries
          : activityEntries,
      ),
    [activityEntries, isSharedMode, selectedActivityMembershipId, sharedActivityEntries],
  )
  const showBrowsePane = showSplitNoteWorkspace || narrowWorkspacePanel === 'browse'
  const showEditorPane = showSplitNoteWorkspace || narrowWorkspacePanel === 'editor'
  const workspaceEditorLabel =
    !canEditWorkspace
      ? 'View note'
      : isCreating || selectedNote === null
        ? 'Create note'
        : 'Edit note'
  const useCompactDesktopHeader = canSplitNoteWorkspace
  const resolvedCampaignOptions =
    isSharedMode && resolvedCampaign
      ? [{ id: resolvedCampaign.id, name: resolvedCampaign.name }]
      : campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name }))
  const resolvedSelectedCampaignId = isSharedMode
    ? resolvedCampaign?.id ?? null
    : selectedCampaignId ?? overview?.campaign.id ?? null
  const resolvedDesktopSubtitle = resolvedCampaign
    ? `${resolvedCampaign.setting} • ${resolvedCampaign.system} • ${
        isSharedMode ? resolvedMembership?.displayName ?? 'Guest' : owner?.displayName ?? ''
      }`
    : ''

  useEffect(() => {
    if (
      selectedTagFilter &&
      !tagFacets.some((tagFacet) => tagFacet.tag === selectedTagFilter)
    ) {
      setSelectedTagFilter(null)
    }
  }, [selectedTagFilter, tagFacets])

  const clearSession = useCallback(() => {
    localStorage.removeItem(authTokenStorageKey)
    clearStoredKeycloakTokens()
    localStorage.removeItem(selectedCampaignStorageKey)
    keycloakClientRef.current?.clear()
    keycloakClientRef.current = null
    resetSessionBrowserState()
    resetActivityState()
    setAuthToken(null)
    setOwner(null)
    setCampaigns([])
    setSelectedCampaignId(null)
    setMemberships([])
    setShareLinks([])
    setOverview(null)
    setNotes([])
    setNoteBrowseMode('notes')
    setNarrowWorkspacePanel('browse')
    setSessionSummaries([])
    setQuickCaptureTitle('')
    setSelectedNoteId(null)
    setDraft(createEmptyDraftFn())
    setCampaignDraft(createCampaignDraft())
    setShareLinkDraft(createShareLinkDraftFn())
    setMembershipConsolidationDraft(createMembershipConsolidationDraft())
    setCampaignFormMode('closed')
    setSelectedCampaignTemplateId(blankCampaignTemplateId)
    setSelectedNoteTemplateId(blankNoteTemplateId)
    resetShareLinkInteractionState()
    resetMembershipConsolidationState()
  }, [
    resetActivityState,
    resetMembershipConsolidationState,
    resetSessionBrowserState,
    resetShareLinkInteractionState,
  ])

  const loadWorkspace = useCallback(
    async (
      sessionToken: string,
      campaignId: string,
      preferredNoteId?: string | null,
      suppressError = false,
    ): Promise<boolean | 'stale'> => {
      const ok = await loadWorkspaceFromHook(
        sessionToken,
        campaignId,
        preferredNoteId,
        suppressError,
        (id) => setSelectedCampaignId(id),
        (campaign) => setCampaignDraft(createCampaignDraft(campaign)),
        (message) => setError(message),
      )
      if (ok === true) {
        localStorage.setItem(selectedCampaignStorageKey, campaignId)
        setError(null)
      }
      return ok
    },
    [loadWorkspaceFromHook, setCampaignDraft, setSelectedCampaignId],
  )

  const loadSharedWorkspace = useCallback(
    async (
      activeGuestToken: string,
      preferredNoteId?: string | null,
      accessLevel?: CampaignShareLink['accessLevel'],
    ): Promise<boolean | 'stale'> => {
      const ok = await loadSharedWorkspaceFromHook(
        shareToken as string,
        activeGuestToken,
        preferredNoteId,
        accessLevel,
        shareLink,
        (campaign) => {
          setSharedCampaign(campaign)
          setSelectedCampaignId(campaign.id)
          setCampaigns([campaign])
        },
        (message) => setError(message),
      )
      if (ok === true) {
        setError(null)
      }
      return ok
    },
    [loadSharedWorkspaceFromHook, setCampaigns, setSelectedCampaignId, shareLink, shareToken],
  )

  const loadCampaigns = useCallback(
    async (
      sessionToken: string,
      preferredCampaignId?: string | null,
      preferredNoteId?: string | null,
    ) => {
      const campaignsResponse = await fetchCampaigns(sessionToken)
      setCampaigns(campaignsResponse.campaigns)

      const storedCampaignId = localStorage.getItem(selectedCampaignStorageKey)
      const candidateCampaignId =
        preferredCampaignId ?? storedCampaignId ?? campaignsResponse.campaigns[0]?.id ?? null

      const nextCampaign =
        candidateCampaignId !== null
          ? campaignsResponse.campaigns.find(
              (campaign) => campaign.id === candidateCampaignId,
            ) ?? campaignsResponse.campaigns[0] ?? null
          : null

      if (!nextCampaign) {
        setSelectedCampaignId(null)
        setOverview(null)
        setNotes([])
        setSessionSummaries([])
        resetSessionBrowserState()
        resetActivityState()
        setQuickCaptureTitle('')
        setSelectedNoteId(null)
        setMemberships([])
        setShareLinks([])
        setCampaignDraft(createCampaignDraft())
        setCampaignFormMode(campaignsResponse.campaigns.length === 0 ? 'create' : 'closed')
        setError(null)
        return
      }

      await loadWorkspace(sessionToken, nextCampaign.id, preferredNoteId)
    },
    [loadWorkspace, resetActivityState, resetSessionBrowserState],
  )

  useEffect(() => {
    let cancelled = false

    const bootstrapAuth = async () => {
      try {
        const nextAuthConfig = await fetchAuthConfig()

        if (cancelled) {
          return
        }

        setAuthConfig(nextAuthConfig)

        if (isKeycloakAuthConfig(nextAuthConfig)) {
          const keycloakClient = createRuntimeKeycloakClient(nextAuthConfig.keycloak)
          keycloakClientRef.current = keycloakClient
          const tokens = await keycloakClient.init(readStoredKeycloakTokens())

          if (cancelled) {
            return
          }

          if (!tokens) {
            clearStoredKeycloakTokens()
            localStorage.removeItem(authTokenStorageKey)
            setAuthToken(null)
            setOwner(null)
            return
          }

          persistKeycloakTokens(tokens)
          const session = await fetchOwnerSession(tokens.accessToken)

          if (cancelled) {
            return
          }

          setAuthToken(tokens.accessToken)
          setOwner(session.owner)

          if (!isSharedMode) {
            await loadCampaigns(tokens.accessToken)
          }

          return
        }

        const storedToken = localStorage.getItem(authTokenStorageKey)

        if (!storedToken) {
          setAuthToken(null)
          setOwner(null)
          return
        }

        const session = await fetchOwnerSession(storedToken)

        if (cancelled) {
          return
        }

        setAuthToken(storedToken)
        setOwner(session.owner)

        if (!isSharedMode) {
          await loadCampaigns(storedToken)
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          clearSession()
          console.error(bootstrapError)
          setError('Could not initialize your session. Reload and try again.')
        }
      } finally {
        if (!cancelled) {
          setIsAuthReady(true)
        }
      }
    }

    void bootstrapAuth()

    return () => {
      cancelled = true
    }
  }, [clearSession, isSharedMode, loadCampaigns])

  useEffect(() => {
    if (!isKeycloakAuthConfig(authConfig) || !authToken || !keycloakClientRef.current) {
      return
    }

    let cancelled = false
    const refreshInterval = window.setInterval(() => {
      void keycloakClientRef.current
        ?.refresh(30)
        .then((tokens) => {
          if (cancelled) {
            return
          }

          persistKeycloakTokens(tokens)
          setAuthToken(tokens.accessToken)
        })
        .catch((refreshError) => {
          if (cancelled) {
            return
          }

          clearSession()
          console.error(refreshError)
          setError('Your session expired. Sign in again.')
        })
    }, 15_000)

    return () => {
      cancelled = true
      window.clearInterval(refreshInterval)
    }
  }, [authConfig, authToken, clearSession])

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
          setRegisterDraft((currentDraft) =>
            currentDraft.displayName.trim().length > 0
              ? currentDraft
              : {
                  ...currentDraft,
                  displayName: session.membership?.displayName ?? '',
                },
          )
          await loadSharedWorkspace(storedGuestToken, undefined, session.shareLink.accessLevel)
        } else {
          localStorage.removeItem(guestStorageKey)
          setGuestToken(null)
          setOverview(null)
          setNotes([])
          setSelectedNoteId(null)
          setIsCreating(false)
          setDraft(createEmptyDraftFn())
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
  }, [guestStorageKey, isSharedMode, loadSharedWorkspace, shareToken])

  useEffect(() => {
    if (isSharedMode) {
      return
    }

    if (
      !authToken ||
      campaignFormMode !== 'edit' ||
      !selectedCampaignId ||
      !canManageSelectedCampaign
    ) {
      setMemberships([])
      setShareLinks([])
      resetShareLinkInteractionState()
      resetMembershipConsolidationState()
      return
    }

    let cancelled = false

    const loadMemberships = async () => {
      try {
        const [membershipsResponse, shareLinksResponse] = await Promise.all([
          fetchCampaignMemberships(authToken, selectedCampaignId),
          fetchCampaignShareLinks(authToken, selectedCampaignId),
        ])

        if (!cancelled) {
          setMemberships(membershipsResponse.memberships)
          setShareLinks(shareLinksResponse.shareLinks)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load campaign memberships.',
          )
        }
      }
    }

    void loadMemberships()

    return () => {
      cancelled = true
    }
  }, [
    authToken,
    canManageSelectedCampaign,
    campaignFormMode,
    isSharedMode,
    resetMembershipConsolidationState,
    resetShareLinkInteractionState,
    selectedCampaignId,
  ])

  const handleSelectNote = (note: Note) => {
    handleSelectNoteFromHook(
      note,
      !showSplitNoteWorkspace ? () => setNarrowWorkspacePanel('editor') : undefined,
      () => setError(null),
    )
  }

  const handleMembershipConsolidationDraftChange = <
    Field extends keyof MembershipConsolidationDraft,
  >(
    field: Field,
    value: MembershipConsolidationDraft[Field],
  ) => {
    handleMembershipConsolidationDraftChangeFromHook(field, value)
    setError(null)
  }

  const handleOpenAllNotes = () => {
    setNoteBrowseMode('notes')
    setNarrowWorkspacePanel('browse')
    resetSessionBrowserState()
    setError(null)
  }

  const handleSelectTagFilter = (tag: string) => {
    setNoteBrowseMode('notes')
    setNarrowWorkspacePanel('browse')
    resetSessionBrowserState()
    const nextTag = selectedTagFilter === tag ? null : tag
    setSelectedTagFilter(nextTag)
    setError(null)
  }

  const handleClearTagFilter = () => {
    setSelectedTagFilter(null)
    setError(null)
  }

  const handleClearSearch = () => {
    setSearchText('')
    setError(null)
  }

  const handleOpenSessionBrowser = () => {
    setNoteBrowseMode('sessions')
    setNarrowWorkspacePanel('browse')
    resetSessionBrowserState()
    setError(null)
  }

  const handleOpenRecentActivity = async () => {
    if (isSharedMode) {
      setNoteBrowseMode('activity')
      setNarrowWorkspacePanel('browse')
      resetSessionBrowserState()
      setError(null)
      return
    }

    if (!authToken || !selectedCampaignId) {
      return
    }

    setNoteBrowseMode('activity')
    setNarrowWorkspacePanel('browse')
    resetSessionBrowserState()
    setError(null)
    await loadActivity(
      authToken,
      selectedCampaignId,
      selectedActivityMembershipIdRef.current,
    )
  }

  const handleSelectActivityCollaborator = async (membershipId: string | null) => {
    if (isSharedMode) {
      setSelectedActivityMembershipId(membershipId)
      setError(null)
      return
    }

    if (!authToken || !selectedCampaignId) {
      return
    }

    setSelectedActivityMembershipId(membershipId)
    setError(null)
    await loadActivity(authToken, selectedCampaignId, membershipId)
  }

  const handleSelectSession = async (sessionName: string) => {
    if (isSharedMode) {
      setNoteBrowseMode('sessions')
      setSelectedSessionName(sessionName)
      setNarrowWorkspacePanel('browse')
      setError(null)
      return
    }

    if (!authToken || !selectedCampaignId) {
      return
    }

    sessionRequestIdRef.current += 1
    const requestId = sessionRequestIdRef.current

    sessionAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    sessionAbortControllerRef.current = abortController

    setError(null)
    setNoteBrowseMode('sessions')
    setSelectedSessionName(sessionName)
    setSessionNotes([])
    setIsLoadingSessionNotes(true)

    try {
      const sessionNotesResponse = await fetchSessionNotes(
        authToken,
        sessionName,
        selectedCampaignId,
        abortController.signal,
      )

      if (
        abortController.signal.aborted ||
        sessionRequestIdRef.current !== requestId
      ) {
        return
      }

      setSessionNotes(sessionNotesResponse.notes)

      const currentSelectedId = selectedNoteIdRef.current
      const currentSessionNote =
        currentSelectedId !== null
          ? sessionNotesResponse.notes.find((note) => note.id === currentSelectedId) ?? null
          : null
      const nextSelectedNote = currentSessionNote ?? sessionNotesResponse.notes[0] ?? null

      if (nextSelectedNote) {
        setSelectedNoteId(nextSelectedNote.id)
        setIsCreating(false)
        setSelectedNoteTemplateId(blankNoteTemplateId)
        setDraft(createDraftFromNote(nextSelectedNote))
      }
    } catch (loadError) {
      if (
        abortController.signal.aborted ||
        sessionRequestIdRef.current !== requestId
      ) {
        return
      }

      resetSessionBrowserState()
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load notes for that session.',
      )
    } finally {
      if (sessionRequestIdRef.current === requestId) {
        setIsLoadingSessionNotes(false)
      }
    }
  }

  const handleStartNote = () => {
    if (!canEditWorkspace) {
      return
    }

    setWantsSplitNoteWorkspace(false)
    setNoteBrowseMode('notes')
    setSelectedTagFilter(null)
    setSearchText('')
    resetSessionBrowserState()
    handleStartNoteFromHook(
      canEditWorkspace,
      () => setNarrowWorkspacePanel('editor'),
      () => setError(null),
    )
  }

  const handleQuickCapture = async () => {
    setError(null)
    await handleQuickCaptureFromHook(
      isSharedMode,
      shareToken,
      guestToken,
      selectedCampaignId,
      authToken,
      canEditWorkspace,
      isSharedMode ? () => setNarrowWorkspacePanel('editor') : undefined,
      (message) => setError(message),
    )
  }

  const handleJoinSharedCampaign = async () => {
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
      setRegisterDraft((currentDraft) =>
        currentDraft.displayName.trim().length > 0
          ? currentDraft
          : {
              ...currentDraft,
              displayName: response.membership.displayName,
            },
      )
      await loadSharedWorkspace(response.guestToken, undefined, response.shareLink.accessLevel)
    } catch (joinError) {
      setError(
        joinError instanceof Error ? joinError.message : 'Could not join the shared campaign.',
      )
    } finally {
      setIsJoining(false)
    }
  }

  const handleLinkSharedMembership = async () => {
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
        return
      }

      const session = isRegisterMode
        ? await registerOwner(registerDraft)
        : await loginOwner(loginDraft)

      localStorage.setItem(authTokenStorageKey, session.token)

      const claimedMembership = await claimSharedMembership(shareToken, session.token, guestToken)

      if (claimedMembership.guestToken) {
        localStorage.setItem(guestStorageKey, claimedMembership.guestToken)
        setGuestToken(claimedMembership.guestToken)
      }

      localStorage.setItem(selectedCampaignStorageKey, claimedMembership.membership.campaignId)
      setSharedMembership(claimedMembership.membership)
      setAccountNotice(
        isRegisterMode
          ? `Account created and linked to ${session.owner.displayName}.`
          : `Linked to ${session.owner.displayName}.`,
      )
    } catch (linkError) {
      setError(
        linkError instanceof Error
          ? linkError.message
          : 'Could not link this guest membership to a real account.',
      )
    } finally {
      setIsLinkingAccount(false)
    }
  }

  const handleSelectNoteTemplate = (templateId: string) => {
    handleSelectNoteTemplateFromHook(templateId, () => setError(null))
  }

  const handleSaveNote = async () => {
    setError(null)
    await handleSaveNoteFromHook(
      isSharedMode,
      shareToken,
      guestToken,
      selectedCampaignId,
      authToken,
      canEditWorkspace,
      undefined,
      (message) => setError(message),
    )
  }

  const handleDeleteNote = async () => {
    setError(null)
    await handleDeleteNoteFromHook(
      isSharedMode,
      shareToken,
      guestToken,
      selectedCampaignId,
      authToken,
      canEditWorkspace,
      isSharedMode ? () => setNarrowWorkspacePanel('browse') : undefined,
      (message) => setError(message),
    )
  }

  const handleSubmitAuth = async () => {
    setError(null)
    await handleSubmitAuthFromHook(loadCampaigns, setError)
  }

  const handleLoginDraftChange = <Field extends keyof typeof loginDraft>(
    field: Field,
    value: (typeof loginDraft)[Field],
  ) => {
    setLoginDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  const handleRegisterDraftChange = <Field extends keyof typeof registerDraft>(
    field: Field,
    value: (typeof registerDraft)[Field],
  ) => {
    setRegisterDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  const handleToggleRegisterMode = () => {
    setError(null)
    setIsRegisterMode((current) => !current)
  }

  const handleLogout = async () => {
    setWantsSplitNoteWorkspace(false)
    setIsQuickCaptureOpen(false)
    setError(null)
    await handleLogoutFromHook(isSharedMode, guestStorageKey, () => {
      clearSession()
    })
  }

  const handleOpenCampaignCreate = () => {
    setShareLinks([])
    setShareLinkDraft(createShareLinkDraftFn())
    handleOpenCampaignCreateFromHook(selectedCampaign, resetShareLinkInteractionState, setError)
  }

  const handleOpenCampaignSettings = () => {
    setShareLinkDraft(createShareLinkDraftFn())
    handleOpenCampaignSettingsFromHook(
      selectedCampaign,
      canManageSelectedCampaign,
      resetShareLinkInteractionState,
      setError,
    )
  }

  const handleCancelCampaignForm = () => {
    setShareLinkDraft(createShareLinkDraftFn())
    handleCancelCampaignFormFromHook(selectedCampaign, resetShareLinkInteractionState, setError)
  }

  const handleSaveCampaign = async () => {
    if (!authToken) {
      return
    }

    await handleSaveCampaignFromHook(authToken, loadCampaigns, setError)
  }

  const handleCreateShareLink = async () => {
    if (!authToken || !selectedCampaignId) {
      return
    }

    setError(null)
    await handleCreateShareLinkFromHook(authToken, selectedCampaignId, setError)
  }

  const handlePreviewMembershipConsolidation = async () => {
    if (!authToken || !selectedCampaignId) {
      return
    }

    await handlePreviewMembershipConsolidationFromHook(authToken, selectedCampaignId, setError)
  }

  const handleApplyMembershipConsolidation = async () => {
    if (!authToken || !selectedCampaignId) {
      return
    }

    await handleApplyMembershipConsolidationFromHook(
      authToken,
      selectedCampaignId,
      loadWorkspace,
      selectedNoteIdRef.current,
      setError,
    )
  }

  const handleRevealShareLink = async (shareLinkId: string) => {
    if (!authToken || !selectedCampaignId) {
      return
    }

    setError(null)
    await handleRevealShareLinkFromHook(shareLinkId, authToken, selectedCampaignId)
  }

  const handleCopyShareLink = async (shareLinkId: string) => {
    setError(null)
    await handleCopyShareLinkFromHook(shareLinkId, setError)
  }

  const handleRevokeShareLink = async (shareLinkId: string) => {
    if (!authToken || !selectedCampaignId) {
      return
    }

    setError(null)
    await handleRevokeShareLinkFromHook(shareLinkId, authToken, selectedCampaignId, setError)
  }

  const handleSelectCampaign = async (campaignId: string) => {
    if (!authToken) {
      return
    }

    setCampaignFormMode('closed')
    setWantsSplitNoteWorkspace(false)
    setNoteBrowseMode('notes')
    setNarrowWorkspacePanel('browse')
    resetSessionBrowserState()
    resetActivityState()
    setQuickCaptureTitle('')
    setMemberships([])
    setShareLinks([])
    resetShareLinkInteractionState()
    await loadWorkspace(authToken, campaignId)
  }

  const handleShowBrowsePane = () => {
    setWantsSplitNoteWorkspace(false)
    setNarrowWorkspacePanel('browse')
  }

  const handleShowEditorPane = () => {
    setWantsSplitNoteWorkspace(false)
    setNarrowWorkspacePanel('editor')
  }

  const handleToggleSplitWorkspace = () => {
    if (!canSplitNoteWorkspace) {
      return
    }

    setWantsSplitNoteWorkspace((currentValue) => {
      if (currentValue) {
        setNarrowWorkspacePanel(selectedNoteIdRef.current || isCreating ? 'editor' : 'browse')
      }

      return !currentValue
    })
  }

  const isKeycloakMode = isKeycloakAuthConfig(authConfig)

  if (isBootstrapping) {
    return (
      <WorkspaceLoadingView
        loading={isBootstrapping}
        onRetry={() => window.location.reload()}
      />
    )
  }

  if (isSharedMode && (!sharedCampaign || !shareLink)) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Container maxWidth="sm">
          <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
            {error ?? 'This shared campaign could not be loaded.'}
          </Alert>
        </Container>
      </Box>
    )
  }

  if (isSharedMode && !sharedMembership) {
    return (
      <Box component="main" sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Container maxWidth="sm">
          <Stack spacing={3}>
            <Card sx={{ borderRadius: heroCardRadius }}>
              <CardContent sx={{ p: { xs: 3, md: 4 } }}>
                <Stack spacing={3}>
                  <Box>
                    <Typography
                      variant="overline"
                      sx={{ color: 'text.secondary', letterSpacing: '0.18em' }}
                    >
                      Shared campaign access
                    </Typography>
                    <Typography variant="h3" sx={{ mt: 1 }}>
                      Join {sharedCampaign?.name}
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 2 }}>
                      Pick the name you want this campaign to use for you. You can return with
                      the same shared link and keep this guest identity.
                    </Typography>
                  </Box>

                  {error ? (
                    <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
                      {error}
                    </Alert>
                  ) : null}

                  <TextField
                    label="Display name"
                    value={joinDraft.displayName}
                    onChange={(event) => setJoinDraft({ displayName: event.target.value })}
                  />

                  <Button variant="contained" onClick={handleJoinSharedCampaign} disabled={isJoining} sx={{ alignSelf: 'flex-start' }}>
                    {isJoining ? 'Joining campaign…' : 'Join campaign'}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </Box>
    )
  }

  if (!isSharedMode && (!owner || !authToken)) {
    return (
      <LoginPage
        isKeycloakMode={isKeycloakMode}
        isRegisterMode={isRegisterMode}
        registerDraft={registerDraft}
        loginDraft={loginDraft}
        isSubmittingAuth={isSubmittingAuth}
        error={error}
        surfaceRadius={surfaceRadius}
        heroCardRadius={heroCardRadius}
        onRegisterDraftChange={handleRegisterDraftChange}
        onLoginDraftChange={handleLoginDraftChange}
        onToggleRegisterMode={handleToggleRegisterMode}
        onSubmit={handleSubmitAuth}
      />
    )
  }

  if (!isSharedMode && (campaigns.length === 0 || (!selectedCampaignId && campaignFormMode === 'create'))) {
    return (
      <CampaignListPage
        owner={owner}
        authToken={authToken}
        surfaceRadius={surfaceRadius}
        heroCardRadius={heroCardRadius}
        error={error}
        selectedCampaignTemplateId={selectedCampaignTemplateId}
        onSelectedCampaignTemplateIdChange={setSelectedCampaignTemplateId}
        campaignDraft={campaignDraft}
        onCampaignDraftChange={handleCampaignDraftChange}
        isSavingCampaign={isSavingCampaign}
        onSaveCampaign={() => void handleSaveCampaign()}
        onLogout={() => void handleLogout()}
      />
    )
  }

  if (isLoadingWorkspace || !overview || (!isSharedMode && !selectedCampaign)) {
    const handleWorkspaceRetry = () => {
      if (isSharedMode && guestToken) {
        void loadSharedWorkspace(guestToken)
      } else if (!isSharedMode && authToken && selectedCampaignId) {
        void loadWorkspace(authToken, selectedCampaignId)
      } else {
        window.location.reload()
      }
    }
    // Pass the full guard condition so the timeout stays active when loading
    // finishes but overview is still null (e.g. after a failed network request).
    return (
      <WorkspaceLoadingView
        loading={isLoadingWorkspace || !overview || (!isSharedMode && !selectedCampaign)}
        onRetry={handleWorkspaceRetry}
      />
    )
  }

  return (
    <CampaignDetailPage
      owner={owner}
      authToken={authToken}
      isSharedMode={isSharedMode}
      isKeycloakMode={isKeycloakMode}
      canEditWorkspace={canEditWorkspace}
      canManageSelectedCampaign={canManageSelectedCampaign}
      resolvedCampaign={resolvedCampaign}
      resolvedSelectedCampaignId={resolvedSelectedCampaignId}
      resolvedCampaignOptions={resolvedCampaignOptions}
      resolvedDesktopSubtitle={resolvedDesktopSubtitle}
      campaignFormMode={campaignFormMode}
      campaignDraft={campaignDraft}
      selectedCampaignTemplateId={selectedCampaignTemplateId}
      isSavingCampaign={isSavingCampaign}
      useCompactDesktopHeader={useCompactDesktopHeader}
      currentCampaignMemberships={currentCampaignMemberships}
      membershipConsolidationDraft={membershipConsolidationDraft}
      membershipConsolidationPreview={membershipConsolidationPreview}
      membershipConsolidationNotice={membershipConsolidationNotice}
      selectedSourceMembership={selectedSourceMembership}
      selectedTargetMembership={selectedTargetMembership}
      hasValidMembershipConsolidationSelection={hasValidMembershipConsolidationSelection}
      canApplyMembershipConsolidation={canApplyMembershipConsolidation}
      isPreviewingMembershipConsolidation={isPreviewingMembershipConsolidation}
      isApplyingMembershipConsolidation={isApplyingMembershipConsolidation}
      shareLinks={shareLinks}
      shareLinkDraft={shareLinkDraft}
      shareLinkNotice={shareLinkNotice}
      revealedShareLinks={revealedShareLinks}
      shareLinkActionErrors={shareLinkActionErrors}
      revealingShareLinkId={revealingShareLinkId}
      copiedShareLinkId={copiedShareLinkId}
      isCreatingShareLink={isCreatingShareLink}
      resolvedMembership={resolvedMembership}
      accountNotice={accountNotice}
      isLinkingAccount={isLinkingAccount}
      isRegisterMode={isRegisterMode}
      registerDraft={registerDraft}
      loginDraft={loginDraft}
      overview={overview}
      error={error}
      noteBrowseMode={noteBrowseMode}
      selectedSessionName={selectedSessionName}
      selectedTagFilter={selectedTagFilter}
      searchText={searchText}
      draft={draft}
      tagInputValue={tagInputValue}
      selectedNoteId={selectedNoteId}
      isCreating={isCreating}
      isLoadingSessionNotes={isLoadingSessionNotes}
      isLoadingActivity={isLoadingActivity}
      isQuickCapturing={isQuickCapturing}
      isSaving={isSaving}
      isDeleting={isDeleting}
      selectedNoteTemplateId={selectedNoteTemplateId}
      selectedNoteTemplate={selectedNoteTemplate}
      quickCaptureTitle={quickCaptureTitle}
      isQuickCaptureOpen={isQuickCaptureOpen}
      selectedNote={selectedNote}
      filteredNotes={filteredNotes}
      displayedNotes={displayedNotes}
      tagFacets={tagFacets}
      draftTags={draftTags}
      noteLinkOptions={noteLinkOptions}
      linkedNotes={linkedNotes}
      backlinks={backlinks}
      resolvedSessionSummaries={resolvedSessionSummaries}
      resolvedSelectedSessionSummary={resolvedSelectedSessionSummary}
      selectedActivityMembershipId={selectedActivityMembershipId}
      resolvedActivityCollaborators={resolvedActivityCollaborators}
      resolvedSelectedActivityCollaborator={resolvedSelectedActivityCollaborator}
      sortedActivityEntries={sortedActivityEntries}
      selectedTagFacet={selectedTagFacet}
      showSplitNoteWorkspace={showSplitNoteWorkspace}
      canSplitNoteWorkspace={canSplitNoteWorkspace}
      showBrowsePane={showBrowsePane}
      showEditorPane={showEditorPane}
      workspaceEditorLabel={workspaceEditorLabel}
      onSelectCampaign={(campaignId) => void handleSelectCampaign(campaignId)}
      onNewCampaign={handleOpenCampaignCreate}
      onOpenSettings={handleOpenCampaignSettings}
      onNewNote={handleStartNote}
      onLogout={() => void handleLogout()}
      onCampaignDraftChange={handleCampaignDraftChange}
      onSelectedCampaignTemplateIdChange={setSelectedCampaignTemplateId}
      onSaveCampaign={() => void handleSaveCampaign()}
      onCancelCampaignForm={handleCancelCampaignForm}
      onMembershipConsolidationDraftChange={handleMembershipConsolidationDraftChange}
      onPreviewMembershipConsolidation={() => void handlePreviewMembershipConsolidation()}
      onApplyMembershipConsolidation={() => void handleApplyMembershipConsolidation()}
      onShareLinkDraftChange={handleShareLinkDraftChange}
      onCreateShareLink={() => void handleCreateShareLink()}
      onRevealShareLink={(shareLinkId) => void handleRevealShareLink(shareLinkId)}
      onToggleShareLinkVisibility={handleToggleShareLinkVisibility}
      onCopyShareLink={(shareLinkId) => void handleCopyShareLink(shareLinkId)}
      onRevokeShareLink={(shareLinkId) => void handleRevokeShareLink(shareLinkId)}
      onRegisterDraftChange={(field, value) =>
        setRegisterDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
      }
      onLoginDraftChange={(field, value) =>
        setLoginDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
      }
      onToggleRegisterMode={() => {
        setAccountNotice(null)
        setError(null)
        setIsRegisterMode((current) => !current)
      }}
      onLinkSharedMembership={() => void handleLinkSharedMembership()}
      onOpenAllNotes={handleOpenAllNotes}
      onOpenSessionBrowser={handleOpenSessionBrowser}
      onOpenRecentActivity={() => void handleOpenRecentActivity()}
      onSelectTagFilter={handleSelectTagFilter}
      onClearTagFilter={handleClearTagFilter}
      onClearSearch={handleClearSearch}
      onSearchTextChange={setSearchText}
      onSelectSession={(sessionName) => void handleSelectSession(sessionName)}
      onSelectActivityCollaborator={(membershipId) => void handleSelectActivityCollaborator(membershipId)}
      onSelectNote={handleSelectNote}
      onShowBrowsePane={handleShowBrowsePane}
      onShowEditorPane={handleShowEditorPane}
      onToggleSplitWorkspace={handleToggleSplitWorkspace}
      onToggleQuickCapture={() => setIsQuickCaptureOpen((currentValue) => !currentValue)}
      onQuickCaptureValueChange={setQuickCaptureTitle}
      onQuickCaptureSubmit={() => void handleQuickCapture()}
      onShowBrowsePanel={() => setNarrowWorkspacePanel('browse')}
      onSelectNoteTemplate={handleSelectNoteTemplate}
      onDraftChange={handleDraftChange}
      onTagInputChange={setTagInputValue}
      onDraftTagsChange={handleDraftTagsChange}
      onCommitPendingTagInput={commitPendingTagInput}
      onSaveNote={() => void handleSaveNote()}
      onDeleteNote={() => void handleDeleteNote()}
    />
  )
}

export default App
