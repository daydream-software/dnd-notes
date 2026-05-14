import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import NoteBodyEditor from '../NoteBodyEditor'
import NoteEditorActions from '../NoteEditorActions'
import { NoteBodyPreview } from '../note-formatting'
import { noteStarterTemplates, type NoteStarterTemplate } from '../templates'
import type { Note, NoteStatus } from '../types'
import { noteStatuses } from '../types'
import type {
  NoteBrowseMode,
  NoteDraft,
  NoteLinkPanelItem,
  TagFacet,
} from '../hooks/useNotes'
import {
  createTagsText,
  formatResolvedRelationshipText,
  getNoteDisplayTitle,
} from '../hooks/useNotes'

export interface NoteEditPageProps {
  surfaceRadius: string
  isSinglePaneNoteWorkspace: boolean
  canEditWorkspace: boolean
  isCreating: boolean
  noteBrowseMode: NoteBrowseMode
  selectedSessionName: string | null
  campaignName: string
  selectedNoteTemplateId: string
  selectedNoteTemplate: NoteStarterTemplate
  draft: NoteDraft
  tagFacets: TagFacet[]
  draftTags: string[]
  tagInputValue: string
  noteLinkOptions: { id: string; title: string }[]
  isSaving: boolean
  isDeleting: boolean
  selectedNote: Note | null
  linkedNotes: NoteLinkPanelItem[]
  backlinks: NoteLinkPanelItem[]
  onBack: () => void
  onSelectNoteTemplate: (templateId: string) => void
  onDraftChange: <Field extends keyof NoteDraft>(
    field: Field,
    value: NoteDraft[Field],
  ) => void
  onTagInputChange: (value: string) => void
  onDraftTagsChange: (tags: readonly string[]) => void
  onCommitPendingTagInput: () => void
  onSave: () => void
  onDelete: () => void
  onSelectNote: (note: Note) => void
  onExcerpt: (body: string) => string
}

