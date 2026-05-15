import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import {
  Alert,
  Box,
  Container,
  Stack,
} from '@mui/material'
import { Footer } from '@dnd-notes/theme'
import { useMemo } from 'react'
import CampaignWorkspaceHeader from '../CampaignWorkspaceHeader'
import { useScrolled } from '../hooks/useScrolled'
import type { UseShareLinksResult } from '../hooks/useShareLinks'
import type { UseCampaignResult } from '../hooks/useCampaign'
import type { UseNotesResult } from '../hooks/useNotes'
import type { UseSessionResult } from '../hooks/useSession'
import type { UseGuestSessionResult } from '../hooks/useGuestSession'
import type { CampaignMembership, CampaignSummary, Note } from '../types'
import type { NoteStarterTemplate } from '../templates'
import CampaignAdminPane from '../components/CampaignAdminPane'
import NotesWorkspacePane from '../components/NotesWorkspacePane'

const surfaceRadius = '24px'

export interface CampaignDetailPageProps {
  // Bundled hook results
  sess: UseSessionResult
  camp: UseCampaignResult
  sl: UseShareLinksResult
  notes: UseNotesResult
  guest: UseGuestSessionResult

  // App-level derived values
  isSharedMode: boolean
  isKeycloakMode: boolean
  canEditWorkspace: boolean
  canManageSelectedCampaign: boolean
  canSplitNoteWorkspace: boolean
  showSplitNoteWorkspace: boolean
  narrowWorkspacePanel: 'browse' | 'editor'
  resolvedCampaign: CampaignSummary | null
  resolvedMembership: CampaignMembership | null
  selectedNoteTemplate: NoteStarterTemplate
  selectedCampaign: CampaignSummary | null
  error: string | null

  // App callbacks
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setNarrowWorkspacePanel: React.Dispatch<React.SetStateAction<'browse' | 'editor'>>
  setWantsSplitNoteWorkspace: React.Dispatch<React.SetStateAction<boolean>>
  loadWorkspace: (token: string, campaignId: string, preferredNoteId?: string | null, suppressError?: boolean) => Promise<boolean | 'stale'>
  loadCampaigns: (token: string, preferredCampaignId?: string | null, preferredNoteId?: string | null) => Promise<void>
  clearSession: () => void
  guestStorageKey: string | null
  shareToken: string | null
  createShareLinkDraft: () => import('../hooks/useShareLinks').ShareLinkDraft
}

