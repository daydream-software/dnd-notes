import {
  Alert,
  Box,
  Container,
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
  fetchCampaignShareLinks,
  fetchCampaignMemberships,
  fetchSessionNotes,
} from './api'
import { isKeycloakAuthConfig } from './keycloak-client'
import { getNoteStarterTemplate } from './templates'
import type {
  CampaignShareLink,
  CampaignSummary,
  Note,
} from './types'
import CampaignDetailPage from './pages/CampaignDetailPage'
import CampaignListPage from './pages/CampaignListPage'
import JoinPage from './pages/JoinPage'
import LoginPage from './pages/LoginPage'
import { WorkspaceLoadingView } from './WorkspaceLoadingView'
import { useShareLinks, createShareLinkDraft as createShareLinkDraftFn } from './hooks/useShareLinks'
import {
  useSession,
  authTokenStorageKey,
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
import { useGuestSession } from './hooks/useGuestSession'

type NarrowWorkspacePanel = 'browse' | 'editor'

const guestTokenStoragePrefix = 'dnd-notes:guest-token:'

function getShareTokenFromPath(pathname: string) {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

const heroCardRadius = '32px'
const surfaceRadius = '24px'

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
    setIsRegisterMode,
    setRegisterDraft,
    setLoginDraft,
    setIsLinkingAccount,
    setAccountNotice,
    bootstrapAuth,
    startKeycloakRefresh,
    handleSubmitAuth: handleSubmitAuthFromHook,
    handleLogout: handleLogoutFromHook,
  } = useSession()

  const {
    campaigns,
    selectedCampaignId,
    currentCampaignMemberships,
    selectedSourceMembership,
    selectedTargetMembership,
    hasValidMembershipConsolidationSelection,
    canApplyMembershipConsolidation,
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
    loadCampaigns: loadCampaignsFromHook,
  } = useCampaign()

  const {
    overview,
    noteBrowseMode,
    selectedSessionName,
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
    resolvedSessionSummaries,
    resolvedSelectedSessionSummary,
    resolvedActivityCollaborators,
    resolvedSelectedActivityCollaborator,
    sortedActivityEntries,
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

  // Guest campaign state — kept in App so loadSharedWorkspace can reference it without circular deps
  const [sharedCampaign, setSharedCampaign] = useState<CampaignSummary | null>(null)
  const [shareLink, setShareLink] = useState<CampaignShareLink | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [narrowWorkspacePanel, setNarrowWorkspacePanel] =
    useState<NarrowWorkspacePanel>('browse')
  const [wantsSplitNoteWorkspace, setWantsSplitNoteWorkspace] = useState(false)
  const showSplitNoteWorkspace = canSplitNoteWorkspace && wantsSplitNoteWorkspace

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
      await loadCampaignsFromHook(
        sessionToken,
        preferredCampaignId,
        preferredNoteId,
        loadWorkspace,
        () => {
          setOverview(null)
          setNotes([])
          setSessionSummaries([])
          resetSessionBrowserState()
          resetActivityState()
          setQuickCaptureTitle('')
          setSelectedNoteId(null)
          setShareLinks([])
        },
        (message) => setError(message),
      )
    },
    [
      loadCampaignsFromHook,
      loadWorkspace,
      resetActivityState,
      resetSessionBrowserState,
      setNotes,
      setOverview,
      setQuickCaptureTitle,
      setSelectedNoteId,
      setSessionSummaries,
      setShareLinks,
    ],
  )

  const {
    sharedMembership,
    guestToken,
    isSharedReady,
    isJoining,
    joinDraft,
    setJoinDraft,
    handleJoinSharedCampaign,
    handleLinkSharedMembership,
  } = useGuestSession({
    shareToken,
    guestStorageKey,
    isSharedMode,
    setSharedCampaign,
    setShareLink,
    authToken,
    authConfig,
    owner,
    isRegisterMode,
    registerDraft,
    loginDraft,
    keycloakClientRef,
    setRegisterDraft,
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
    createEmptyDraft: createEmptyDraftFn,
  })

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

  const activeMembership = overview?.membership ?? null
  const canManageSelectedCampaign = activeMembership?.role === 'owner'
  const selectedNoteTemplate = getNoteStarterTemplate(selectedNoteTemplateId)
  const selectedTagFacet = useMemo(
    () =>
      selectedTagFilter
        ? tagFacets.find((tagFacet) => tagFacet.tag === selectedTagFilter) ?? null
        : null,
    [selectedTagFilter, tagFacets],
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

  // Clear stale tag filter when the active tag is removed from a campaign's notes
  useEffect(() => {
    if (selectedTagFilter && !tagFacets.some((tagFacet) => tagFacet.tag === selectedTagFilter)) {
      setSelectedTagFilter(null)
    }
  }, [selectedTagFilter, tagFacets, setSelectedTagFilter])

  // Bootstrap auth — runs once on mount
  useEffect(() => {
    let cancelled = false
    void bootstrapAuth(isSharedMode, () => cancelled, loadCampaigns, clearSession, (message) => setError(message))
    return () => {
      cancelled = true
    }
  }, [bootstrapAuth, clearSession, isSharedMode, loadCampaigns])

  // Keycloak token refresh — runs whenever auth token or config changes
  useEffect(() => {
    return startKeycloakRefresh(clearSession, (message) => setError(message))
  }, [authConfig, authToken, clearSession, startKeycloakRefresh])

  // Memberships + share links — fetch when campaign settings are open
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
    setMemberships,
    setShareLinks,
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
      <JoinPage
        campaignName={sharedCampaign?.name}
        joinDraft={joinDraft}
        isJoining={isJoining}
        error={error}
        onJoinDraftChange={setJoinDraft}
        onJoin={() => void handleJoinSharedCampaign()}
      />
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