export default function NoteEditPage({
  surfaceRadius,
  isSinglePaneNoteWorkspace,
  canEditWorkspace,
  isCreating,
  noteBrowseMode,
  selectedSessionName,
  campaignName,
  selectedNoteTemplateId,
  selectedNoteTemplate,
  draft,
  tagFacets,
  draftTags,
  tagInputValue,
  noteLinkOptions,
  isSaving,
  isDeleting,
  selectedNote,
  linkedNotes,
  backlinks,
  onBack,
  onSelectNoteTemplate,
  onDraftChange,
  onTagInputChange,
  onDraftTagsChange,
  onCommitPendingTagInput,
  onSave,
  onDelete,
  onSelectNote,
  onExcerpt,
}: NoteEditPageProps) {
  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <Card sx={{ borderRadius: surfaceRadius, minWidth: 0, width: '100%', maxWidth: '100%' }}>
        <CardContent sx={{ p: 3, minWidth: 0 }}>
          <Stack spacing={2.5} sx={{ minWidth: 0 }}>
            {isSinglePaneNoteWorkspace ? (
              <Button
                variant="text"
                size="small"
                startIcon={<ArrowBackRoundedIcon />}
                onClick={onBack}
                sx={{ alignSelf: 'flex-start' }}
              >
                Browse notes
              </Button>
            ) : null}

            <Box>
              <Typography variant="h5">
                {!canEditWorkspace
                  ? 'Note details'
                  : isCreating
                    ? 'Create note'
                    : 'Edit note'}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                {!canEditWorkspace
                  ? 'Viewer links can read shared notes but cannot change them.'
                  : noteBrowseMode === 'sessions' && selectedSessionName
                    ? `Every save is scoped to ${campaignName}. You are currently reviewing ${selectedSessionName}.`
                    : `Every save is scoped to ${campaignName}, so each campaign can keep its own note trail.`}
              </Typography>
            </Box>

            {isCreating && canEditWorkspace ? (
              <Stack spacing={1.5}>
                <TextField
                  select
                  label="Note template"
                  value={selectedNoteTemplateId}
                  onChange={(event) => onSelectNoteTemplate(event.target.value)}
                  helperText="Optional. Load a starter structure, then edit anything you want."
                >
                  {noteStarterTemplates.map((template) => (
                    <MenuItem key={template.id} value={template.id}>
                      {template.name}
                    </MenuItem>
                  ))}
                </TextField>

                {selectedNoteTemplate.starterNote ? (
                  <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                    {selectedNoteTemplate.description}
                  </Alert>
                ) : null}
              </Stack>
            ) : null}

            <TextField
              label="Title"
              value={draft.title}
              onChange={(event) => onDraftChange('title', event.target.value)}
              slotProps={{ input: { readOnly: !canEditWorkspace } }}
            />

            <TextField
              label="Session name"
              value={draft.sessionName}
              onChange={(event) => onDraftChange('sessionName', event.target.value)}
              helperText="Optional. Use this when a note belongs to a specific session."
              slotProps={{ input: { readOnly: !canEditWorkspace } }}
            />

            {canEditWorkspace ? (
              <Autocomplete
                multiple
                freeSolo
                disablePortal
                filterSelectedOptions
                options={tagFacets.map((tagFacet) => tagFacet.tag)}
                value={draftTags}
                inputValue={tagInputValue}
                onInputChange={(_, value, reason) => {
                  if (reason === 'reset') {
                    return
                  }

                  onTagInputChange(value)
                }}
                onChange={(_, value) => {
                  onDraftTagsChange(value)
                  onTagInputChange('')
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Tags"
                    helperText="Reuse existing tags or type new ones. Press Enter, comma, or blur to commit."
                    onBlur={onCommitPendingTagInput}
                    onKeyDown={(event) => {
                      if (
                        (event.key === 'Enter' || event.key === ',') &&
                        tagInputValue.trim()
                      ) {
                        event.preventDefault()
                        onCommitPendingTagInput()
                      }
                    }}
                  />
                )}
              />
            ) : (
              <TextField
                label="Tags"
                value={createTagsText(draftTags)}
                slotProps={{ input: { readOnly: true } }}
              />
            )}

            <TextField
              select
              label="Status"
              value={draft.status}
              onChange={(event) =>
                onDraftChange('status', event.target.value as NoteStatus)
              }
              disabled={!canEditWorkspace}
            >
              {noteStatuses.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </TextField>

            {canEditWorkspace ? (
              <NoteBodyEditor
                body={draft.body}
                onChange={(value) => onDraftChange('body', value)}
                surfaceRadius={surfaceRadius}
                noteOptions={noteLinkOptions}
              />
            ) : (
              <Stack spacing={1}>
                <Typography variant="subtitle1">Body</Typography>
                <Box
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: surfaceRadius,
                    p: { xs: 2, sm: 2.5 },
                  }}
                >
                  <NoteBodyPreview
                    ariaLabel="Note body preview"
                    body={draft.body}
                    emptyMessage="Nothing to preview yet."
                  />
                </Box>
              </Stack>
            )}

            <NoteEditorActions
              canEditWorkspace={canEditWorkspace}
              isCreating={isCreating}
              isSaving={isSaving}
              isDeleting={isDeleting}
              selectedNoteUpdatedAt={selectedNote?.updatedAt}
              onSave={onSave}
              onDelete={onDelete}
            />
          </Stack>
        </CardContent>
      </Card>

      {!isCreating && (linkedNotes.length > 0 || backlinks.length > 0) ? (
        <Card sx={{ borderRadius: surfaceRadius }}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2}>
              {linkedNotes.length > 0 ? (
                <Box>
                  <Typography variant="h6" sx={{ mb: 1 }}>
                    Linked notes ({linkedNotes.length})
                  </Typography>
                  <Stack spacing={1}>
                    {linkedNotes.map(({ note, qualifiers }) => (
                      <Card
                        key={note.id}
                        variant="outlined"
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { borderColor: 'primary.main' },
                        }}
                        onClick={() => onSelectNote(note)}
                      >
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Typography variant="body1">{getNoteDisplayTitle(note)}</Typography>
                          {selectedNote &&
                          formatResolvedRelationshipText(
                            getNoteDisplayTitle(selectedNote),
                            qualifiers,
                            getNoteDisplayTitle(note),
                          ) ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block', mb: 0.5 }}
                            >
                              {formatResolvedRelationshipText(
                                getNoteDisplayTitle(selectedNote),
                                qualifiers,
                                getNoteDisplayTitle(note),
                              )}
                            </Typography>
                          ) : null}
                          <Typography variant="body2" color="text.secondary">
                            {onExcerpt(note.body)}
                          </Typography>
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                </Box>
              ) : null}

              {backlinks.length > 0 ? (
                <Box>
                  <Typography variant="h6" sx={{ mb: 1 }}>
                    Referenced by ({backlinks.length})
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    These notes link to this one.
                  </Typography>
                  <Stack spacing={1}>
                    {backlinks.map(({ note, qualifiers }) => (
                      <Card
                        key={note.id}
                        variant="outlined"
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { borderColor: 'primary.main' },
                        }}
                        onClick={() => onSelectNote(note)}
                      >
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Typography variant="body1">{getNoteDisplayTitle(note)}</Typography>
                          {selectedNote &&
                          formatResolvedRelationshipText(
                            getNoteDisplayTitle(note),
                            qualifiers,
                            getNoteDisplayTitle(selectedNote),
                          ) ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block', mb: 0.5 }}
                            >
                              {formatResolvedRelationshipText(
                                getNoteDisplayTitle(note),
                                qualifiers,
                                getNoteDisplayTitle(selectedNote),
                              )}
                            </Typography>
                          ) : null}
                          <Typography variant="body2" color="text.secondary">
                            {onExcerpt(note.body)}
                          </Typography>
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  )
}