export default function CampaignDetailPage({
  sess, camp, sl, notes, guest,
  isSharedMode, isKeycloakMode, canEditWorkspace, canManageSelectedCampaign,
  canSplitNoteWorkspace, showSplitNoteWorkspace, narrowWorkspacePanel,
  resolvedCampaign, resolvedMembership,
  selectedNoteTemplate, selectedCampaign, error,
  setError, setNarrowWorkspacePanel, setWantsSplitNoteWorkspace,
  loadWorkspace, loadCampaigns, clearSession, guestStorageKey, shareToken, createShareLinkDraft,
}: CampaignDetailPageProps) {
  const scrolled = useScrolled(24)
  const showBrowsePane = showSplitNoteWorkspace || narrowWorkspacePanel === 'browse'
  const showEditorPane = showSplitNoteWorkspace || narrowWorkspacePanel === 'editor'
  const workspaceEditorLabel =
    !canEditWorkspace ? 'View note'
    : notes.isCreating || notes.selectedNote === null ? 'Create note'
    : 'Edit note'

  const resolvedCampaignOptions = useMemo(
    () => isSharedMode && resolvedCampaign
      ? [{ id: resolvedCampaign.id, name: resolvedCampaign.name }]
      : camp.campaigns.map((c) => ({ id: c.id, name: c.name })),
    [isSharedMode, resolvedCampaign, camp.campaigns],
  )

  const resolvedSelectedCampaignId = isSharedMode
    ? resolvedCampaign?.id ?? null
    : camp.selectedCampaignId ?? notes.overview?.campaign.id ?? null

  const resolvedDesktopSubtitle = resolvedCampaign
    ? `${resolvedCampaign.setting} • ${resolvedCampaign.system} • ${isSharedMode ? resolvedMembership?.displayName ?? 'Guest' : sess.owner?.displayName ?? ''}`
    : ''

  const selectedTagFacet = useMemo(
    () => (notes.selectedTagFilter ? notes.tagFacets.find((f) => f.tag === notes.selectedTagFilter) ?? null : null),
    [notes.selectedTagFilter, notes.tagFacets],
  )

  // --- Handlers ---

  const handleSelectNote = (note: Note) => {
    notes.handleSelectNote(note, !showSplitNoteWorkspace ? () => setNarrowWorkspacePanel('editor') : undefined, () => setError(null))
  }

  const handleStartNote = () => {
    if (!canEditWorkspace) return
    setWantsSplitNoteWorkspace(false)
    notes.setNoteBrowseMode('notes')
    notes.setSelectedTagFilter(null)
    notes.setSearchText('')
    notes.resetSessionBrowserState()
    notes.handleStartNote(canEditWorkspace, () => setNarrowWorkspacePanel('editor'), () => setError(null))
  }

  const handleQuickCapture = async () => {
    setError(null)
    await notes.handleQuickCapture(isSharedMode, shareToken, guest.guestToken, camp.selectedCampaignId, sess.authToken, canEditWorkspace, isSharedMode ? () => setNarrowWorkspacePanel('editor') : undefined, (msg) => setError(msg))
  }

  const handleSaveNote = async () => {
    setError(null)
    await notes.handleSaveNote(isSharedMode, shareToken, guest.guestToken, camp.selectedCampaignId, sess.authToken, canEditWorkspace, undefined, (msg) => setError(msg))
  }

  const handleDeleteNote = async () => {
    setError(null)
    await notes.handleDeleteNote(isSharedMode, shareToken, guest.guestToken, camp.selectedCampaignId, sess.authToken, canEditWorkspace, isSharedMode ? () => setNarrowWorkspacePanel('browse') : undefined, (msg) => setError(msg))
  }

  const handleLogout = async () => {
    setWantsSplitNoteWorkspace(false)
    notes.setIsQuickCaptureOpen(false)
    setError(null)
    await sess.handleLogout(isSharedMode, guestStorageKey, () => clearSession())
  }

  const handleOpenCampaignCreate = () => {
    sl.setShareLinks([])
    sl.setShareLinkDraft(createShareLinkDraft())
    camp.handleOpenCampaignCreate(selectedCampaign, sl.resetShareLinkInteractionState, setError)
  }

  const handleOpenCampaignSettings = () => {
    sl.setShareLinkDraft(createShareLinkDraft())
    camp.handleOpenCampaignSettings(selectedCampaign, canManageSelectedCampaign, sl.resetShareLinkInteractionState, setError)
  }

  const handleCancelCampaignForm = () => {
    sl.setShareLinkDraft(createShareLinkDraft())
    camp.handleCancelCampaignForm(selectedCampaign, sl.resetShareLinkInteractionState, setError)
  }

  const handleSaveCampaign = async () => {
    if (!sess.authToken) return
    await camp.handleSaveCampaign(sess.authToken, loadCampaigns, setError)
  }

  const handleCreateShareLink = async () => {
    if (!sess.authToken || !camp.selectedCampaignId) return
    setError(null)
    await sl.handleCreateShareLink(sess.authToken, camp.selectedCampaignId, setError)
  }

  const handlePreviewMembershipConsolidation = async () => {
    if (!sess.authToken || !camp.selectedCampaignId) return
    await camp.handlePreviewMembershipConsolidation(sess.authToken, camp.selectedCampaignId, setError)
  }

  const handleApplyMembershipConsolidation = async () => {
    if (!sess.authToken || !camp.selectedCampaignId) return
    await camp.handleApplyMembershipConsolidation(sess.authToken, camp.selectedCampaignId, loadWorkspace, notes.selectedNoteIdRef.current, setError)
  }

  const handleRevealShareLink = async (id: string) => {
    if (!sess.authToken || !camp.selectedCampaignId) return
    setError(null)
    await sl.handleRevealShareLink(id, sess.authToken, camp.selectedCampaignId)
  }

  const handleRevokeShareLink = async (id: string) => {
    if (!sess.authToken || !camp.selectedCampaignId) return
    setError(null)
    await sl.handleRevokeShareLink(id, sess.authToken, camp.selectedCampaignId, setError)
  }

  const handleSelectCampaign = async (campaignId: string) => {
    if (!sess.authToken) return
    camp.setCampaignFormMode('closed')
    setWantsSplitNoteWorkspace(false)
    notes.setNoteBrowseMode('notes')
    setNarrowWorkspacePanel('browse')
    notes.resetSessionBrowserState()
    notes.resetActivityState()
    notes.setQuickCaptureTitle('')
    camp.setMemberships([])
    sl.setShareLinks([])
    sl.resetShareLinkInteractionState()
    await loadWorkspace(sess.authToken, campaignId)
  }

  const handleToggleSplitWorkspace = () => {
    if (!canSplitNoteWorkspace) return
    setWantsSplitNoteWorkspace((current) => {
      if (current) setNarrowWorkspacePanel(notes.selectedNoteIdRef.current || notes.isCreating ? 'editor' : 'browse')
      return !current
    })
  }

  const resolvedCampaignName = resolvedCampaign?.name ?? notes.overview!.campaign.name
  const resolvedCampaignMobileSubtitle = `${resolvedCampaign?.setting ?? notes.overview!.campaign.setting} • ${resolvedCampaign?.system ?? notes.overview!.campaign.system}`

  return (
    <Box component="main" sx={{ minHeight: '100vh', py: { xs: 2.5, md: 4 }, width: '100%' }}>
      <Container maxWidth="xl" sx={{ minWidth: 0, position: 'relative' }}>
        <Stack spacing={2.5}>
          <Box
            sx={{
              width: '100%',
              position: { xs: 'static', lg: 'sticky' },
              top: { lg: 12 },
              zIndex: { lg: 3 },
            }}
          >
            <CampaignWorkspaceHeader
              campaignName={resolvedCampaignName}
              mobileSubtitle={resolvedCampaignMobileSubtitle}
              desktopSubtitle={resolvedDesktopSubtitle}
              selectedCampaignId={resolvedSelectedCampaignId ?? notes.overview!.campaign.id}
              campaignOptions={resolvedCampaignOptions}
              onSelectCampaign={(id) => { if (!isSharedMode) void handleSelectCampaign(id) }}
              actions={[
                { ariaLabel: 'New campaign', color: 'inherit', icon: <AddCircleOutlineRoundedIcon fontSize="small" />, onClick: isSharedMode ? () => window.location.assign('/') : handleOpenCampaignCreate },
                { ariaLabel: 'Campaign settings', color: 'inherit', icon: <SettingsRoundedIcon fontSize="small" />, onClick: isSharedMode ? () => window.location.assign('/') : handleOpenCampaignSettings, disabled: isSharedMode ? resolvedMembership?.userId === null : !canManageSelectedCampaign },
                { ariaLabel: 'New note', color: 'secondary', icon: <AddRoundedIcon fontSize="small" />, onClick: handleStartNote, disabled: !canEditWorkspace },
                { ariaLabel: 'Sign out', color: 'inherit', icon: <LogoutRoundedIcon fontSize="small" />, onClick: () => void handleLogout() },
              ]}
              surfaceRadius={surfaceRadius}
              compactDesktop={scrolled}
              stickyDesktop={false}
            />
          </Box>

          {error ? <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>{error}</Alert> : null}

          <CampaignAdminPane
            owner={sess.owner}
            authToken={sess.authToken}
            isSharedMode={isSharedMode}
            isKeycloakMode={isKeycloakMode}
            resolvedMembership={resolvedMembership}
            accountNotice={sess.accountNotice}
            isLinkingAccount={sess.isLinkingAccount}
            isRegisterMode={sess.isRegisterMode}
            registerDraft={sess.registerDraft}
            loginDraft={sess.loginDraft}
            campaignFormMode={camp.campaignFormMode}
            campaignDraft={camp.campaignDraft}
            selectedCampaignTemplateId={camp.selectedCampaignTemplateId}
            isSavingCampaign={camp.isSavingCampaign}
            currentCampaignMemberships={camp.currentCampaignMemberships}
            membershipConsolidationDraft={camp.membershipConsolidationDraft}
            membershipConsolidationPreview={camp.membershipConsolidationPreview}
            membershipConsolidationNotice={camp.membershipConsolidationNotice}
            selectedSourceMembership={camp.selectedSourceMembership}
            selectedTargetMembership={camp.selectedTargetMembership}
            hasValidMembershipConsolidationSelection={camp.hasValidMembershipConsolidationSelection}
            canApplyMembershipConsolidation={camp.canApplyMembershipConsolidation}
            isPreviewingMembershipConsolidation={camp.isPreviewingMembershipConsolidation}
            isApplyingMembershipConsolidation={camp.isApplyingMembershipConsolidation}
            shareLinks={sl.shareLinks}
            shareLinkDraft={sl.shareLinkDraft}
            shareLinkNotice={sl.shareLinkNotice}
            revealedShareLinks={sl.revealedShareLinks}
            shareLinkActionErrors={sl.shareLinkActionErrors}
            revealingShareLinkId={sl.revealingShareLinkId}
            copiedShareLinkId={sl.copiedShareLinkId}
            isCreatingShareLink={sl.isCreatingShareLink}
            onCampaignDraftChange={camp.handleCampaignDraftChange}
            onSelectedCampaignTemplateIdChange={camp.setSelectedCampaignTemplateId}
            onSaveCampaign={() => void handleSaveCampaign()}
            onCancelCampaignForm={handleCancelCampaignForm}
            onMembershipConsolidationDraftChange={(f, v) => { camp.handleMembershipConsolidationDraftChange(f, v); setError(null) }}
            onPreviewMembershipConsolidation={() => void handlePreviewMembershipConsolidation()}
            onApplyMembershipConsolidation={() => void handleApplyMembershipConsolidation()}
            onShareLinkDraftChange={sl.handleShareLinkDraftChange}
            onCreateShareLink={() => void handleCreateShareLink()}
            onRevealShareLink={(id) => void handleRevealShareLink(id)}
            onToggleShareLinkVisibility={sl.handleToggleShareLinkVisibility}
            onCopyShareLink={(id) => { setError(null); void sl.handleCopyShareLink(id, setError) }}
            onRevokeShareLink={(id) => void handleRevokeShareLink(id)}
            onRegisterDraftChange={(f, v) => sess.setRegisterDraft((d) => ({ ...d, [f]: v }))}
            onLoginDraftChange={(f, v) => sess.setLoginDraft((d) => ({ ...d, [f]: v }))}
            onToggleRegisterMode={() => { sess.setAccountNotice(null); setError(null); sess.setIsRegisterMode((x) => !x) }}
            onLinkSharedMembership={() => void guest.handleLinkSharedMembership()}
          />

          <NotesWorkspacePane
            isSharedMode={isSharedMode}
            canEditWorkspace={canEditWorkspace}
            showSplitNoteWorkspace={showSplitNoteWorkspace}
            canSplitNoteWorkspace={canSplitNoteWorkspace}
            showBrowsePane={showBrowsePane}
            showEditorPane={showEditorPane}
            workspaceEditorLabel={workspaceEditorLabel}
            resolvedCampaignName={resolvedCampaignName}
            overview={notes.overview!}
            noteBrowseMode={notes.noteBrowseMode}
            selectedSessionName={notes.selectedSessionName}
            selectedTagFilter={notes.selectedTagFilter}
            searchText={notes.searchText}
            draft={notes.draft}
            tagInputValue={notes.tagInputValue}
            selectedNoteId={notes.selectedNoteId}
            isCreating={notes.isCreating}
            isLoadingSessionNotes={notes.isLoadingSessionNotes}
            isLoadingActivity={notes.isLoadingActivity}
            isQuickCapturing={notes.isQuickCapturing}
            isSaving={notes.isSaving}
            isDeleting={notes.isDeleting}
            selectedNoteTemplateId={notes.selectedNoteTemplateId}
            selectedNoteTemplate={selectedNoteTemplate}
            quickCaptureTitle={notes.quickCaptureTitle}
            isQuickCaptureOpen={notes.isQuickCaptureOpen}
            selectedNote={notes.selectedNote}
            filteredNotes={notes.filteredNotes}
            displayedNotes={notes.displayedNotes}
            tagFacets={notes.tagFacets}
            draftTags={notes.draftTags}
            noteLinkOptions={notes.noteLinkOptions}
            linkedNotes={notes.linkedNotes}
            backlinks={notes.backlinks}
            resolvedSessionSummaries={notes.resolvedSessionSummaries}
            resolvedSelectedSessionSummary={notes.resolvedSelectedSessionSummary}
            selectedActivityMembershipId={notes.selectedActivityMembershipId}
            resolvedActivityCollaborators={notes.resolvedActivityCollaborators}
            resolvedSelectedActivityCollaborator={notes.resolvedSelectedActivityCollaborator}
            sortedActivityEntries={notes.sortedActivityEntries}
            selectedTagFacet={selectedTagFacet}
            onShowBrowsePane={() => { setWantsSplitNoteWorkspace(false); setNarrowWorkspacePanel('browse') }}
            onShowEditorPane={() => { setWantsSplitNoteWorkspace(false); setNarrowWorkspacePanel('editor') }}
            onToggleSplitWorkspace={handleToggleSplitWorkspace}
            onOpenAllNotes={() => { notes.setNoteBrowseMode('notes'); setNarrowWorkspacePanel('browse'); notes.resetSessionBrowserState(); setError(null) }}
            onOpenSessionBrowser={() => { notes.setNoteBrowseMode('sessions'); setNarrowWorkspacePanel('browse'); notes.resetSessionBrowserState(); setError(null) }}
            onOpenRecentActivity={() => { setNarrowWorkspacePanel('browse'); setError(null); void notes.handleOpenRecentActivity(sess.authToken, camp.selectedCampaignId) }}
            onSelectTagFilter={(tag) => { notes.setNoteBrowseMode('notes'); setNarrowWorkspacePanel('browse'); notes.resetSessionBrowserState(); notes.setSelectedTagFilter(notes.selectedTagFilter === tag ? null : tag); setError(null) }}
            onClearTagFilter={() => { notes.setSelectedTagFilter(null); setError(null) }}
            onClearSearch={() => { notes.setSearchText(''); setError(null) }}
            onSearchTextChange={notes.setSearchText}
            onSelectSession={(sessionName) => { setNarrowWorkspacePanel('browse'); setError(null); void notes.handleSelectSession(sessionName, sess.authToken, camp.selectedCampaignId, undefined, (msg) => setError(msg)) }}
            onSelectActivityCollaborator={(id) => { setError(null); void notes.handleSelectActivityCollaborator(id, sess.authToken, camp.selectedCampaignId, (msg) => setError(msg)) }}
            onSelectNote={handleSelectNote}
            onToggleQuickCapture={() => notes.setIsQuickCaptureOpen((v) => !v)}
            onQuickCaptureValueChange={notes.setQuickCaptureTitle}
            onQuickCaptureSubmit={() => void handleQuickCapture()}
            onShowBrowsePanel={() => setNarrowWorkspacePanel('browse')}
            onNewNote={handleStartNote}
            onSelectNoteTemplate={(id) => notes.handleSelectNoteTemplate(id, () => setError(null))}
            onDraftChange={notes.handleDraftChange}
            onTagInputChange={notes.setTagInputValue}
            onDraftTagsChange={notes.handleDraftTagsChange}
            onCommitPendingTagInput={notes.commitPendingTagInput}
            onSaveNote={() => void handleSaveNote()}
            onDeleteNote={() => void handleDeleteNote()}
          />

        </Stack>
      </Container>
      <Footer variant="signature" />
    </Box>
  )
}
