import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
import BoltRoundedIcon from '@mui/icons-material/BoltRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import PlaylistAddCheckCircleRoundedIcon from '@mui/icons-material/PlaylistAddCheckCircleRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import { formatTimestamp } from '../formatTimestamp'
import { markdownToPlainText } from '../note-excerpts'
import { DndNotesMark } from '../DndNotesMark'
import CampaignWorkspaceHeader from '../CampaignWorkspaceHeader'
import NotesBrowsePane from '../NotesBrowsePane'
import WorkspacePane from '../WorkspacePane'
import AdminPage from './AdminPage'
import NoteEditPage from './NoteEditPage'
import {
  describeCampaignMembership,
  campaignStarterTemplates,
  getCampaignStarterTemplate,
} from '../hooks/useCampaign'
import type { CampaignDraft, MembershipConsolidationDraft } from '../hooks/useCampaign'
import type { ShareLinkDraft, RevealedShareLink } from '../hooks/useShareLinks'
import type { NoteBrowseMode, NoteDraft, NoteLinkPanelItem, TagFacet } from '../hooks/useNotes'
import type {
  ActivityCollaborator,
  CampaignMembership,
  CampaignShareLink,
  MembershipConsolidationSummary,
  Note,
  NoteActivityEntry,
  NotesOverview,
  OwnerAccount,
  SessionSummary,
} from '../types'
import type { NoteStarterTemplate } from '../templates'

const surfaceRadius = '24px'
const noteItemRadius = '20px'
const statPillRadius = '999px'
const singleLineTextSx = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const defaultNotesPaneDescription =
  'The note workflow now runs inside the selected campaign.'

function formatSessionLine(sessionName: string | null) {
  return sessionName?.trim() ? sessionName : 'No session'
}

function excerpt(body: string) {
  const normalizedBody = markdownToPlainText(body)

  if (normalizedBody.length === 0) {
    return 'No details yet. Flesh this out when you have a minute.'
  }

  if (normalizedBody.length <= 112) {
    return normalizedBody
  }

  return `${normalizedBody.slice(0, 111)}…`
}

export interface CampaignDetailPageProps {
  // Auth + ownership
  owner: OwnerAccount | null
  authToken: string | null
  isSharedMode: boolean
  isKeycloakMode: boolean
  canEditWorkspace: boolean
  canManageSelectedCampaign: boolean

  // Campaign
  resolvedCampaign: { id: string; name: string; setting: string; system: string } | null
  resolvedSelectedCampaignId: string | null
  resolvedCampaignOptions: { id: string; name: string }[]
  resolvedDesktopSubtitle: string
  campaignFormMode: 'create' | 'edit' | 'closed'
  campaignDraft: CampaignDraft
  selectedCampaignTemplateId: string
  isSavingCampaign: boolean
  useCompactDesktopHeader: boolean

  // Membership management
  currentCampaignMemberships: CampaignMembership[]
  membershipConsolidationDraft: MembershipConsolidationDraft
  membershipConsolidationPreview: MembershipConsolidationSummary | null
  membershipConsolidationNotice: string | null
  selectedSourceMembership: CampaignMembership | null
  selectedTargetMembership: CampaignMembership | null
  hasValidMembershipConsolidationSelection: boolean
  canApplyMembershipConsolidation: boolean
  isPreviewingMembershipConsolidation: boolean
  isApplyingMembershipConsolidation: boolean

  // Share links
  shareLinks: CampaignShareLink[]
  shareLinkDraft: ShareLinkDraft
  shareLinkNotice: string | null
  revealedShareLinks: Record<string, RevealedShareLink>
  shareLinkActionErrors: Record<string, string>
  revealingShareLinkId: string | null
  copiedShareLinkId: string | null
  isCreatingShareLink: boolean

  // Shared membership claim card
  resolvedMembership: CampaignMembership | null
  accountNotice: string | null
  isLinkingAccount: boolean
  isRegisterMode: boolean
  registerDraft: { email: string; password: string; displayName: string }
  loginDraft: { email: string; password: string }

  // Workspace overview
  overview: NotesOverview

  // Error
  error: string | null

  // Note workspace state
  noteBrowseMode: NoteBrowseMode
  selectedSessionName: string | null
  selectedTagFilter: string | null
  searchText: string
  draft: NoteDraft
  tagInputValue: string
  selectedNoteId: string | null
  isCreating: boolean
  isLoadingSessionNotes: boolean
  isLoadingActivity: boolean
  isQuickCapturing: boolean
  isSaving: boolean
  isDeleting: boolean
  selectedNoteTemplateId: string
  selectedNoteTemplate: NoteStarterTemplate
  quickCaptureTitle: string
  isQuickCaptureOpen: boolean
  selectedNote: Note | null
  filteredNotes: Note[]
  displayedNotes: Note[]
  tagFacets: TagFacet[]
  draftTags: string[]
  noteLinkOptions: { id: string; title: string }[]
  linkedNotes: NoteLinkPanelItem[]
  backlinks: NoteLinkPanelItem[]
  resolvedSessionSummaries: SessionSummary[]
  resolvedSelectedSessionSummary: SessionSummary | null
  selectedActivityMembershipId: string | null
  resolvedActivityCollaborators: ActivityCollaborator[]
  resolvedSelectedActivityCollaborator: ActivityCollaborator | null
  sortedActivityEntries: NoteActivityEntry[]
  selectedTagFacet: TagFacet | null

  // Workspace layout
  showSplitNoteWorkspace: boolean
  canSplitNoteWorkspace: boolean
  showBrowsePane: boolean
  showEditorPane: boolean
  workspaceEditorLabel: string

  // Handlers — campaign header
  onSelectCampaign: (campaignId: string) => void
  onNewCampaign: () => void
  onOpenSettings: () => void
  onNewNote: () => void
  onLogout: () => void

  // Handlers — campaign form
  onCampaignDraftChange: <Field extends keyof CampaignDraft>(field: Field, value: CampaignDraft[Field]) => void
  onSelectedCampaignTemplateIdChange: (id: string) => void
  onSaveCampaign: () => void
  onCancelCampaignForm: () => void

  // Handlers — membership consolidation
  onMembershipConsolidationDraftChange: <Field extends keyof MembershipConsolidationDraft>(field: Field, value: MembershipConsolidationDraft[Field]) => void
  onPreviewMembershipConsolidation: () => void
  onApplyMembershipConsolidation: () => void

  // Handlers — share links
  onShareLinkDraftChange: <Field extends keyof ShareLinkDraft>(field: Field, value: ShareLinkDraft[Field]) => void
  onCreateShareLink: () => void
  onRevealShareLink: (shareLinkId: string) => void
  onToggleShareLinkVisibility: (shareLinkId: string) => void
  onCopyShareLink: (shareLinkId: string) => void
  onRevokeShareLink: (shareLinkId: string) => void

