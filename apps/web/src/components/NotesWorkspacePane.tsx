import AddRoundedIcon from '@mui/icons-material/AddRounded'
import BoltRoundedIcon from '@mui/icons-material/BoltRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'
import PlaylistAddCheckCircleRoundedIcon from '@mui/icons-material/PlaylistAddCheckCircleRounded'
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { cardBorderColor, cardBorderColorHover } from '@dnd-notes/theme'
import { useMemo } from 'react'
import { formatTimestamp } from '../formatTimestamp'
import { markdownToPlainText } from '../note-excerpts'
import NotesBrowsePane from '../NotesBrowsePane'
import WorkspacePane from '../WorkspacePane'
import NoteEditPage from '../pages/NoteEditPage'
import type { NoteBrowseMode, NoteDraft, NoteLinkPanelItem, TagFacet } from '../hooks/useNotes'
import type {
  ActivityCollaborator,
  Note,
  NoteActivityEntry,
  NotesOverview,
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

export interface NotesWorkspacePaneProps {
  // Mode
  isSharedMode: boolean
  canEditWorkspace: boolean
  showSplitNoteWorkspace: boolean
  canSplitNoteWorkspace: boolean
  showBrowsePane: boolean
  showEditorPane: boolean
  workspaceEditorLabel: string

  // Campaign context
  resolvedCampaignName: string

  // Overview (for stats)
  overview: NotesOverview

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

  // Handlers — workspace view
  onShowBrowsePane: () => void
  onShowEditorPane: () => void
  onToggleSplitWorkspace: () => void

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
  onToggleQuickCapture: () => void
  onQuickCaptureValueChange: (value: string) => void
  onQuickCaptureSubmit: () => void
  onShowBrowsePanel: () => void
  onNewNote: () => void

  // Handlers — note edit
  onSelectNoteTemplate: (templateId: string) => void
  onDraftChange: <Field extends keyof NoteDraft>(field: Field, value: NoteDraft[Field]) => void
  onTagInputChange: (value: string) => void
  onDraftTagsChange: (tags: readonly string[]) => void
  onCommitPendingTagInput: () => void
  onSaveNote: () => void
  onDeleteNote: () => void
}

export default function NotesWorkspacePane({
  isSharedMode,
  canEditWorkspace,
  showSplitNoteWorkspace,
  canSplitNoteWorkspace,
  showBrowsePane,
  showEditorPane,
  workspaceEditorLabel,
  resolvedCampaignName,
  overview,
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
  onShowBrowsePane,
  onShowEditorPane,
  onToggleSplitWorkspace,
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
  onToggleQuickCapture,
  onQuickCaptureValueChange,
  onQuickCaptureSubmit,
  onShowBrowsePanel,
  onNewNote,
  onSelectNoteTemplate,
  onDraftChange,
  onTagInputChange,
  onDraftTagsChange,
  onCommitPendingTagInput,
  onSaveNote,
  onDeleteNote,
}: NotesWorkspacePaneProps) {
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

  const defaultNotesPaneDescription =
    'The note workflow now runs inside the selected campaign.'

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
                } tagged ${selectedTagFacet.tag} in ${resolvedCampaignName}.`
              : defaultNotesPaneDescription

  return (
    <>
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
                bgcolor: 'var(--bg-paper-strong)',
                border: '1px solid',
                borderColor: 'var(--brand-line-soft)',
                boxShadow: 'var(--shadow-lg)',
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
                  bgcolor: 'var(--brand-tint)',
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
                                ? cardBorderColorHover
                                : cardBorderColor,
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
                          borderColor: cardBorderColor,
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
                                ? cardBorderColorHover
                                : cardBorderColor,
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
            campaignName={resolvedCampaignName}
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
      </Box>
    </>
  )
}
