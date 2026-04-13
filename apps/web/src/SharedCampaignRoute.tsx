import AddRoundedIcon from '@mui/icons-material/AddRounded'
import BoltRoundedIcon from '@mui/icons-material/BoltRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
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
  claimSharedMembership,
  createSharedNote,
  deleteSharedNote,
  fetchSharedNotes,
  fetchSharedOverview,
  fetchSharedSession,
  joinSharedCampaign,
  loginOwner,
  logoutOwner,
  registerOwner,
  updateSharedNote,
} from './api'
import { NoteBodyPreview } from './note-formatting'
import type {
  CampaignMembership,
  CampaignSummary,
  CampaignShareLink,
  GuestJoinInput,
  Note,
  NoteInput,
  NoteStatus,
  NotesOverview,
} from './types'
import { noteStatuses } from './types'

interface SharedCampaignRouteProps {
  shareToken: string
}

interface NoteDraft {
  title: string
  body: string
  tagsText: string
  status: NoteStatus
  sessionName: string
}

interface OwnerRegistrationDraft {
  displayName: string
  email: string
  password: string
}

interface OwnerLoginDraft {
  email: string
  password: string
}

const authTokenStorageKey = 'dnd-notes:owner-auth-token'
const selectedCampaignStorageKey = 'dnd-notes:selected-campaign-id'
const guestTokenStoragePrefix = 'dnd-notes:guest-token:'
const heroCardRadius = '32px'
const surfaceRadius = '24px'
const noteItemRadius = '20px'
const statPillRadius = '999px'

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

