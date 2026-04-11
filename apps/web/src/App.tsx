import AddRoundedIcon from '@mui/icons-material/AddRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'
import PlaylistAddCheckCircleRoundedIcon from '@mui/icons-material/PlaylistAddCheckCircleRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createNote,
  deleteNote,
  fetchNotes,
  fetchOverview,
  updateNote,
} from './api'
import type { Note, NoteInput, NoteStatus, NotesOverview } from './types'
import { noteStatuses } from './types'

interface NoteDraft {
  title: string
  body: string
  tagsText: string
  status: NoteStatus
  sessionName: string
}

function createEmptyDraft(): NoteDraft {
  return {
    title: '',
    body: '',
    tagsText: '',
    status: 'draft',
    sessionName: '',
  }
}

function createDraftFromNote(note: Note): NoteDraft {
  return {
    title: note.title,
    body: note.body,
    tagsText: note.tags.join(', '),
    status: note.status,
    sessionName: note.sessionName ?? '',
  }
}

function createNotePayload(draft: NoteDraft): NoteInput {
  return {
    title: draft.title,
    body: draft.body,
    status: draft.status,
    tags: draft.tagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    sessionName: draft.sessionName.trim() || null,
  }
}

function formatSessionDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(date)
}

function formatTimestamp(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function excerpt(body: string) {
  if (body.length <= 112) {
    return body
  }

  return `${body.slice(0, 109)}...`
}

function App() {
  const [overview, setOverview] = useState<NotesOverview | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState<NoteDraft>(createEmptyDraft)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedNoteIdRef = useRef<string | null>(null)

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId
  }, [selectedNoteId])

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  )

  const loadWorkspace = useCallback(async (preferredNoteId?: string | null) => {
    try {
      const [nextOverview, notesResponse] = await Promise.all([
        fetchOverview(),
        fetchNotes(),
      ])

      setOverview(nextOverview)
      setNotes(notesResponse.notes)

      const fallbackNoteId = notesResponse.notes[0]?.id ?? null
      const currentSelection = selectedNoteIdRef.current
      const nextSelectedId =
        preferredNoteId !== undefined
          ? preferredNoteId
          : currentSelection &&
              notesResponse.notes.some((note) => note.id === currentSelection)
            ? currentSelection
            : fallbackNoteId

      const activeNote =
        nextSelectedId !== null
          ? notesResponse.notes.find((note) => note.id === nextSelectedId) ?? null
          : null

      if (activeNote) {
        setSelectedNoteId(activeNote.id)
        setIsCreating(false)
        setDraft(createDraftFromNote(activeNote))
      } else {
        setSelectedNoteId(null)
        setIsCreating(true)
        setDraft(createEmptyDraft())
      }

      setError(null)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load the notes workspace.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const statCards = useMemo(() => {
    if (!overview) {
      return []
    }

    return [
      {
        label: 'Total notes',
        value: overview.stats.totalNotes,
        detail: 'The current note count for the single-campaign MVP.',
        icon: <StickyNote2RoundedIcon color="primary" />,
      },
      {
        label: 'Draft notes',
        value: overview.stats.draftNotes,
        detail: 'Ideas and prep work that still need refinement.',
        icon: <EditNoteRoundedIcon color="primary" />,
      },
      {
        label: 'Active notes',
        value: overview.stats.activeNotes,
        detail: 'Notes ready to use during or between sessions.',
        icon: <PlaylistAddCheckCircleRoundedIcon color="primary" />,
      },
      {
        label: 'Session-linked notes',
        value: overview.stats.sessionLinkedNotes,
        detail: 'Entries already tied back to a named session.',
        icon: <EventRoundedIcon color="primary" />,
      },
    ]
  }, [overview])

  const handleDraftChange = <Field extends keyof NoteDraft>(
    field: Field,
    value: NoteDraft[Field],
  ) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
  }

  const handleSelectNote = (note: Note) => {
    setSelectedNoteId(note.id)
    setIsCreating(false)
    setDraft(createDraftFromNote(note))
    setError(null)
  }

  const handleStartNote = () => {
    setSelectedNoteId(null)
    setIsCreating(true)
    setDraft(createEmptyDraft())
    setError(null)
  }

  const handleSaveNote = async () => {
    setError(null)
    setIsSaving(true)

    try {
      const payload = createNotePayload(draft)

      if (isCreating || !selectedNoteId) {
        const createdNote = await createNote(payload)
        await loadWorkspace(createdNote.id)
      } else {
        const updatedNote = await updateNote(selectedNoteId, payload)
        await loadWorkspace(updatedNote.id)
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Could not save the note.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteNote = async () => {
    if (!selectedNoteId) {
      return
    }

    setError(null)
    setIsDeleting(true)

    try {
      await deleteNote(selectedNoteId)
      await loadWorkspace(null)
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete the note.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoading || !overview) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress />
          <Typography color="text.secondary">Loading notes workspace...</Typography>
        </Stack>
      </Box>
    )
  }

  return (
    <Box component="main" sx={{ minHeight: '100vh', py: { xs: 4, md: 6 } }}>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Card
            sx={{
              borderRadius: 6,
              background:
                'linear-gradient(140deg, rgba(124, 58, 237, 0.9), rgba(30, 41, 59, 0.96))',
            }}
          >
            <CardContent sx={{ p: { xs: 3, md: 4 } }}>
              <Stack spacing={3}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Box sx={{ maxWidth: 760 }}>
                    <Typography
                      variant="overline"
                      sx={{ color: 'rgba(255, 255, 255, 0.72)', letterSpacing: '0.18em' }}
                    >
                      Notes MVP
                    </Typography>
                    <Typography
                      variant="h2"
                      sx={{ mt: 1, fontSize: { xs: '2.3rem', md: '3.4rem' } }}
                    >
                      {overview.campaign.name}
                    </Typography>
                    <Typography sx={{ mt: 2, maxWidth: 620, color: 'rgba(255, 255, 255, 0.78)' }}>
                      {overview.campaign.tagline}
                    </Typography>
                    <Typography sx={{ mt: 2, color: 'rgba(255, 255, 255, 0.65)' }}>
                      One campaign, one note type, local-only persistence, and a real
                      create-edit-delete workflow.
                    </Typography>
                  </Box>

                  <Stack
                    spacing={1.5}
                    sx={{
                      minWidth: { md: 260 },
                      borderRadius: 4,
                      p: 2.5,
                      bgcolor: 'rgba(15, 23, 42, 0.36)',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <EventRoundedIcon color="inherit" />
                      <Typography sx={{ fontWeight: 700 }}>Next session</Typography>
                    </Stack>
                    <Typography variant="h6">
                      {overview.campaign.nextSession
                        ? formatSessionDate(overview.campaign.nextSession)
                        : 'Not scheduled'}
                    </Typography>
                    <Typography color="rgba(255, 255, 255, 0.72)">
                      {overview.campaign.setting} • {overview.campaign.system}
                    </Typography>
                    <Button
                      variant="contained"
                      color="secondary"
                      startIcon={<AddRoundedIcon />}
                      onClick={handleStartNote}
                      sx={{ mt: 1, alignSelf: 'flex-start' }}
                    >
                      New note
                    </Button>
                  </Stack>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {error ? (
            <Alert severity="error" sx={{ borderRadius: 4 }}>
              {error}
            </Alert>
          ) : null}

          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                xl: 'repeat(4, minmax(0, 1fr))',
              },
            }}
          >
            {statCards.map((card) => (
              <Card key={card.label} sx={{ borderRadius: 5 }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={1.5}>
                    {card.icon}
                    <Typography color="text.secondary" variant="body2">
                      {card.label}
                    </Typography>
                    <Typography variant="h3">{card.value}</Typography>
                    <Typography color="text.secondary">{card.detail}</Typography>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', lg: '1.2fr 1fr' },
            }}
          >
            <Card sx={{ borderRadius: 5 }}>
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={3}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    sx={{ justifyContent: 'space-between' }}
                  >
                    <Box>
                      <Typography variant="h5">Notes</Typography>
                      <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                        This is the working note list backed by the real API and SQLite
                        persistence.
                      </Typography>
                    </Box>
                    <Button
                      variant="outlined"
                      startIcon={<AddRoundedIcon />}
                      onClick={handleStartNote}
                    >
                      New note
                    </Button>
                  </Stack>

                  {notes.length === 0 ? (
                    <Alert severity="info" sx={{ borderRadius: 4 }}>
                      No notes yet. Create the first one to start using the MVP.
                    </Alert>
                  ) : (
                    <List disablePadding sx={{ display: 'grid', gap: 1.5 }}>
                      {notes.map((note) => (
                        <ListItemButton
                          key={note.id}
                          selected={selectedNoteId === note.id && !isCreating}
                          onClick={() => handleSelectNote(note)}
                          sx={{
                            borderRadius: 3,
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
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={1}
                                sx={{ justifyContent: 'space-between' }}
                              >
                                <Typography variant="h6">{note.title}</Typography>
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
                              </Stack>
                            }
                            secondary={
                              <Stack spacing={1.25} sx={{ mt: 1.25 }}>
                                <Typography color="text.secondary">
                                  {excerpt(note.body)}
                                </Typography>
                                <Typography color="text.secondary" variant="body2">
                                  {note.sessionName ? `${note.sessionName} • ` : ''}
                                  Updated {formatTimestamp(note.updatedAt)}
                                </Typography>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  useFlexGap
                                  sx={{ flexWrap: 'wrap' }}
                                >
                                  {note.tags.map((tag) => (
                                    <Chip key={tag} label={tag} size="small" />
                                  ))}
                                </Stack>
                              </Stack>
                            }
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  )}
                </Stack>
              </CardContent>
            </Card>

            <Stack spacing={3}>
              <Card sx={{ borderRadius: 5 }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={2.5}>
                    <Box>
                      <Typography variant="h5">
                        {isCreating ? 'Create note' : 'Edit note'}
                      </Typography>
                      <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                        The MVP note contract is title, body, tags, status, and an
                        optional session name.
                      </Typography>
                    </Box>

                    <TextField
                      label="Title"
                      value={draft.title}
                      onChange={(event) =>
                        handleDraftChange('title', event.target.value)
                      }
                    />

                    <TextField
                      label="Session name"
                      value={draft.sessionName}
                      onChange={(event) =>
                        handleDraftChange('sessionName', event.target.value)
                      }
                      helperText="Optional. Use this when a note belongs to a specific session."
                    />

                    <TextField
                      label="Tags"
                      value={draft.tagsText}
                      onChange={(event) =>
                        handleDraftChange('tagsText', event.target.value)
                      }
                      helperText="Comma-separated tags such as clue, faction, or travel."
                    />

                    <TextField
                      select
                      label="Status"
                      value={draft.status}
                      onChange={(event) =>
                        handleDraftChange('status', event.target.value as NoteStatus)
                      }
                    >
                      {noteStatuses.map((status) => (
                        <MenuItem key={status} value={status}>
                          {status}
                        </MenuItem>
                      ))}
                    </TextField>

                    <TextField
                      label="Body"
                      multiline
                      minRows={12}
                      value={draft.body}
                      onChange={(event) =>
                        handleDraftChange('body', event.target.value)
                      }
                    />

                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.5}
                      sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                    >
                      <Typography color="text.secondary" variant="body2">
                        {selectedNote && !isCreating
                          ? `Last updated ${formatTimestamp(selectedNote.updatedAt)}`
                          : 'New notes are saved straight to local SQLite storage.'}
                      </Typography>

                      <Stack direction="row" spacing={1}>
                        {!isCreating && selectedNote ? (
                          <Button
                            color="error"
                            variant="outlined"
                            onClick={handleDeleteNote}
                            disabled={isSaving || isDeleting}
                          >
                            {isDeleting ? 'Deleting...' : 'Delete note'}
                          </Button>
                        ) : null}
                        <Button
                          variant="contained"
                          startIcon={<SaveRoundedIcon />}
                          onClick={handleSaveNote}
                          disabled={isSaving || isDeleting}
                        >
                          {isSaving ? 'Saving...' : 'Save note'}
                        </Button>
                      </Stack>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>

              <Card sx={{ borderRadius: 5 }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={2}>
                    <Typography variant="h5">Recent activity</Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      The API contract is now stable enough for real CRUD work and test
                      coverage.
                    </Typography>
                    {overview.recentNotes.length === 0 ? (
                      <Typography color="text.secondary">
                        Once you save notes, the most recently updated ones show up here.
                      </Typography>
                    ) : (
                      overview.recentNotes.map((note) => (
                        <Stack key={note.id} spacing={0.75}>
                          <Typography variant="subtitle1">{note.title}</Typography>
                          <Typography color="text.secondary" variant="body2">
                            Updated {formatTimestamp(note.updatedAt)}
                          </Typography>
                        </Stack>
                      ))
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}

export default App