  // Handlers — shared membership claim
  onRegisterDraftChange: (field: 'email' | 'password' | 'displayName', value: string) => void
  onLoginDraftChange: (field: 'email' | 'password', value: string) => void
  onToggleRegisterMode: () => void
  onLinkSharedMembership: () => void

  // Handlers — notes browse
  onOpenAllNotes: () => void
  onOpenSessionBrowser: () => void
  onOpenRecentActivity: () => void
  onSelectTagFilter: (tag: string) => void
  onClearTagFilter: () => void
  onClearSearch: () => void
  onSearchTextChange: (text: string) => void
  onSelectSession: (sessionName: string) => void
  onSelectActivityCollaborator: (membershipId: string | null) => void
  onSelectNote: (note: Note) => void
  onShowBrowsePane: () => void
  onShowEditorPane: () => void
  onToggleSplitWorkspace: () => void
  onToggleQuickCapture: () => void
  onQuickCaptureValueChange: (value: string) => void
  onQuickCaptureSubmit: () => void
  onShowBrowsePanel: () => void

  // Handlers — note edit
  onSelectNoteTemplate: (templateId: string) => void
  onDraftChange: <Field extends keyof NoteDraft>(field: Field, value: NoteDraft[Field]) => void
  onTagInputChange: (value: string) => void
  onDraftTagsChange: (tags: readonly string[]) => void
  onCommitPendingTagInput: () => void
  onSaveNote: () => void
  onDeleteNote: () => void
}