function SharedCampaignRoute({ shareToken }: SharedCampaignRouteProps) {
  const guestStorageKey = `${guestTokenStoragePrefix}${shareToken}`
  const [shareLink, setShareLink] = useState<CampaignShareLink | null>(null)
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null)
  const [membership, setMembership] = useState<CampaignMembership | null>(null)
  const [guestToken, setGuestToken] = useState<string | null>(null)
  const [joinDraft, setJoinDraft] = useState<GuestJoinInput>({ displayName: '' })
  const [registerDraft, setRegisterDraft] = useState<OwnerRegistrationDraft>({
    displayName: '',
    email: '',
    password: '',
  })
  const [loginDraft, setLoginDraft] = useState<OwnerLoginDraft>({
    email: '',
    password: '',
  })
  const [overview, setOverview] = useState<NotesOverview | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState<NoteDraft>(createEmptyDraft)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isLoadingSession, setIsLoadingSession] = useState(true)
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [isLinkingAccount, setIsLinkingAccount] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRegisterMode, setIsRegisterMode] = useState(true)
  const [accountNotice, setAccountNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quickCaptureTitle, setQuickCaptureTitle] = useState('')
  const [isQuickCapturing, setIsQuickCapturing] = useState(false)
  const selectedNoteIdRef = useRef<string | null>(null)
  const shareLinkRef = useRef<CampaignShareLink | null>(null)
  const sessionRequestIdRef = useRef(0)
  const workspaceRequestIdRef = useRef(0)

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId
  }, [selectedNoteId])

  useEffect(() => {
    shareLinkRef.current = shareLink
  }, [shareLink])

  const canEdit = shareLink?.accessLevel === 'editor'

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  )

  const statCards = useMemo(() => {
    if (!overview) {
      return []
    }

    return [
      { label: 'Total notes', value: overview.stats.totalNotes },
      { label: 'Draft notes', value: overview.stats.draftNotes },
      { label: 'Active notes', value: overview.stats.activeNotes },
      { label: 'Session-linked notes', value: overview.stats.sessionLinkedNotes },
    ]
  }, [overview])

  const loadWorkspace = useCallback(
    async (
      activeGuestToken: string,
      preferredNoteId?: string | null,
      accessLevel?: CampaignShareLink['accessLevel'],
    ) => {
      const requestId = ++workspaceRequestIdRef.current
      setIsLoadingWorkspace(true)

      try {
        const [nextOverview, notesResponse] = await Promise.all([
          fetchSharedOverview(shareToken, activeGuestToken),
          fetchSharedNotes(shareToken, activeGuestToken),
        ])

        if (requestId !== workspaceRequestIdRef.current) {
          return
        }

        setOverview(nextOverview)
        setCampaign(nextOverview.campaign)
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
          setIsCreating((accessLevel ?? shareLinkRef.current?.accessLevel) === 'editor')
          setDraft(createEmptyDraft())
        }

        setError(null)
      } catch (loadError) {
        if (requestId !== workspaceRequestIdRef.current) {
          return
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load the shared campaign workspace.',
        )
      } finally {
        if (requestId === workspaceRequestIdRef.current) {
          setIsLoadingWorkspace(false)
        }
      }
    },
    [shareToken],
  )

  useEffect(() => {
    let cancelled = false
    const requestId = ++sessionRequestIdRef.current

    const bootstrap = async () => {
      const storedGuestToken = localStorage.getItem(guestStorageKey)

      try {
        const session = await fetchSharedSession(shareToken, storedGuestToken)

        if (cancelled) {
          return
        }

        if (requestId !== sessionRequestIdRef.current) {
          return
        }

        setCampaign(session.campaign)
        setShareLink(session.shareLink)
        setMembership(session.membership)
        setError(null)

        if (session.membership && storedGuestToken) {
          setRegisterDraft((currentDraft) =>
            currentDraft.displayName.trim().length > 0
              ? currentDraft
              : {
                  ...currentDraft,
                  displayName: session.membership?.displayName ?? '',
                },
          )
          setGuestToken(storedGuestToken)
          await loadWorkspace(storedGuestToken, undefined, session.shareLink.accessLevel)
        } else {
          localStorage.removeItem(guestStorageKey)
          setGuestToken(null)
          setAccountNotice(null)
          setOverview(null)
          setNotes([])
          setSelectedNoteId(null)
          setIsCreating(false)
          setDraft(createEmptyDraft())
        }
      } catch (sessionError) {
        if (!cancelled && requestId === sessionRequestIdRef.current) {
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : 'Could not load the shared campaign.',
          )
        }
      } finally {
        if (!cancelled && requestId === sessionRequestIdRef.current) {
          setIsLoadingSession(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [guestStorageKey, loadWorkspace, shareToken])

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
    if (!canEdit) {
      return
    }

    setSelectedNoteId(null)
    setIsCreating(true)
    setDraft(createEmptyDraft())
    setError(null)
  }

  const handleQuickCapture = async () => {
    const trimmedTitle = quickCaptureTitle.trim()

    if (!guestToken || !canEdit || !trimmedTitle) {
      return
    }

    setError(null)
    setIsQuickCapturing(true)

    try {
      const createdNote = await createSharedNote(shareToken, guestToken, {
        title: trimmedTitle,
      })

      setQuickCaptureTitle('')
      await loadWorkspace(guestToken, createdNote.id)
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : 'Could not capture the note.',
      )
    } finally {
      setIsQuickCapturing(false)
    }
  }

  const handleJoin = async () => {
    const requestId = ++sessionRequestIdRef.current
    setError(null)
    setAccountNotice(null)
    setIsJoining(true)

    try {
      const response = await joinSharedCampaign(shareToken, joinDraft)

      if (requestId !== sessionRequestIdRef.current) {
        return
      }

      localStorage.setItem(guestStorageKey, response.guestToken)
      setGuestToken(response.guestToken)
      setCampaign(response.campaign)
      setShareLink(response.shareLink)
      setMembership(response.membership)
      setRegisterDraft((currentDraft) =>
        currentDraft.displayName.trim().length > 0
          ? currentDraft
          : {
              ...currentDraft,
              displayName: response.membership.displayName,
            },
      )
      await loadWorkspace(response.guestToken, undefined, response.shareLink.accessLevel)
    } catch (joinError) {
      if (requestId === sessionRequestIdRef.current) {
        setError(
          joinError instanceof Error
            ? joinError.message
            : 'Could not join the shared campaign.',
        )
      }
    } finally {
      if (requestId === sessionRequestIdRef.current) {
        setIsJoining(false)
      }
    }
  }

  const handleLinkAccount = async () => {
    if (!guestToken || !membership) {
      return
    }

    setError(null)
    setAccountNotice(null)
    setIsLinkingAccount(true)

    try {
      const session = isRegisterMode
        ? await registerOwner(registerDraft)
        : await loginOwner(loginDraft)

      localStorage.setItem(authTokenStorageKey, session.token)

      const claimedMembership = await claimSharedMembership(
        shareToken,
        session.token,
        guestToken,
      )

      if (claimedMembership.guestToken) {
        localStorage.setItem(guestStorageKey, claimedMembership.guestToken)
        setGuestToken(claimedMembership.guestToken)
      }

      localStorage.setItem(
        selectedCampaignStorageKey,
        claimedMembership.membership.campaignId,
      )
      setMembership(claimedMembership.membership)
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

  const handleSignOut = async () => {
    const storedAuthToken = localStorage.getItem(authTokenStorageKey)

    if (storedAuthToken) {
      try {
        await logoutOwner(storedAuthToken)
      } catch {
        // Intentionally ignore logout failures because local sign-out should still work.
      }
    }

    localStorage.removeItem(authTokenStorageKey)
    localStorage.removeItem(selectedCampaignStorageKey)
    window.location.assign('/')
  }

  const handleSaveNote = async () => {
    if (!guestToken || !canEdit || !campaign) {
      return
    }

    setError(null)
    setIsSaving(true)

    try {
      const payload = createNotePayload(draft)

      if (isCreating || !selectedNoteId) {
        const createdNote = await createSharedNote(shareToken, guestToken, payload)
        await loadWorkspace(guestToken, createdNote.id)
      } else {
        const updatedNote = await updateSharedNote(
          shareToken,
          guestToken,
          selectedNoteId,
          payload,
        )
        await loadWorkspace(guestToken, updatedNote.id)
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Could not save the shared note.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteNote = async () => {
    if (!guestToken || !selectedNoteId || !canEdit) {
      return
    }

    setError(null)
    setIsDeleting(true)

    try {
      await deleteSharedNote(shareToken, guestToken, selectedNoteId)
      await loadWorkspace(guestToken, null)
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete the shared note.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoadingSession) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress />
          <Typography color="text.secondary">Loading shared campaign...</Typography>
        </Stack>
      </Box>
    )
  }

  if (!campaign || !shareLink) {
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

  if (!membership) {
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
                      Join {campaign.name}
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
                    onChange={(event) =>
                      setJoinDraft({ displayName: event.target.value })
                    }
                  />

                  <Button
                    variant="contained"
                    onClick={handleJoin}
                    disabled={isJoining}
                  >
                    {isJoining ? 'Joining campaign...' : 'Join campaign'}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </Box>
    )
  }

  if (isLoadingWorkspace || !overview) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress />
          <Typography color="text.secondary">Loading shared notes...</Typography>
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
              borderRadius: heroCardRadius,
              overflow: 'hidden',
              background:
                'linear-gradient(140deg, rgba(14, 116, 144, 0.9), rgba(15, 23, 42, 0.96))',
              border: '1px solid rgba(255, 255, 255, 0.08)',
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
                      Shared campaign workspace
                    </Typography>
                    <Typography
                      variant="h2"
                      sx={{ mt: 1, fontSize: { xs: '2.3rem', md: '3.4rem' } }}
                    >
                      {campaign.name}
                    </Typography>
                    <Typography sx={{ mt: 2, maxWidth: 620, color: 'rgba(255, 255, 255, 0.78)' }}>
                      {campaign.tagline}
                    </Typography>
                    <Typography sx={{ mt: 2, color: 'rgba(255, 255, 255, 0.65)' }}>
                      Joined as {membership.displayName}. This link is {canEdit ? 'editor' : 'viewer'} access.
                    </Typography>
                    <Chip
                      label={membership.userId !== null ? 'Linked collaborator' : 'Guest'}
                      size="small"
                      sx={{ mt: 2, bgcolor: 'rgba(255, 255, 255, 0.14)', color: 'white' }}
                    />
                  </Box>

                  <Stack
                    spacing={1.5}
                    sx={{
                      minWidth: { md: 300 },
                      borderRadius: surfaceRadius,
                      p: 2.5,
                      bgcolor: 'rgba(15, 23, 42, 0.36)',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    <Typography color="rgba(255, 255, 255, 0.72)">
                      {campaign.setting} • {campaign.system}
                    </Typography>
                    <Typography color="rgba(255, 255, 255, 0.72)">
                      {canEdit
                        ? 'Editors can create, update, and delete shared notes.'
                        : 'This shared link is view-only.'}
                    </Typography>
                    {canEdit ? (
                      <Button
                        variant="contained"
                        color="secondary"
                        startIcon={<AddRoundedIcon />}
                        onClick={handleStartNote}
                      >
                        New note
                      </Button>
                    ) : null}
                    {membership.userId !== null ? (
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <Button
                          variant="contained"
                          onClick={() => {
                            window.location.assign('/')
                          }}
                        >
                          Switch campaigns
                        </Button>
                        <Button
                          variant="text"
                          color="inherit"
                          onClick={handleSignOut}
                        >
                          Sign out
                        </Button>
                      </Stack>
                    ) : null}
                  </Stack>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {error ? (
            <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
              {error}
            </Alert>
          ) : null}

          {membership.userId === null ? (
            <Card sx={{ borderRadius: surfaceRadius }}>
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h5">Link this guest membership</Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      Create or connect a real account without changing the membership that
                      already owns your shared note history. For this first release, the claim
                      must happen from the same browser that joined the campaign.
                    </Typography>
                  </Box>

                  {accountNotice ? (
                    <Alert severity="success" sx={{ borderRadius: surfaceRadius }}>
                      {accountNotice}
                    </Alert>
                  ) : null}

                  {isRegisterMode ? (
                    <TextField
                      label="Account display name"
                      value={registerDraft.displayName}
                      onChange={(event) =>
                        setRegisterDraft((currentDraft) => ({
                          ...currentDraft,
                          displayName: event.target.value,
                        }))
                      }
                    />
                  ) : null}

                  <TextField
                    label="Email"
                    type="email"
                    value={isRegisterMode ? registerDraft.email : loginDraft.email}
                    onChange={(event) => {
                      const value = event.target.value

                      if (isRegisterMode) {
                        setRegisterDraft((currentDraft) => ({
                          ...currentDraft,
                          email: value,
                        }))
                      } else {
                        setLoginDraft((currentDraft) => ({
                          ...currentDraft,
                          email: value,
                        }))
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
                        setRegisterDraft((currentDraft) => ({
                          ...currentDraft,
                          password: value,
                        }))
                      } else {
                        setLoginDraft((currentDraft) => ({
                          ...currentDraft,
                          password: value,
                        }))
                      }
                    }}
                  />

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Button
                      variant="contained"
                      onClick={handleLinkAccount}
                      disabled={isLinkingAccount}
                    >
                      {isLinkingAccount
                        ? isRegisterMode
                          ? 'Creating and linking...'
                          : 'Linking account...'
                        : isRegisterMode
                          ? 'Create and link account'
                          : 'Sign in and link account'}
                    </Button>
                    <Button
                      variant="text"
                      onClick={() => {
                        setAccountNotice(null)
                        setError(null)
                        setIsRegisterMode((current) => !current)
                      }}
                    >
                      {isRegisterMode
                        ? 'Already have an account? Sign in'
                        : 'Need an account? Create one'}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ) : accountNotice ? (
            <Alert severity="success" sx={{ borderRadius: surfaceRadius }}>
              {accountNotice}
            </Alert>
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
                    borderColor: 'rgba(34, 211, 238, 0.18)',
                    boxShadow: '0 20px 40px rgba(15, 23, 42, 0.24)',
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography color="text.secondary" variant="body2" sx={{ lineHeight: 1.2 }}>
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
              gap: 3,
              gridTemplateColumns: { xs: '1fr', lg: '1.2fr 1fr' },
            }}
          >
            <Card sx={{ borderRadius: surfaceRadius }}>
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={3}>
                  <Box>
                    <Typography variant="h5">Notes</Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      Shared notes for {campaign.name} stay inside this link.
                    </Typography>
                  </Box>

                  {canEdit ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      component="form"
                      onSubmit={(event: React.FormEvent) => {
                        event.preventDefault()
                        handleQuickCapture()
                      }}
                    >
                      <TextField
                        label="Quick capture"
                        placeholder="Jot down a thought, clue, or reminder…"
                        size="small"
                        value={quickCaptureTitle}
                        onChange={(event) => setQuickCaptureTitle(event.target.value)}
                        disabled={isQuickCapturing}
                        sx={{ flex: 1 }}
                      />
                      <Button
                        type="submit"
                        variant="contained"
                        startIcon={<BoltRoundedIcon />}
                        disabled={!quickCaptureTitle.trim() || isQuickCapturing}
                      >
                        {isQuickCapturing ? 'Capturing…' : 'Capture'}
                      </Button>
                    </Stack>
                  ) : null}

                  {notes.length === 0 ? (
                    <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                      No notes have been shared here yet.
                    </Alert>
                  ) : (
                    <List disablePadding sx={{ display: 'grid', gap: 1.5 }}>
                      {notes.map((note) => (
                        <ListItemButton
                          key={note.id}
                          selected={selectedNoteId === note.id && !isCreating}
                          onClick={() => handleSelectNote(note)}
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
                                {note.createdBy && (
                                  <Typography color="text.secondary" variant="body2">
                                    Created by {note.createdBy.displayName}
                                    {note.lastEditedBy &&
                                      note.lastEditedBy.membershipId !== note.createdBy.membershipId &&
                                      ` • Edited by ${note.lastEditedBy.displayName}`}
                                  </Typography>
                                )}
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
              <Card sx={{ borderRadius: surfaceRadius }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={2.5}>
                    <Box>
                      <Typography variant="h5">
                        {isCreating ? 'Create note' : 'Note details'}
                      </Typography>
                      <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                        {canEdit
                          ? `Every save is scoped to ${campaign.name}.`
                          : 'Viewer links can read shared notes but cannot change them.'}
                      </Typography>
                    </Box>

                    <TextField
                      label="Title"
                      value={draft.title}
                      onChange={(event) =>
                        handleDraftChange('title', event.target.value)
                      }
                      slotProps={{ input: { readOnly: !canEdit } }}
                    />

                    <TextField
                      label="Session name"
                      value={draft.sessionName}
                      onChange={(event) =>
                        handleDraftChange('sessionName', event.target.value)
                      }
                      slotProps={{ input: { readOnly: !canEdit } }}
                    />

                    <TextField
                      label="Tags"
                      value={draft.tagsText}
                      onChange={(event) =>
                        handleDraftChange('tagsText', event.target.value)
                      }
                      slotProps={{ input: { readOnly: !canEdit } }}
                    />

                    <TextField
                      select
                      label="Status"
                      value={draft.status}
                      onChange={(event) =>
                        handleDraftChange('status', event.target.value as NoteStatus)
                      }
                      disabled={!canEdit}
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
                      helperText="Supports Markdown formatting like headings, lists, emphasis, and links."
                      slotProps={{ input: { readOnly: !canEdit } }}
                    />

                    <Stack spacing={1}>
                      <Typography variant="subtitle1">Rendered preview</Typography>
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
                          emptyMessage="Nothing to preview yet. Headings, lists, emphasis, and links render here without changing what gets saved."
                        />
                      </Box>
                    </Stack>

                    {canEdit ? (
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1.5}
                        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                      >
                        <Typography color="text.secondary" variant="body2">
                          {selectedNote && !isCreating
                            ? `Last updated ${formatTimestamp(selectedNote.updatedAt)}`
                            : 'New notes are saved straight to this shared campaign.'}
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
                    ) : null}
                  </Stack>
                </CardContent>
              </Card>

              <Card sx={{ borderRadius: surfaceRadius }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={2}>
                    <Typography variant="h5">Recent activity</Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      The most recently updated notes for {campaign.name} show up here.
                    </Typography>
                    {overview.recentNotes.length === 0 ? (
                      <Typography color="text.secondary">
                        Once notes are saved, the most recently updated ones show up here.
                      </Typography>
                    ) : (
                      overview.recentNotes.map((note) => (
                        <Stack key={note.id} spacing={0.75}>
                          <Typography variant="subtitle1">{note.title}</Typography>
                          <Typography color="text.secondary" variant="body2">
                            Updated {formatTimestamp(note.updatedAt)}
                            {note.lastEditedBy && ` by ${note.lastEditedBy.displayName}`}
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

export default SharedCampaignRoute
