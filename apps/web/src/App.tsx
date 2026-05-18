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
  useRef,
  useState,
} from 'react'
import {
  fetchCampaignShareLinks,
  fetchCampaignMemberships,
} from './api'
import { isKeycloakAuthConfig } from './keycloak-client'
import { getNoteStarterTemplate } from './templates'
import type { CampaignShareLink, CampaignSummary } from './types'
import CampaignDetailPage from './pages/CampaignDetailPage'
import CampaignListPage from './pages/CampaignListPage'
import JoinPage from './pages/JoinPage'
import LoginPage from './pages/LoginPage'
import { WorkspaceLoadingView } from './WorkspaceLoadingView'
import { useShareLinks, createShareLinkDraft as createShareLinkDraftFn } from './hooks/useShareLinks'
import { useSession } from './hooks/useSession'
import { useCampaign, createCampaignDraft, selectedCampaignStorageKey } from './hooks/useCampaign'
import { useNotes, createEmptyDraft as createEmptyDraftFn } from './hooks/useNotes'
import { useGuestSession } from './hooks/useGuestSession'

type NarrowWorkspacePanel = 'browse' | 'editor'

const guestTokenStoragePrefix = 'dnd-notes:guest-token:'
const heroCardRadius = '32px'
const surfaceRadius = '24px'