export default function CampaignDetailPage({
  owner,
  authToken,
  isSharedMode,
  isKeycloakMode,
  canEditWorkspace,
  canManageSelectedCampaign,
  resolvedCampaign,
  resolvedSelectedCampaignId,
  resolvedCampaignOptions,
  resolvedDesktopSubtitle,
  campaignFormMode,
  campaignDraft,
  selectedCampaignTemplateId,
  isSavingCampaign,
  useCompactDesktopHeader,
  currentCampaignMemberships,
  membershipConsolidationDraft,
  membershipConsolidationPreview,
  membershipConsolidationNotice,
  selectedSourceMembership,
  selectedTargetMembership,
  hasValidMembershipConsolidationSelection,
  canApplyMembershipConsolidation,
  isPreviewingMembershipConsolidation,
  isApplyingMembershipConsolidation,
  shareLinks,
  shareLinkDraft,
  shareLinkNotice,
  revealedShareLinks,
  shareLinkActionErrors,
  revealingShareLinkId,
  copiedShareLinkId,
  isCreatingShareLink,
  resolvedMembership,
  accountNotice,
  isLinkingAccount,
  isRegisterMode,
  registerDraft,
  loginDraft,
  overview,
  error,
  noteBrowseMode,
  selectedSessionName,
  selectedTagFilter,
  searchText,
  draft,
  tagInputValue,
  selectedNoteId,
  isCreating,
  isLoadingSessionNotes,
  isLoadingActivity,
  isQuickCapturing,
  isSaving,
  isDeleting,
  selectedNoteTemplateId,
  selectedNoteTemplate,
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
  selectedActivityMembershipId,
  resolvedActivityCollaborators,
  resolvedSelectedActivityCollaborator,
  sortedActivityEntries,
  selectedTagFacet,
  showSplitNoteWorkspace,
  canSplitNoteWorkspace,
  showBrowsePane,
  showEditorPane,
  workspaceEditorLabel,
  onSelectCampaign,
  onNewCampaign,
  onOpenSettings,
  onNewNote,
  onLogout,
  onCampaignDraftChange,
  onSelectedCampaignTemplateIdChange,
  onSaveCampaign,
  onCancelCampaignForm,
  onMembershipConsolidationDraftChange,
  onPreviewMembershipConsolidation,
  onApplyMembershipConsolidation,
  onShareLinkDraftChange,
  onCreateShareLink,
  onRevealShareLink,
  onToggleShareLinkVisibility,
  onCopyShareLink,
  onRevokeShareLink,
  onRegisterDraftChange,
  onLoginDraftChange,
  onToggleRegisterMode,
  onLinkSharedMembership,
  onOpenAllNotes,
  onOpenSessionBrowser,
  onOpenRecentActivity,
  onSelectTagFilter,
  onClearTagFilter,
  onClearSearch,
  onSearchTextChange,
  onSelectSession,
  onSelectActivityCollaborator,
  onSelectNote,
  onShowBrowsePane,
  onShowEditorPane,
  onToggleSplitWorkspace,
  onToggleQuickCapture,
  onQuickCaptureValueChange,
  onQuickCaptureSubmit,
  onShowBrowsePanel,
  onSelectNoteTemplate,
  onDraftChange,
  onTagInputChange,
  onDraftTagsChange,
  onCommitPendingTagInput,
  onSaveNote,
  onDeleteNote,
}: CampaignDetailPageProps) {
  const selectedCampaignTemplate = getCampaignStarterTemplate(selectedCampaignTemplateId)

  const statCards = useMemo(
    () => [
      {
        label: 'Total notes',
        value: overview.stats.totalNotes,
        icon: <StickyNote2RoundedIcon color="primary" />,
      },
      {
        label: 'Draft notes',
        value: overview.stats.draftNotes,
        icon: <EditNoteRoundedIcon color="primary" />,
      },
      {
        label: 'Active notes',
        value: overview.stats.activeNotes,
        icon: <PlaylistAddCheckCircleRoundedIcon color="primary" />,
      },
      {
        label: 'Session-linked notes',
        value: overview.stats.sessionLinkedNotes,
        icon: <EventRoundedIcon color="primary" />,
      },
    ],
    [overview],
  )

  const notePaneHeading =
    noteBrowseMode === 'activity'
      ? 'Recent activity'
      : noteBrowseMode === 'sessions'
        ? selectedSessionName
          ? `${selectedSessionName} notes`
          : 'Sessions'
        : selectedTagFilter
          ? `Notes tagged "${selectedTagFilter}"`
          : 'Notes'

  const notePaneDescription =
    noteBrowseMode === 'activity'
      ? resolvedSelectedActivityCollaborator
        ? `See the latest notes created or edited by ${resolvedSelectedActivityCollaborator.displayName} without digging through the full archive.`
        : 'See which notes changed recently and who touched them, without turning the workspace into a full audit log.'
      : noteBrowseMode === 'sessions'
        ? selectedSessionName
          ? `Browse the notes captured during ${selectedSessionName} without leaving the note detail view.`
          : 'Jump into a session to answer "what happened in this session?" without digging through the whole campaign.'
        : searchText.trim() && selectedTagFacet
          ? `Showing ${filteredNotes.length} ${filteredNotes.length === 1 ? 'note' : 'notes'} matching "${searchText}" in ${selectedTagFacet.tag}.`
          : searchText.trim()
            ? `Showing ${filteredNotes.length} ${filteredNotes.length === 1 ? 'note' : 'notes'} matching "${searchText}" across titles, body, link relationships, tags, sessions, and collaborators.`
            : selectedTagFacet
              ? `Showing ${selectedTagFacet.count} ${
                  selectedTagFacet.count === 1 ? 'note' : 'notes'
                } tagged ${selectedTagFacet.tag} in ${resolvedCampaign?.name ?? 'this campaign'}.`
              : defaultNotesPaneDescription

  return (
    <Box
      component="main"
      sx={{ minHeight: '100vh', py: { xs: 2.5, md: 4 }, width: '100%' }}
    >
      <Container maxWidth="xl" sx={{ minWidth: 0, position: 'relative' }}>
        <Stack spacing={2.5}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: { xs: 'center', lg: 'space-between' },
              alignItems: 'flex-start',
              gap: 2,
              width: '100%',
              position: { xs: 'static', lg: 'sticky' },
              top: { lg: 12 },
              zIndex: { lg: 3 },
            }}
          >
            <Box
              aria-label="Application brand"
              sx={{
                display: { xs: 'none', lg: 'inline-flex' },
                alignItems: 'center',
                flexShrink: 0,
                gap: 0.75,
                px: 1.25,
                py: 0.75,
                borderRadius: '999px',
                border: '1px solid',
                borderColor: 'rgba(167, 139, 250, 0.2)',
                bgcolor: 'rgba(15, 23, 42, 0.72)',
                color: 'rgba(255, 255, 255, 0.78)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 12px 30px rgba(2, 6, 23, 0.24)',
                maxWidth: '100%',
              }}
            >
              <DndNotesMark fontSize="small" />
              <Typography
                variant="caption"
                sx={{
                  ...singleLineTextSx,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                D&amp;D Notes
              </Typography>
            </Box>
            <CampaignWorkspaceHeader
              campaignName={resolvedCampaign?.name ?? overview.campaign.name}
              mobileSubtitle={`${resolvedCampaign?.setting ?? overview.campaign.setting} • ${resolvedCampaign?.system ?? overview.campaign.system}`}
              desktopSubtitle={resolvedDesktopSubtitle}
              selectedCampaignId={resolvedSelectedCampaignId ?? overview.campaign.id}
              campaignOptions={resolvedCampaignOptions}
              onSelectCampaign={(campaignId) => {
                if (!isSharedMode) {
                  onSelectCampaign(campaignId)
                }
              }}
              actions={[
                {
                  ariaLabel: 'New campaign',
                  color: 'inherit',
                  icon: <AddCircleOutlineRoundedIcon fontSize="small" />,
                  onClick: isSharedMode ? () => window.location.assign('/') : onNewCampaign,
                },
                {
                  ariaLabel: 'Campaign settings',
                  color: 'inherit',
                  icon: <SettingsRoundedIcon fontSize="small" />,
                  onClick: isSharedMode ? () => window.location.assign('/') : onOpenSettings,
                  disabled: isSharedMode ? resolvedMembership?.userId === null : !canManageSelectedCampaign,
                },
                {
                  ariaLabel: 'New note',
                  color: 'secondary',
                  icon: <AddRoundedIcon fontSize="small" />,
                  onClick: onNewNote,
                  disabled: !canEditWorkspace,
                },
                {
                  ariaLabel: 'Sign out',
                  color: 'inherit',
                  icon: <LogoutRoundedIcon fontSize="small" />,
                  onClick: onLogout,
                },
              ]}
              surfaceRadius={surfaceRadius}
              compactDesktop={useCompactDesktopHeader}
              stickyDesktop={false}
            />
          </Box>

          {error ? (
            <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
              {error}
            </Alert>
          ) : null}

          {!isSharedMode && owner?.isSiteAdmin && authToken ? (
            <AdminPage authToken={authToken} surfaceRadius={surfaceRadius} />
          ) : null}

          {isSharedMode && resolvedMembership?.userId === null ? (
            <Card sx={{ borderRadius: surfaceRadius }}>
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h5">Link this guest membership</Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      {isKeycloakMode
                        ? 'Sign in with your tenant account to attach this guest history to a real account. The claim still has to happen from the same browser session that joined the campaign.'
                        : 'Create or connect a real account without changing the membership that already owns your shared note history. For this first release, the claim must happen from the same browser that joined the campaign.'}
                    </Typography>
                  </Box>

                  {accountNotice ? (
                    <Alert severity="success" sx={{ borderRadius: surfaceRadius }}>
                      {accountNotice}
                    </Alert>
                  ) : null}

                  {!isKeycloakMode && isRegisterMode ? (
                    <TextField
                      label="Account display name"
                      value={registerDraft.displayName}
                      onChange={(event) =>
                        onRegisterDraftChange('displayName', event.target.value)
                      }
                    />
                  ) : null}

                  {!isKeycloakMode ? (
                    <>
                      <TextField
                        label="Email"
                        type="email"
                        value={isRegisterMode ? registerDraft.email : loginDraft.email}
                        onChange={(event) => {
                          const value = event.target.value
                          if (isRegisterMode) {
                            onRegisterDraftChange('email', value)
                          } else {
                            onLoginDraftChange('email', value)
                          }
                        }}
                      />

                      <TextField
                        label="Password"
                        type="password"
                        value={isRegisterMode ? registerDraft.password : loginDraft.password}
                        onChange={(event) => {
                          const value = event.target.value
                          if (isRegisterMode) {
                            onRegisterDraftChange('password', value)
                          } else {
                            onLoginDraftChange('password', value)
                          }
                        }}
                      />
                    </>
                  ) : null}

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Button variant="contained" onClick={onLinkSharedMembership} disabled={isLinkingAccount}>
                      {isLinkingAccount
                        ? isKeycloakMode
                          ? 'Signing in…'
                          : isRegisterMode
                            ? 'Creating and linking…'
                            : 'Linking account…'
                        : isKeycloakMode
                          ? authToken
                            ? 'Link this guest membership'
                            : 'Sign in to link'
                          : isRegisterMode
                            ? 'Create and link account'
                            : 'Sign in and link account'}
                    </Button>
                    {!isKeycloakMode ? (
                      <Button
                        variant="text"
                        onClick={onToggleRegisterMode}
                      >
                        {isRegisterMode
                          ? 'Already have an account? Sign in'
                          : 'Need an account? Create one'}
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ) : !isSharedMode && campaignFormMode !== 'closed' ? (
            <Card sx={{ borderRadius: surfaceRadius }}>
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h5">
                      {campaignFormMode === 'create'
                        ? 'Create campaign'
                        : 'Edit campaign settings'}
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      {campaignFormMode === 'create'
                        ? 'Set up a campaign shell before you invite anyone else in.'
                        : 'Update campaign metadata and review the owner-side membership list.'}
                    </Typography>
                  </Box>

                  {campaignFormMode === 'create' ? (
                    <Stack spacing={1.5}>
                      <TextField
                        select
                        label="Campaign starter"
                        value={selectedCampaignTemplateId}
                        onChange={(event) =>
                          onSelectedCampaignTemplateIdChange(event.target.value)
                        }
                        helperText="Optional. Seed flexible starter notes or leave the campaign blank."
                      >
                        {campaignStarterTemplates.map((template) => (
                          <MenuItem key={template.id} value={template.id}>
                            {template.name}
                          </MenuItem>
                        ))}
                      </TextField>

                      {selectedCampaignTemplate.starterNotes.length > 0 ? (
                        <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                          <Stack spacing={1}>
                            <Typography variant="body2">
                              {selectedCampaignTemplate.description}
                            </Typography>
                            <Stack
                              direction="row"
                              spacing={1}
                              useFlexGap
                              sx={{ flexWrap: 'wrap' }}
                            >
                              {selectedCampaignTemplate.starterNotes.map((starterNote) => (
                                <Chip
                                  key={starterNote.title}
                                  label={starterNote.title}
                                  size="small"
                                />
                              ))}
                            </Stack>
                          </Stack>
                        </Alert>
                      ) : null}
                    </Stack>
                  ) : null}

                  <TextField
                    label="Campaign name"
                    value={campaignDraft.name}
                    onChange={(event) =>
                      onCampaignDraftChange('name', event.target.value)
                    }
                  />
                  <TextField
                    label="Tagline"
                    value={campaignDraft.tagline}
                    onChange={(event) =>
                      onCampaignDraftChange('tagline', event.target.value)
                    }
                  />
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <TextField
                      fullWidth
                      label="System"
                      value={campaignDraft.system}
                      onChange={(event) =>
                        onCampaignDraftChange('system', event.target.value)
                      }
                    />
                    <TextField
                      fullWidth
                      label="Setting"
                      value={campaignDraft.setting}
                      onChange={(event) =>
                        onCampaignDraftChange('setting', event.target.value)
                      }
                    />
                  </Stack>
                  <TextField
                    label="Next session"
                    value={campaignDraft.nextSession}
                    onChange={(event) =>
                      onCampaignDraftChange('nextSession', event.target.value)
                    }
                    helperText="Optional. Use an ISO timestamp or plain text date."
                  />

                  {campaignFormMode === 'edit' ? (
                    <Stack spacing={2.5}>
                      <Box>
                        <Typography variant="subtitle1">Current memberships</Typography>
                        <Stack
                          direction="row"
                          spacing={1}
                          useFlexGap
                          sx={{ mt: 1, flexWrap: 'wrap' }}
                        >
                          {currentCampaignMemberships.map((membership) => (
                            <Chip
                              key={membership.id}
                              label={`${membership.displayName} (${membership.role === 'guest' && membership.userId !== null ? 'linked collaborator' : membership.role})`}
                              color={membership.role === 'owner' ? 'secondary' : membership.userId !== null ? 'primary' : 'default'}
                            />
                          ))}
                        </Stack>
                      </Box>

                      <Box>
                        <Typography variant="subtitle1">
                          Consolidate note authorship
                        </Typography>
                        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                          Reassign note authorship and edit attribution from one
                          membership onto another without changing note text or
                          deleting memberships.
                        </Typography>
                      </Box>

                      {currentCampaignMemberships.length < 2 ? (
                        <Typography color="text.secondary">
                          Add or link another membership before consolidating note
                          attribution.
                        </Typography>
                      ) : (
                        <Stack spacing={2}>
                          <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={2}
                          >
                            <TextField
                              select
                              fullWidth
                              label="Source membership"
                              value={membershipConsolidationDraft.sourceMembershipId}
                              onChange={(event) =>
                                onMembershipConsolidationDraftChange(
                                  'sourceMembershipId',
                                  event.target.value,
                                )
                              }
                              helperText="Move note attribution away from this membership."
                            >
                              {currentCampaignMemberships.map((membership) => (
                                <MenuItem key={membership.id} value={membership.id}>
                                  {describeCampaignMembership(membership)}
                                </MenuItem>
                              ))}
                            </TextField>
                            <TextField
                              select
                              fullWidth
                              label="Target membership"
                              value={membershipConsolidationDraft.targetMembershipId}
                              onChange={(event) =>
                                onMembershipConsolidationDraftChange(
                                  'targetMembershipId',
                                  event.target.value,
                                )
                              }
                              helperText="This membership keeps the note attribution."
                            >
                              {currentCampaignMemberships.map((membership) => (
                                <MenuItem
                                  key={membership.id}
                                  value={membership.id}
                                  disabled={
                                    membership.id ===
                                    membershipConsolidationDraft.sourceMembershipId
                                  }
                                >
                                  {describeCampaignMembership(membership)}
                                </MenuItem>
                              ))}
                            </TextField>
                          </Stack>

                          {selectedSourceMembership && selectedTargetMembership ? (
                            <Typography color="text.secondary" variant="body2">
                              Previewing moves note attribution from{' '}
                              {selectedSourceMembership.displayName} to{' '}
                              {selectedTargetMembership.displayName}.
                            </Typography>
                          ) : null}

                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1.5}
                          >
                            <Button
                              variant="outlined"
                              onClick={onPreviewMembershipConsolidation}
                              disabled={
                                !hasValidMembershipConsolidationSelection ||
                                isPreviewingMembershipConsolidation ||
                                isApplyingMembershipConsolidation
                              }
                            >
                              {isPreviewingMembershipConsolidation
                                ? 'Previewing consolidation…'
                                : 'Preview consolidation'}
                            </Button>
                            <Button
                              variant="contained"
                              onClick={onApplyMembershipConsolidation}
                              disabled={
                                !canApplyMembershipConsolidation ||
                                isPreviewingMembershipConsolidation ||
                                isApplyingMembershipConsolidation
                              }
                            >
                              {isApplyingMembershipConsolidation
                                ? 'Applying consolidation…'
                                : 'Apply consolidation'}
                            </Button>
                          </Stack>

                          {membershipConsolidationPreview ? (
                            <Alert
                              severity={
                                membershipConsolidationPreview.applied
                                  ? 'success'
                                  : membershipConsolidationPreview.requiresRoleMismatchConfirmation
                                    ? 'warning'
                                    : 'info'
                              }
                              sx={{ borderRadius: surfaceRadius }}
                            >
                              <Stack spacing={1}>
                                <Typography variant="subtitle2">
                                  {membershipConsolidationPreview.applied
                                    ? 'Consolidation applied'
                                    : 'Consolidation preview'}
                                </Typography>
                                <Typography variant="body2">
                                  {describeCampaignMembership(
                                    membershipConsolidationPreview.sourceMembership,
                                  )}{' '}
                                  {'->'}
                                  {' '}
                                  {describeCampaignMembership(
                                    membershipConsolidationPreview.targetMembership,
                                  )}
                                </Typography>
                                <Typography variant="body2">
                                  Affected notes:{' '}
                                  {
                                    membershipConsolidationPreview.noteChanges
                                      .affectedNoteCount
                                  }
                                  . Authored:{' '}
                                  {
                                    membershipConsolidationPreview.noteChanges
                                      .authoredNoteCount
                                  }
                                  . Edited:{' '}
                                  {
                                    membershipConsolidationPreview.noteChanges
                                      .editedNoteCount
                                  }
                                  . Authored and edited:{' '}
                                  {
                                    membershipConsolidationPreview.noteChanges
                                      .authoredAndEditedNoteCount
                                  }
                                  .
                                </Typography>
                                {membershipConsolidationPreview.warnings.length > 0 ? (
                                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                                    {membershipConsolidationPreview.warnings.map(
                                      (warning) => (
                                        <Typography
                                          component="li"
                                          key={warning}
                                          variant="body2"
                                        >
                                          {warning}
                                        </Typography>
                                      ),
                                    )}
                                  </Box>
                                ) : null}
                                {membershipConsolidationPreview.requiresRoleMismatchConfirmation ? (
                                  <FormControlLabel
                                    control={
                                      <Checkbox
                                        checked={
                                          membershipConsolidationDraft.confirmRoleMismatch
                                        }
                                        onChange={(event) =>
                                          onMembershipConsolidationDraftChange(
                                            'confirmRoleMismatch',
                                            event.target.checked,
                                          )
                                        }
                                      />
                                    }
                                    label={`I understand this moves ${membershipConsolidationPreview.sourceMembership.role} note attribution onto ${membershipConsolidationPreview.targetMembership.role}.`}
                                  />
                                ) : null}
                              </Stack>
                            </Alert>
                          ) : null}

                          {membershipConsolidationNotice ? (
                            <Alert severity="success" sx={{ borderRadius: surfaceRadius }}>
                              {membershipConsolidationNotice}
                            </Alert>
                          ) : null}
                        </Stack>
                      )}

                      <Box>
                        <Typography variant="subtitle1">Shared links</Typography>
                        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                          Only the shared route can be embedded. Use frame ancestors to allow
                          specific VTT hosts or leave it blank to block embedding.
                        </Typography>
                      </Box>

                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                        <TextField
                          fullWidth
                          label="Link label"
                          value={shareLinkDraft.label}
                          onChange={(event) =>
                            onShareLinkDraftChange('label', event.target.value)
                          }
                          helperText="Optional. Use this to remember where the link is shared."
                        />
                        <TextField
                          select
                          label="Access"
                          value={shareLinkDraft.accessLevel}
                          onChange={(event) =>
                            onShareLinkDraftChange(
                              'accessLevel',
                              event.target.value as CampaignShareLink['accessLevel'],
                            )
                          }
                          sx={{ minWidth: { md: 180 } }}
                        >
                          <MenuItem value="editor">Editor</MenuItem>
                          <MenuItem value="viewer">Viewer</MenuItem>
                        </TextField>
                      </Stack>

                      <TextField
                        label="Allowed frame ancestors"
                        value={shareLinkDraft.frameAncestors}
                        onChange={(event) =>
                          onShareLinkDraftChange('frameAncestors', event.target.value)
                        }
                        helperText="Optional. Use 'self', 'none', or space-separated origins such as https://app.roll20.net."
                      />

                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        <Button
                          variant="outlined"
                          onClick={onCreateShareLink}
                          disabled={isCreatingShareLink}
                        >
                          {isCreatingShareLink ? 'Creating link…' : 'Create shared link'}
                        </Button>
                      </Stack>

                      {shareLinkNotice ? (
                        <Alert severity="success" sx={{ borderRadius: surfaceRadius }}>
                          {shareLinkNotice}
                        </Alert>
                      ) : null}

                      {shareLinks.length === 0 ? (
                        <Typography color="text.secondary">
                          No active shared links yet.
                        </Typography>
                      ) : (
                        <Stack spacing={1.5}>
                          {shareLinks.map((shareLink) => {
                            const revealedShareLink = revealedShareLinks[shareLink.id]
                            const shareLinkError = shareLinkActionErrors[shareLink.id]
                            const isRevealingShareLink =
                              revealingShareLinkId === shareLink.id
                            const shareLinkLabel =
                              shareLink.label?.trim()
                                ? shareLink.label
                                : 'Untitled shared link'

                            return (
                              <Box
                                component="section"
                                key={shareLink.id}
                                aria-label={`${shareLinkLabel} shared link`}
                                sx={{
                                  border: '1px solid',
                                  borderColor: 'divider',
                                  borderRadius: noteItemRadius,
                                  px: 2,
                                  py: 1.75,
                                }}
                              >
                                <Stack
                                  direction={{ xs: 'column', md: 'row' }}
                                  spacing={2}
                                  sx={{ justifyContent: 'space-between' }}
                                >
                                  <Stack spacing={1.25} sx={{ flexGrow: 1 }}>
                                    <Box>
                                      <Typography variant="subtitle1">{shareLinkLabel}</Typography>
                                      <Typography color="text.secondary" variant="body2">
                                        {shareLink.accessLevel === 'editor'
                                          ? 'Editors can view and update notes.'
                                          : 'Viewers can open the shared route without editing.'}
                                      </Typography>
                                      <Typography
                                        color="text.secondary"
                                        variant="body2"
                                        sx={{ mt: 0.5 }}
                                      >
                                        Frame ancestors:{' '}
                                        {shareLink.frameAncestors ?? 'Not embeddable'}
                                      </Typography>
                                    </Box>

                                    {revealedShareLink ? (
                                      <Box
                                        sx={{
                                          border: '1px solid',
                                          borderColor: 'divider',
                                          borderRadius: 2,
                                          px: 1.5,
                                          py: 1.25,
                                          backgroundColor: 'background.default',
                                        }}
                                      >
                                        <Typography color="text.secondary" variant="caption">
                                          Reusable share URL
                                        </Typography>
                                        <Typography
                                          component="p"
                                          variant="body2"
                                          sx={{
                                            mt: 0.75,
                                            fontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
                                            wordBreak: 'break-all',
                                            filter: revealedShareLink.isVisible
                                              ? 'none'
                                              : 'blur(6px)',
                                            transition: 'filter 120ms ease',
                                            userSelect: revealedShareLink.isVisible
                                              ? 'text'
                                              : 'none',
                                          }}
                                        >
                                          {revealedShareLink.url}
                                        </Typography>
                                      </Box>
                                    ) : (
                                      <Typography color="text.secondary" variant="body2">
                                        URL hidden until you reveal it on this card.
                                      </Typography>
                                    )}

                                    {shareLinkError ? (
                                      <Alert
                                        severity="warning"
                                        sx={{ borderRadius: surfaceRadius }}
                                      >
                                        {shareLinkError}
                                      </Alert>
                                    ) : null}
                                  </Stack>

                                  <Stack
                                    direction={{ xs: 'column', sm: 'row', md: 'column' }}
                                    spacing={1}
                                    sx={{ alignItems: { md: 'flex-end' } }}
                                  >
                                    {revealedShareLink ? (
                                      <>
                                        <Button
                                          variant="outlined"
                                          onClick={() =>
                                            onToggleShareLinkVisibility(shareLink.id)
                                          }
                                        >
                                          {revealedShareLink.isVisible
                                            ? 'Hide link'
                                            : 'Show link'}
                                        </Button>
                                        <Button
                                          variant="outlined"
                                          onClick={() =>
                                            onCopyShareLink(shareLink.id)
                                          }
                                        >
                                          {copiedShareLinkId === shareLink.id
                                            ? 'Copied'
                                            : 'Copy link'}
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        variant="outlined"
                                        onClick={() =>
                                          onRevealShareLink(shareLink.id)
                                        }
                                        disabled={isRevealingShareLink}
                                      >
                                        {isRevealingShareLink
                                          ? 'Revealing link…'
                                          : 'Reveal link'}
                                      </Button>
                                    )}
                                    <Button
                                      color="error"
                                      variant="text"
                                      onClick={() => onRevokeShareLink(shareLink.id)}
                                    >
                                      Revoke link
                                    </Button>
                                  </Stack>
                                </Stack>
                              </Box>
                            )
                          })}
                        </Stack>
                      )}
                    </Stack>
                  ) : null}

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Button
                      variant="contained"
                      startIcon={<SaveRoundedIcon />}
                      onClick={onSaveCampaign}
                      disabled={isSavingCampaign}
                    >
                      {isSavingCampaign
                        ? campaignFormMode === 'create'
                          ? 'Creating campaign…'
                          : 'Saving settings…'
                        : campaignFormMode === 'create'
                          ? 'Create campaign'
                          : 'Save campaign settings'}
                    </Button>
                    <Button variant="text" onClick={onCancelCampaignForm}>
                      Cancel
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ) : null}

          <Box
            component="ul"
            aria-label="Campaign stats"
            sx={{
              display: 'grid',
              gap: 3,
              listStyle: 'none',
              p: 0,
              m: 0,
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                md: 'repeat(4, minmax(0, 1fr))',
              },
            }}
          >
            {statCards.map((card) => (
              <Box key={card.label} component="li">
                <Box
                  aria-label={`${card.label}: ${card.value}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    minWidth: 0,
                    borderRadius: statPillRadius,
                    px: { xs: 1.75, sm: 2.25 },
                    py: { xs: 1.25, sm: 1.5 },
                    bgcolor: 'rgba(15, 23, 42, 0.88)',
                    border: '1px solid',
                    borderColor: 'rgba(167, 139, 250, 0.18)',
                    boxShadow: '0 20px 40px rgba(15, 23, 42, 0.24)',
                  }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 40,
                      height: 40,
                      flexShrink: 0,
                      borderRadius: '50%',
                      bgcolor: 'rgba(167, 139, 250, 0.16)',
                    }}
                  >
                    {card.icon}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      color="text.secondary"
                      variant="body2"
                      sx={{ lineHeight: 1.2 }}
                    >
                      {card.label}
                    </Typography>
                    <Typography
                      variant="h5"
                      sx={{
                        mt: 0.25,
                        fontSize: { xs: '1.35rem', sm: '1.55rem' },
                        lineHeight: 1.1,
                      }}
                    >
                      {card.value}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: 2,
              minWidth: 0,
              gridTemplateColumns: showSplitNoteWorkspace
                ? {
                    xs: '1fr',
                    lg: 'minmax(0, 1.1fr) minmax(0, 1fr)',
                  }
                : '1fr',
            }}
          >
            <WorkspacePane
              showBrowsePane={showBrowsePane}
              showEditorPane={showEditorPane}
              showSplitNoteWorkspace={showSplitNoteWorkspace}
              canSplitNoteWorkspace={canSplitNoteWorkspace}
              onShowBrowsePane={onShowBrowsePane}
              onShowEditorPane={onShowEditorPane}
              onToggleSplitWorkspace={onToggleSplitWorkspace}
              workspaceEditorLabel={workspaceEditorLabel}
              surfaceRadius={surfaceRadius}
              cardSx={{ gridColumn: '1 / -1' }}
            />

            {showBrowsePane ? (
              <NotesBrowsePane
                heading={notePaneHeading}
                description={notePaneDescription}
                actions={
                  <>
                    <Button
                      size="small"
                      variant={noteBrowseMode === 'notes' ? 'contained' : 'outlined'}
                      onClick={onOpenAllNotes}
                    >
                      All notes
                    </Button>
                    <Button
                      size="small"
                      variant={noteBrowseMode === 'sessions' ? 'contained' : 'outlined'}
                      onClick={onOpenSessionBrowser}
                    >
                      Browse by session
                    </Button>
                    <Button
                      size="small"
                      variant={noteBrowseMode === 'activity' ? 'contained' : 'outlined'}
                      onClick={onOpenRecentActivity}
                    >
                      Recent activity
                    </Button>
                    <Button
                      size="small"
                      variant={isQuickCaptureOpen ? 'contained' : 'outlined'}
                      startIcon={<BoltRoundedIcon />}
                      onClick={onToggleQuickCapture}
                      disabled={!canEditWorkspace}
                    >
                      Quick capture
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<AddRoundedIcon />}
                      onClick={onNewNote}
                      disabled={!canEditWorkspace}
                    >
                      New note
                    </Button>
                  </>
                }
                searchText={searchText}
                onSearchTextChange={onSearchTextChange}
                onClearSearch={onClearSearch}
                selectedTagLabel={
                  selectedTagFacet
                    ? `Filtering by ${selectedTagFacet.tag} (${selectedTagFacet.count})`
                    : null
                }
                onClearTagFilter={onClearTagFilter}
                quickCapture={{
                  isOpen: isQuickCaptureOpen,
                  value: quickCaptureTitle,
                  onValueChange: onQuickCaptureValueChange,
                  onSubmit: onQuickCaptureSubmit,
                  isSubmitting: isQuickCapturing || !canEditWorkspace,
                }}
                tagFilters={
                  tagFacets.length === 0 ? (
                    <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                      No tagged notes yet. Add tags to a note to browse the campaign this way.
                    </Alert>
                  ) : (
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      aria-label="Tag filter list"
                      sx={{ flexWrap: 'wrap' }}
                    >
                      {tagFacets.map((tagFacet) => (
                        <Button
                          key={tagFacet.tag}
                          size="small"
                          variant={selectedTagFilter === tagFacet.tag ? 'contained' : 'outlined'}
                          onClick={() => onSelectTagFilter(tagFacet.tag)}
                        >
                          {tagFacet.tag} ({tagFacet.count})
                        </Button>
                      ))}
                    </Stack>
                  )
                }
                surfaceRadius={surfaceRadius}
              >
                {noteBrowseMode === 'activity' ? (
                    <Stack spacing={2.5}>
                      <Stack spacing={1.5}>
                        <Typography variant="subtitle1">Filter by collaborator</Typography>
                        <Stack
                          direction="row"
                          spacing={1}
                          useFlexGap
                          aria-label="Activity collaborator filter"
                          sx={{ flexWrap: 'wrap' }}
                        >
                          <Button
                            variant={
                              selectedActivityMembershipId === null ? 'contained' : 'outlined'
                            }
                            size="small"
                            onClick={() => onSelectActivityCollaborator(null)}
                          >
                            All collaborators
                          </Button>
                          {resolvedActivityCollaborators.map((collaborator) => (
                            <Button
                              key={collaborator.membershipId}
                              variant={
                                selectedActivityMembershipId === collaborator.membershipId
                                  ? 'contained'
                                  : 'outlined'
                              }
                              size="small"
                              onClick={() =>
                                onSelectActivityCollaborator(
                                  collaborator.membershipId,
                                )
                              }
                            >
                              {collaborator.displayName} ({collaborator.noteCount})
                            </Button>
                          ))}
                        </Stack>
                        {resolvedSelectedActivityCollaborator ? (
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{ alignItems: { sm: 'center' } }}
                          >
                            <Chip
                              label={`Filtering by ${resolvedSelectedActivityCollaborator.displayName}`}
                              size="small"
                              color="primary"
                            />
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => onSelectActivityCollaborator(null)}
                            >
                              Clear filter
                            </Button>
                          </Stack>
                        ) : null}
                      </Stack>

                      {!isSharedMode && isLoadingActivity ? (
                        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
                          <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
                            <CircularProgress size={28} />
                            <Typography color="text.secondary" variant="body2">
                              Loading recent activity…
                            </Typography>
                          </Stack>
                        </Box>
                      ) : sortedActivityEntries.length === 0 ? (
                        <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                          {resolvedSelectedActivityCollaborator
                            ? `No recent notes for ${resolvedSelectedActivityCollaborator.displayName} yet.`
                            : 'No notes in this campaign yet. Create your first note to get started.'}
                        </Alert>
                      ) : (
                        <List
                          disablePadding
                          aria-label="Recent activity list"
                          sx={{ display: 'grid', gap: 1.5 }}
                        >
                          {sortedActivityEntries.map((activityEntry) => (
                            <ListItemButton
                              key={activityEntry.id}
                              selected={selectedNoteId === activityEntry.id && !isCreating}
                              onClick={() => onSelectNote(activityEntry)}
                              sx={{
                                borderRadius: noteItemRadius,
                                border: '1px solid',
                                borderColor:
                                  selectedNoteId === activityEntry.id && !isCreating
                                    ? 'primary.main'
                                    : 'divider',
                                alignItems: 'flex-start',
                              }}
                            >
                              <ListItemText
                                disableTypography
                                primary={
                                  <Stack
                                    direction="row"
                                    spacing={1.5}
                                    sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
                                  >
                                    <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
                                      <Typography
                                        variant="subtitle1"
                                        title={activityEntry.title}
                                        sx={singleLineTextSx}
                                      >
                                        {activityEntry.title}
                                      </Typography>
                                      <Typography
                                        color="text.secondary"
                                        variant="body2"
                                        title={excerpt(activityEntry.body)}
                                        sx={singleLineTextSx}
                                      >
                                        {excerpt(activityEntry.body)}
                                      </Typography>
                                      <Typography
                                        color="text.secondary"
                                        variant="caption"
                                        title={formatSessionLine(activityEntry.sessionName)}
                                        sx={singleLineTextSx}
                                      >
                                        {formatSessionLine(activityEntry.sessionName)}
                                      </Typography>
                                    </Stack>
                                    <Stack spacing={0.75} sx={{ alignItems: 'flex-end', flexShrink: 0 }}>
                                      <Chip
                                        label={activityEntry.action === 'created' ? 'Created' : 'Edited'}
                                        color={
                                          activityEntry.action === 'created'
                                            ? 'primary'
                                            : 'secondary'
                                        }
                                        size="small"
                                      />
                                      <Chip label={activityEntry.status} size="small" />
                                      <Typography color="text.secondary" variant="caption">
                                        {formatTimestamp(activityEntry.updatedAt)}
                                      </Typography>
                                    </Stack>
                                  </Stack>
                                }
                              />
                            </ListItemButton>
                          ))}
                        </List>
                      )}
                    </Stack>
                ) : noteBrowseMode === 'sessions' && !selectedSessionName ? (
                    resolvedSessionSummaries.length === 0 ? (
                      <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                        No session-linked notes yet. Add a session name to notes when you want
                        a quick "what happened in this session?" view.
                      </Alert>
                    ) : (
                      <List
                        disablePadding
                        aria-label="Session list"
                        sx={{ display: 'grid', gap: 1.5 }}
                      >
                        {resolvedSessionSummaries.map((sessionSummary) => (
                          <ListItemButton
                            key={sessionSummary.sessionName}
                            onClick={() =>
                              onSelectSession(sessionSummary.sessionName)
                            }
                            sx={{
                              borderRadius: noteItemRadius,
                              border: '1px solid',
                              borderColor: 'divider',
                              alignItems: 'flex-start',
                            }}
                          >
                            <ListItemText
                              disableTypography
                              primary={
                                <Stack
                                  direction="row"
                                  spacing={1.5}
                                  sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
                                >
                                  <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography
                                      variant="subtitle1"
                                      title={sessionSummary.sessionName}
                                      sx={singleLineTextSx}
                                    >
                                      {sessionSummary.sessionName}
                                    </Typography>
                                    <Typography color="text.secondary" variant="body2" sx={singleLineTextSx}>
                                      Open this session to review the note trail.
                                    </Typography>
                                    <Typography
                                      color="text.secondary"
                                      variant="caption"
                                      title={formatTimestamp(sessionSummary.latestActivity)}
                                      sx={singleLineTextSx}
                                    >
                                      Latest activity {formatTimestamp(sessionSummary.latestActivity)}
                                    </Typography>
                                  </Stack>
                                  <Chip
                                    label={`${sessionSummary.noteCount} ${
                                      sessionSummary.noteCount === 1 ? 'note' : 'notes'
                                    }`}
                                    size="small"
                                  />
                                </Stack>
                              }
                            />
                          </ListItemButton>
                        ))}
                      </List>
                    )
                ) : (
                    <Stack spacing={2}>
                      {noteBrowseMode === 'sessions' && selectedSessionName ? (
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={1}
                          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                        >
                          <Button variant="text" onClick={onOpenSessionBrowser}>
                            Back to sessions
                          </Button>
                          <Chip
                            label={`${
                              resolvedSelectedSessionSummary?.noteCount ?? displayedNotes.length
                            } ${
                              (resolvedSelectedSessionSummary?.noteCount ?? displayedNotes.length) === 1
                                ? 'note'
                                : 'notes'
                            } in ${selectedSessionName}`}
                            size="small"
                          />
                        </Stack>
                      ) : null}

                      {!isSharedMode && isLoadingSessionNotes ? (
                        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
                          <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
                            <CircularProgress size={28} />
                            <Typography color="text.secondary" variant="body2">
                              Loading session notes…
                            </Typography>
                          </Stack>
                        </Box>
                      ) : displayedNotes.length === 0 ? (
                        noteBrowseMode === 'notes' && !selectedTagFilter && !selectedSessionName && canEditWorkspace ? (
                          <Stack spacing={2} sx={{ py: 2 }}>
                            <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                              No notes yet in this campaign. Create the first one to start using the workspace.
                            </Alert>
                            <Button
                              variant="contained"
                              startIcon={<AddRoundedIcon />}
                              onClick={onNewNote}
                              sx={{ alignSelf: 'flex-start' }}
                            >
                              New note
                            </Button>
                          </Stack>
                        ) : (
                          <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                            {noteBrowseMode === 'notes' && selectedTagFilter
                              ? `No notes tagged ${selectedTagFilter} yet. Clear the filter or add that tag to a note to reuse it later.`
                              : noteBrowseMode === 'sessions' && selectedSessionName
                              ? 'No notes remain in this session. Head back to the session list or save a note with the same session name.'
                              : canEditWorkspace
                              ? 'No notes yet in this campaign. Create the first one to start using the workspace.'
                              : 'No notes yet in this campaign.'}
                          </Alert>
                        )
                      ) : (
                        <List
                          disablePadding
                          aria-label={
                            noteBrowseMode === 'sessions' && selectedSessionName
                              ? 'Session notes'
                              : 'Notes list'
                          }
                          sx={{ display: 'grid', gap: 1.5 }}
                        >
                          {displayedNotes.map((note) => (
                            <ListItemButton
                              key={note.id}
                              selected={selectedNoteId === note.id && !isCreating}
                              onClick={() => onSelectNote(note)}
                              sx={{
                                borderRadius: noteItemRadius,
                                border: '1px solid',
                                borderColor:
                                  selectedNoteId === note.id && !isCreating
                                    ? 'primary.main'
                                    : 'divider',
                                alignItems: 'flex-start',
                              }}
                            >
                              <ListItemText
                                disableTypography
                                primary={
                                  <Stack
                                    direction="row"
                                    spacing={1.5}
                                    sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
                                  >
                                    <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
                                      <Typography
                                        variant="subtitle1"
                                        title={note.title}
                                        sx={singleLineTextSx}
                                      >
                                        {note.title}
                                      </Typography>
                                      <Typography
                                        color="text.secondary"
                                        variant="body2"
                                        title={excerpt(note.body)}
                                        sx={singleLineTextSx}
                                      >
                                        {excerpt(note.body)}
                                      </Typography>
                                      <Typography
                                        color="text.secondary"
                                        variant="caption"
                                        title={formatSessionLine(note.sessionName)}
                                        sx={singleLineTextSx}
                                      >
                                        {formatSessionLine(note.sessionName)}
                                      </Typography>
                                    </Stack>
                                    <Stack spacing={0.75} sx={{ alignItems: 'flex-end', flexShrink: 0 }}>
                                      <Chip
                                        label={note.status}
                                        color={
                                          note.status === 'active'
                                            ? 'secondary'
                                            : note.status === 'archived'
                                              ? 'default'
                                              : 'primary'
                                        }
                                        size="small"
                                      />
                                      <Typography color="text.secondary" variant="caption">
                                        Updated {formatTimestamp(note.updatedAt)}
                                      </Typography>
                                    </Stack>
                                  </Stack>
                                }
                              />
                            </ListItemButton>
                          ))}
                        </List>
                      )}
                    </Stack>
                )}
              </NotesBrowsePane>
            ) : null}

            {showEditorPane ? (
              <NoteEditPage
                surfaceRadius={surfaceRadius}
                isSinglePaneNoteWorkspace={!showSplitNoteWorkspace}
                canEditWorkspace={canEditWorkspace}
                isCreating={isCreating}
                noteBrowseMode={noteBrowseMode}
                selectedSessionName={selectedSessionName}
                campaignName={resolvedCampaign?.name ?? overview.campaign.name}
                selectedNoteTemplateId={selectedNoteTemplateId}
                selectedNoteTemplate={selectedNoteTemplate}
                draft={draft}
                tagFacets={tagFacets}
                draftTags={draftTags}
                tagInputValue={tagInputValue}
                noteLinkOptions={noteLinkOptions}
                isSaving={isSaving}
                isDeleting={isDeleting}
                selectedNote={selectedNote}
                linkedNotes={linkedNotes}
                backlinks={backlinks}
                onBack={onShowBrowsePanel}
                onSelectNoteTemplate={onSelectNoteTemplate}
                onDraftChange={onDraftChange}
                onTagInputChange={onTagInputChange}
                onDraftTagsChange={onDraftTagsChange}
                onCommitPendingTagInput={onCommitPendingTagInput}
                onSave={onSaveNote}
                onDelete={onDeleteNote}
                onSelectNote={onSelectNote}
                onExcerpt={excerpt}
              />
            ) : null}

            <Box
              aria-label="Application brand"
              sx={{
                display: { xs: 'inline-flex', lg: 'none' },
                alignItems: 'center',
                alignSelf: 'center',
                gap: 0.75,
                px: 1.25,
                py: 0.75,
                borderRadius: '999px',
                border: '1px solid',
                borderColor: 'rgba(167, 139, 250, 0.2)',
                bgcolor: 'rgba(15, 23, 42, 0.72)',
                color: 'rgba(255, 255, 255, 0.78)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 12px 30px rgba(2, 6, 23, 0.24)',
                maxWidth: 'calc(100vw - 24px)',
              }}
            >
              <DndNotesMark fontSize="small" />
              <Typography
                variant="caption"
                sx={{
                  ...singleLineTextSx,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                D&amp;D Notes
              </Typography>
            </Box>
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}