function getShareTokenFromPath(pathname: string) {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

function App() {
  const theme = useTheme()
  const canSplitNoteWorkspace = useMediaQuery(theme.breakpoints.up('lg'))
  const shareToken = useMemo(
    () => (typeof window === 'undefined' ? null : getShareTokenFromPath(window.location.pathname)),
    [],
  )
  const isSharedMode = shareToken !== null
  const guestStorageKey = shareToken ? `${guestTokenStoragePrefix}${shareToken}` : null

  const sl = useShareLinks()
  const sess = useSession()
  const camp = useCampaign()
  const notes = useNotes(isSharedMode)

  // Destructure stable hooks refs used in useCallback and useEffect dependencies
  const { resetSession, bootstrapAuth, startKeycloakRefresh } = sess
  const { resetCampaign, setSelectedCampaignId, setCampaigns, setCampaignDraft, setMemberships,
    resetMembershipConsolidationState, loadCampaigns: campLoadCampaigns } = camp
  const { resetNotes, setOverview, setNotes: setNotesArr, setSessionSummaries,
    resetSessionBrowserState, resetActivityState, setQuickCaptureTitle, setSelectedNoteId,
    setNoteBrowseMode, setSelectedSessionName, setSelectedActivityMembershipId,
    setIsCreating, setDraft,
    loadWorkspace: loadWorkspaceHook, loadSharedWorkspace: loadSharedWorkspaceHook,
    selectedTagFilter, tagFacets, setSelectedTagFilter } = notes
  const { setShareLinks, resetShareLinks, resetShareLinkInteractionState } = sl

  const [sharedCampaign, setSharedCampaign] = useState<CampaignSummary | null>(null)
  const [shareLink, setShareLink] = useState<CampaignShareLink | null>(null)
  // Keep a ref to the latest shareLink so the loadSharedWorkspace callback
  // does not depend on shareLink identity — otherwise setShareLink inside
  // useGuestSession.bootstrapSharedSession would re-create the callback,
  // re-fire the effect, re-fetch /session, and loop until 429 (#322).
  const shareLinkRef = useRef<CampaignShareLink | null>(shareLink)
  useEffect(() => { shareLinkRef.current = shareLink }, [shareLink])
  const [error, setError] = useState<string | null>(null)
  const [narrowWorkspacePanel, setNarrowWorkspacePanel] = useState<NarrowWorkspacePanel>('browse')
  const [wantsSplitNoteWorkspace, setWantsSplitNoteWorkspace] = useState(false)
  const showSplitNoteWorkspace = canSplitNoteWorkspace && wantsSplitNoteWorkspace

  const clearSession = useCallback(() => {
    resetSession(); resetCampaign(); resetNotes(); resetShareLinks()
    setSharedCampaign(null); setShareLink(null); setNarrowWorkspacePanel('browse'); setError(null)
  }, [resetSession, resetCampaign, resetNotes, resetShareLinks])

  const loadWorkspace = useCallback(
    async (sessionToken: string, campaignId: string, preferredNoteId?: string | null, suppressError = false): Promise<boolean | 'stale'> => {
      const ok = await loadWorkspaceHook(sessionToken, campaignId, preferredNoteId, suppressError,
        (id) => setSelectedCampaignId(id),
        (campaign) => setCampaignDraft(createCampaignDraft(campaign)),
        (message) => setError(message),
      )
      if (ok === true) { localStorage.setItem(selectedCampaignStorageKey, campaignId); setError(null) }
      return ok
    },
    [loadWorkspaceHook, setCampaignDraft, setSelectedCampaignId],
  )

  const loadSharedWorkspace = useCallback(
    async (activeGuestToken: string, preferredNoteId?: string | null, accessLevel?: CampaignShareLink['accessLevel']): Promise<boolean | 'stale'> => {
      const ok = await loadSharedWorkspaceHook(shareToken as string, activeGuestToken, preferredNoteId, accessLevel, shareLinkRef.current,
        (campaign) => { setSharedCampaign(campaign); setSelectedCampaignId(campaign.id); setCampaigns([campaign]) },
        (message) => setError(message),
      )
      if (ok === true) setError(null)
      return ok
    },
    [loadSharedWorkspaceHook, setCampaigns, setSelectedCampaignId, shareToken],
  )

  const loadCampaigns = useCallback(
    async (sessionToken: string, preferredCampaignId?: string | null, preferredNoteId?: string | null) => {
      await campLoadCampaigns(sessionToken, preferredCampaignId, preferredNoteId, loadWorkspace,
        () => {
          setOverview(null); setNotesArr([]); setSessionSummaries([])
          resetSessionBrowserState(); resetActivityState()
          setQuickCaptureTitle(''); setSelectedNoteId(null); setShareLinks([])
        },
        (message) => setError(message),
      )
    },
    [campLoadCampaigns, loadWorkspace, setOverview, setNotesArr, setSessionSummaries,
      resetSessionBrowserState, resetActivityState, setQuickCaptureTitle, setSelectedNoteId, setShareLinks],
  )

  const guest = useGuestSession({
    shareToken, guestStorageKey, isSharedMode, setSharedCampaign, setShareLink,
    authToken: sess.authToken, authConfig: sess.authConfig, owner: sess.owner,
    isRegisterMode: sess.isRegisterMode, registerDraft: sess.registerDraft, loginDraft: sess.loginDraft,
    keycloakClientRef: sess.keycloakClientRef,
    setRegisterDraft: sess.setRegisterDraft, setAccountNotice: sess.setAccountNotice,
    setIsLinkingAccount: sess.setIsLinkingAccount,
    setSelectedCampaignId, setCampaigns,
    setNoteBrowseMode, setSelectedSessionName, setSelectedActivityMembershipId,
    setOverview, setNotes: setNotesArr, setSelectedNoteId, setIsCreating, setDraft,
    loadSharedWorkspace, setError, createEmptyDraft: createEmptyDraftFn,
  })

  const isBootstrapping = !sess.isAuthReady || !guest.isSharedReady

  const selectedCampaign = useMemo(
    () => camp.campaigns.find((c) => c.id === camp.selectedCampaignId) ?? notes.overview?.campaign ?? null,
    [camp.campaigns, camp.selectedCampaignId, notes.overview],
  )
  const resolvedCampaign = isSharedMode ? sharedCampaign ?? notes.overview?.campaign ?? null : selectedCampaign
  const resolvedMembership = isSharedMode
    ? guest.sharedMembership ?? notes.overview?.membership ?? null
    : notes.overview?.membership ?? null
  const canEditWorkspace = isSharedMode ? shareLink?.accessLevel === 'editor' : true
  const canManageSelectedCampaign = (notes.overview?.membership ?? null)?.role === 'owner'
  const isKeycloakMode = isKeycloakAuthConfig(sess.authConfig)

  // Clear stale tag filter when active tag is removed
  useEffect(() => {
    if (selectedTagFilter && !tagFacets.some((f) => f.tag === selectedTagFilter)) {
      setSelectedTagFilter(null)
    }
  }, [selectedTagFilter, tagFacets, setSelectedTagFilter])

  // Bootstrap auth — runs once on mount
  useEffect(() => {
    let cancelled = false
    void bootstrapAuth(isSharedMode, () => cancelled, loadCampaigns, clearSession, (msg) => setError(msg))
    return () => { cancelled = true }
  }, [bootstrapAuth, clearSession, isSharedMode, loadCampaigns])

  // Keycloak token refresh
  useEffect(() => {
    return startKeycloakRefresh(clearSession, (msg) => setError(msg))
  }, [sess.authConfig, sess.authToken, clearSession, startKeycloakRefresh])

  // Memberships + share links — fetch when campaign settings are open
  useEffect(() => {
    if (isSharedMode || !sess.authToken || camp.campaignFormMode !== 'edit' || !camp.selectedCampaignId || !canManageSelectedCampaign) {
      setMemberships([]); setShareLinks([]); resetShareLinkInteractionState(); resetMembershipConsolidationState()
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [m, s] = await Promise.all([
          fetchCampaignMemberships(sess.authToken!, camp.selectedCampaignId!),
          fetchCampaignShareLinks(sess.authToken!, camp.selectedCampaignId!),
        ])
        if (!cancelled) { setMemberships(m.memberships); setShareLinks(s.shareLinks) }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load campaign memberships.')
      }
    })()
    return () => { cancelled = true }
  }, [sess.authToken, canManageSelectedCampaign, camp.campaignFormMode, isSharedMode,
    resetMembershipConsolidationState, resetShareLinkInteractionState, camp.selectedCampaignId,
    setMemberships, setShareLinks])

  if (isBootstrapping) {
    return <WorkspaceLoadingView loading={isBootstrapping} onRetry={() => window.location.reload()} />
  }

  if (isSharedMode && (!sharedCampaign || !shareLink)) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Container maxWidth="sm">
          <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>{error ?? 'This shared campaign could not be loaded.'}</Alert>
        </Container>
      </Box>
    )
  }

  if (isSharedMode && !guest.sharedMembership) {
    return <JoinPage campaignName={sharedCampaign?.name} joinDraft={guest.joinDraft} isJoining={guest.isJoining} error={error} onJoinDraftChange={guest.setJoinDraft} onJoin={() => void guest.handleJoinSharedCampaign()} />
  }

  if (!isSharedMode && (!sess.owner || !sess.authToken)) {
    return (
      <LoginPage
        isKeycloakMode={isKeycloakMode} isRegisterMode={sess.isRegisterMode}
        registerDraft={sess.registerDraft} loginDraft={sess.loginDraft}
        isSubmittingAuth={sess.isSubmittingAuth} error={error}
        surfaceRadius={surfaceRadius} heroCardRadius={heroCardRadius}
        onRegisterDraftChange={(f, v) => sess.setRegisterDraft((d) => ({ ...d, [f]: v }))}
        onLoginDraftChange={(f, v) => sess.setLoginDraft((d) => ({ ...d, [f]: v }))}
        onToggleRegisterMode={() => { setError(null); sess.setIsRegisterMode((x) => !x) }}
        onSubmit={async () => { setError(null); await sess.handleSubmitAuth(loadCampaigns, setError) }}
      />
    )
  }

  if (!isSharedMode && (camp.campaigns.length === 0 || (!camp.selectedCampaignId && camp.campaignFormMode === 'create'))) {
    return (
      <CampaignListPage
        owner={sess.owner} authToken={sess.authToken}
        surfaceRadius={surfaceRadius} heroCardRadius={heroCardRadius} error={error}
        selectedCampaignTemplateId={camp.selectedCampaignTemplateId}
        onSelectedCampaignTemplateIdChange={camp.setSelectedCampaignTemplateId}
        campaignDraft={camp.campaignDraft} onCampaignDraftChange={camp.handleCampaignDraftChange}
        isSavingCampaign={camp.isSavingCampaign}
        onSaveCampaign={async () => { if (sess.authToken) await camp.handleSaveCampaign(sess.authToken, loadCampaigns, setError) }}
        onLogout={async () => { await sess.handleLogout(isSharedMode, guestStorageKey, () => clearSession()) }}
      />
    )
  }

  if (notes.isLoadingWorkspace || !notes.overview || (!isSharedMode && !selectedCampaign)) {
    const retryWorkspace = () => {
      if (isSharedMode && guest.guestToken) void loadSharedWorkspace(guest.guestToken)
      else if (!isSharedMode && sess.authToken && camp.selectedCampaignId) void loadWorkspace(sess.authToken, camp.selectedCampaignId)
      else window.location.reload()
    }
    return <WorkspaceLoadingView loading={notes.isLoadingWorkspace || !notes.overview || (!isSharedMode && !selectedCampaign)} onRetry={retryWorkspace} />
  }

  return (
    <CampaignDetailPage
      sess={sess} camp={camp} sl={sl} notes={notes} guest={guest}
      isSharedMode={isSharedMode} isKeycloakMode={isKeycloakMode}
      canEditWorkspace={canEditWorkspace} canManageSelectedCampaign={canManageSelectedCampaign}
      canSplitNoteWorkspace={canSplitNoteWorkspace}
      showSplitNoteWorkspace={showSplitNoteWorkspace}
      narrowWorkspacePanel={narrowWorkspacePanel}
      resolvedCampaign={resolvedCampaign} resolvedMembership={resolvedMembership}
      selectedNoteTemplate={getNoteStarterTemplate(notes.selectedNoteTemplateId)}
      selectedCampaign={selectedCampaign}
      error={error}
      setError={setError}
      setNarrowWorkspacePanel={setNarrowWorkspacePanel}
      setWantsSplitNoteWorkspace={setWantsSplitNoteWorkspace}
      loadWorkspace={loadWorkspace}
      loadCampaigns={loadCampaigns}
      clearSession={clearSession}
      guestStorageKey={guestStorageKey}
      shareToken={shareToken}
      createShareLinkDraft={createShareLinkDraftFn}
    />
  )
}

export default App
