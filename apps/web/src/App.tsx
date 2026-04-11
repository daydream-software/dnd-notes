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
  createCampaign,
  createNote,
  deleteNote,
  fetchCampaignMemberships,
  fetchCampaigns,
  fetchNotes,
  fetchOverview,
  fetchOwnerSession,
  loginOwner,
  logoutOwner,
  registerOwner,
  updateCampaign,
  updateNote,
} from './api'
import type {
  CampaignInput,
  CampaignMembership,
  CampaignSummary,
  Note,
  NoteInput,
  NoteStatus,
  NotesOverview,
  OwnerAccount,
} from './types'
import { noteStatuses } from './types'

interface NoteDraft {
  title: string
  body: string
  tagsText: string
  status: NoteStatus
  sessionName: string
}

interface CampaignDraft {
  name: string
  tagline: string
  system: string
  setting: string
  nextSession: string
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

type CampaignFormMode = 'closed' | 'create' | 'edit'

const authTokenStorageKey = 'dnd-notes:owner-auth-token'
const selectedCampaignStorageKey = 'dnd-notes:selected-campaign-id'

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

function createNotePayload(
  draft: NoteDraft,
  campaignId: string | null,
): NoteInput {
  return {
    title: draft.title,
    body: draft.body,
    status: draft.status,
    tags: draft.tagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    sessionName: draft.sessionName.trim() || null,
    campaignId,
  }
}

function createCampaignDraft(campaign?: CampaignSummary | null): CampaignDraft {
  if (!campaign) {
    return {
      name: '',
      tagline: '',
      system: '',
      setting: '',
      nextSession: '',
    }
  }

  return {
    name: campaign.name,
    tagline: campaign.tagline,
    system: campaign.system,
    setting: campaign.setting,
    nextSession: campaign.nextSession ?? '',
  }
}

function createCampaignPayload(draft: CampaignDraft): CampaignInput {
  return {
    name: draft.name,
    tagline: draft.tagline,
    system: draft.system,
    setting: draft.setting,
    nextSession: draft.nextSession.trim() || null,
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

const heroCardRadius = '32px'
const surfaceRadius = '24px'
const noteItemRadius = '20px'
const statPillRadius = '999px'

function App() {
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [owner, setOwner] = useState<OwnerAccount | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [memberships, setMemberships] = useState<CampaignMembership[]>([])
  const [overview, setOverview] = useState<NotesOverview | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState<NoteDraft>(createEmptyDraft)
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft>(
    createCampaignDraft,
  )
  const [registerDraft, setRegisterDraft] = useState<OwnerRegistrationDraft>({
    displayName: '',
    email: '',
    password: '',
  })
  const [loginDraft, setLoginDraft] = useState<OwnerLoginDraft>({
    email: '',
    password: '',
  })
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [isSavingCampaign, setIsSavingCampaign] = useState(false)
  const [isRegisterMode, setIsRegisterMode] = useState(true)
  const [campaignFormMode, setCampaignFormMode] =
    useState<CampaignFormMode>('closed')
  const [error, setError] = useState<string | null>(null)
  const selectedNoteIdRef = useRef<string | null>(null)

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId
  }, [selectedNoteId])

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  )

  const selectedCampaign = useMemo(
    () =>
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ??
      overview?.campaign ??
      null,
    [campaigns, overview, selectedCampaignId],
  )

  const currentCampaignMemberships = useMemo(
    () =>
      memberships.filter(
        (membership) => membership.campaignId === selectedCampaignId,
      ),
    [memberships, selectedCampaignId],
  )

  const statCards = useMemo(() => {
    if (!overview) {
      return []
    }

    return [
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
    ]
  }, [overview])

  const clearSession = useCallback(() => {
    localStorage.removeItem(authTokenStorageKey)
    localStorage.removeItem(selectedCampaignStorageKey)
    setAuthToken(null)
    setOwner(null)
    setCampaigns([])
    setSelectedCampaignId(null)
    setMemberships([])
    setOverview(null)
    setNotes([])
    setSelectedNoteId(null)
    setDraft(createEmptyDraft())
    setCampaignDraft(createCampaignDraft())
    setCampaignFormMode('closed')
  }, [])

  const loadWorkspace = useCallback(
    async (
      sessionToken: string,
      campaignId: string,
      preferredNoteId?: string | null,
    ) => {
      setIsLoadingWorkspace(true)

      try {
        const [nextOverview, notesResponse] = await Promise.all([
          fetchOverview(sessionToken, campaignId),
          fetchNotes(sessionToken, campaignId),
        ])

        setSelectedCampaignId(campaignId)
        localStorage.setItem(selectedCampaignStorageKey, campaignId)
        setOverview(nextOverview)
        setNotes(notesResponse.notes)
        setCampaignDraft(createCampaignDraft(nextOverview.campaign))

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
            : 'Could not load the campaign workspace.',
        )
      } finally {
        setIsLoadingWorkspace(false)
      }
    },
    [],
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
        setSelectedNoteId(null)
        setMemberships([])
        setCampaignDraft(createCampaignDraft())
        setCampaignFormMode(campaignsResponse.campaigns.length === 0 ? 'create' : 'closed')
        setError(null)
        return
      }

      await loadWorkspace(sessionToken, nextCampaign.id, preferredNoteId)
    },
    [loadWorkspace],
  )

  useEffect(() => {
    const storedToken = localStorage.getItem(authTokenStorageKey)

    if (!storedToken) {
      setIsBootstrapping(false)
      return
    }

    let cancelled = false

    const bootstrap = async () => {
      try {
        const session = await fetchOwnerSession(storedToken)

        if (cancelled) {
          return
        }

        setAuthToken(storedToken)
        setOwner(session.owner)
        await loadCampaigns(storedToken)
      } catch {
        if (!cancelled) {
          clearSession()
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [clearSession, loadCampaigns])

  useEffect(() => {
    if (!authToken || campaignFormMode !== 'edit' || !selectedCampaignId) {
      setMemberships([])
      return
    }

    let cancelled = false

    const loadMemberships = async () => {
      try {
        const response = await fetchCampaignMemberships(authToken, selectedCampaignId)

        if (!cancelled) {
          setMemberships(response.memberships)
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
  }, [authToken, campaignFormMode, selectedCampaignId])

  const handleDraftChange = <Field extends keyof NoteDraft>(
    field: Field,
    value: NoteDraft[Field],
  ) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
  }

  const handleCampaignDraftChange = <Field extends keyof CampaignDraft>(
    field: Field,
    value: CampaignDraft[Field],
  ) => {
    setCampaignDraft((currentDraft) => ({
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
    if (!authToken || !selectedCampaignId) {
      return
    }

    setError(null)
    setIsSaving(true)

    try {
      const payload = createNotePayload(draft, selectedCampaignId)

      if (isCreating || !selectedNoteId) {
        const createdNote = await createNote(authToken, payload)
        await loadWorkspace(authToken, selectedCampaignId, createdNote.id)
      } else {
        const updatedNote = await updateNote(authToken, selectedNoteId, payload)
        await loadWorkspace(authToken, selectedCampaignId, updatedNote.id)
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
    if (!authToken || !selectedCampaignId || !selectedNoteId) {
      return
    }

    setError(null)
    setIsDeleting(true)

    try {
      await deleteNote(authToken, selectedNoteId)
      await loadWorkspace(authToken, selectedCampaignId, null)
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

  const completeAuthentication = useCallback(
    async (token: string, nextOwner: OwnerAccount) => {
      localStorage.setItem(authTokenStorageKey, token)
      setAuthToken(token)
      setOwner(nextOwner)
      await loadCampaigns(token)
    },
    [loadCampaigns],
  )

  const handleSubmitAuth = async () => {
    setError(null)
    setIsSubmittingAuth(true)

    try {
      if (isRegisterMode) {
        const session = await registerOwner(registerDraft)
        await completeAuthentication(session.token, session.owner)
      } else {
        const session = await loginOwner(loginDraft)
        await completeAuthentication(session.token, session.owner)
      }
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : 'Could not complete owner authentication.',
      )
    } finally {
      setIsSubmittingAuth(false)
      setIsBootstrapping(false)
    }
  }

  const handleLogout = async () => {
    if (authToken) {
      try {
        await logoutOwner(authToken)
      } catch {
        // Intentionally ignore logout failures because local sign-out should still work.
      }
    }

    clearSession()
    setError(null)
    setIsRegisterMode(false)
  }

  const handleOpenCampaignCreate = () => {
    setCampaignDraft(createCampaignDraft())
    setMemberships([])
    setCampaignFormMode('create')
    setError(null)
  }

  const handleOpenCampaignSettings = () => {
    setCampaignDraft(createCampaignDraft(selectedCampaign))
    setCampaignFormMode('edit')
    setError(null)
  }

  const handleCancelCampaignForm = () => {
    setCampaignDraft(createCampaignDraft(selectedCampaign))
    setCampaignFormMode(campaigns.length === 0 ? 'create' : 'closed')
    setError(null)
  }

  const handleSaveCampaign = async () => {
    if (!authToken) {
      return
    }

    setError(null)
    setIsSavingCampaign(true)

    try {
      const payload = createCampaignPayload(campaignDraft)

      if (campaignFormMode === 'create') {
        const createdCampaign = await createCampaign(authToken, payload)
        await loadCampaigns(authToken, createdCampaign.id)
      } else if (campaignFormMode === 'edit' && selectedCampaignId) {
        const updatedCampaign = await updateCampaign(
          authToken,
          selectedCampaignId,
          payload,
        )
        await loadCampaigns(authToken, updatedCampaign.id)
      }

      setCampaignFormMode('closed')
    } catch (campaignError) {
      setError(
        campaignError instanceof Error
          ? campaignError.message
          : 'Could not save the campaign.',
      )
    } finally {
      setIsSavingCampaign(false)
    }
  }

  const handleSelectCampaign = async (campaignId: string) => {
    if (!authToken) {
      return
    }

    setCampaignFormMode('closed')
    setMemberships([])
    await loadWorkspace(authToken, campaignId)
  }

  if (isBootstrapping) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress />
          <Typography color="text.secondary">Loading owner workspace...</Typography>
        </Stack>
      </Box>
    )
  }

  if (!owner || !authToken) {
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
                      Campaign owner access
                    </Typography>
                    <Typography variant="h3" sx={{ mt: 1 }}>
                      {isRegisterMode ? 'Create your owner account' : 'Sign in to your campaigns'}
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 2 }}>
                      Finish setting up campaigns, manage campaign details, and keep note
                      workflows scoped to the right table.
                    </Typography>
                  </Box>

                  {error ? (
                    <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
                      {error}
                    </Alert>
                  ) : null}

                  {isRegisterMode ? (
                    <TextField
                      label="Owner display name"
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
                      onClick={handleSubmitAuth}
                      disabled={isSubmittingAuth}
                    >
                      {isSubmittingAuth
                        ? isRegisterMode
                          ? 'Creating account...'
                          : 'Signing in...'
                        : isRegisterMode
                          ? 'Create owner account'
                          : 'Sign in'}
                    </Button>
                    <Button
                      variant="text"
                      onClick={() => {
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
          </Stack>
        </Container>
      </Box>
    )
  }

  if (campaigns.length === 0 || (!selectedCampaignId && campaignFormMode === 'create')) {
    return (
      <Box component="main" sx={{ minHeight: '100vh', py: { xs: 4, md: 6 } }}>
        <Container maxWidth="md">
          <Stack spacing={3}>
            <Card sx={{ borderRadius: heroCardRadius }}>
              <CardContent sx={{ p: { xs: 3, md: 4 } }}>
                <Stack spacing={3}>
                  <Box>
                    <Typography
                      variant="overline"
                      sx={{ color: 'text.secondary', letterSpacing: '0.18em' }}
                    >
                      Owner setup
                    </Typography>
                    <Typography variant="h3" sx={{ mt: 1 }}>
                      Create your first campaign
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 2 }}>
                      Start with the campaign shell first, then you can manage notes,
                      settings, and invite flows from the same workspace.
                    </Typography>
                  </Box>

                  {error ? (
                    <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
                      {error}
                    </Alert>
                  ) : null}

                  <TextField
                    label="Campaign name"
                    value={campaignDraft.name}
                    onChange={(event) =>
                      handleCampaignDraftChange('name', event.target.value)
                    }
                  />
                  <TextField
                    label="Tagline"
                    value={campaignDraft.tagline}
                    onChange={(event) =>
                      handleCampaignDraftChange('tagline', event.target.value)
                    }
                  />
                  <TextField
                    label="System"
                    value={campaignDraft.system}
                    onChange={(event) =>
                      handleCampaignDraftChange('system', event.target.value)
                    }
                  />
                  <TextField
                    label="Setting"
                    value={campaignDraft.setting}
                    onChange={(event) =>
                      handleCampaignDraftChange('setting', event.target.value)
                    }
                  />
                  <TextField
                    label="Next session"
                    value={campaignDraft.nextSession}
                    onChange={(event) =>
                      handleCampaignDraftChange('nextSession', event.target.value)
                    }
                    helperText="Optional. Use an ISO timestamp or plain text date."
                  />

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Button
                      variant="contained"
                      onClick={handleSaveCampaign}
                      disabled={isSavingCampaign}
                    >
                      {isSavingCampaign ? 'Creating campaign...' : 'Create campaign'}
                    </Button>
                    <Button variant="text" onClick={handleLogout}>
                      Sign out
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </Box>
    )
  }

  if (isLoadingWorkspace || !overview || !selectedCampaign) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress />
          <Typography color="text.secondary">Loading campaign workspace...</Typography>
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
                'linear-gradient(140deg, rgba(124, 58, 237, 0.9), rgba(30, 41, 59, 0.96))',
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
                      Campaign workspace
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
                      Signed in as {owner.displayName}. Campaigns, settings, and notes all
                      stay scoped to the owner-selected campaign.
                    </Typography>
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
                    <TextField
                      select
                      label="Campaign"
                      value={selectedCampaignId}
                      onChange={(event) => void handleSelectCampaign(event.target.value)}
                    >
                      {campaigns.map((campaign) => (
                        <MenuItem key={campaign.id} value={campaign.id}>
                          {campaign.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Typography color="rgba(255, 255, 255, 0.72)">
                      {overview.campaign.setting} • {overview.campaign.system}
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button variant="contained" onClick={handleOpenCampaignCreate}>
                        New campaign
                      </Button>
                      <Button variant="outlined" color="inherit" onClick={handleOpenCampaignSettings}>
                        Campaign settings
                      </Button>
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button
                        variant="contained"
                        color="secondary"
                        startIcon={<AddRoundedIcon />}
                        onClick={handleStartNote}
                      >
                        New note
                      </Button>
                      <Button variant="text" color="inherit" onClick={handleLogout}>
                        Sign out
                      </Button>
                    </Stack>
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

          {campaignFormMode !== 'closed' ? (
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

                  <TextField
                    label="Campaign name"
                    value={campaignDraft.name}
                    onChange={(event) =>
                      handleCampaignDraftChange('name', event.target.value)
                    }
                  />
                  <TextField
                    label="Tagline"
                    value={campaignDraft.tagline}
                    onChange={(event) =>
                      handleCampaignDraftChange('tagline', event.target.value)
                    }
                  />
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <TextField
                      fullWidth
                      label="System"
                      value={campaignDraft.system}
                      onChange={(event) =>
                        handleCampaignDraftChange('system', event.target.value)
                      }
                    />
                    <TextField
                      fullWidth
                      label="Setting"
                      value={campaignDraft.setting}
                      onChange={(event) =>
                        handleCampaignDraftChange('setting', event.target.value)
                      }
                    />
                  </Stack>
                  <TextField
                    label="Next session"
                    value={campaignDraft.nextSession}
                    onChange={(event) =>
                      handleCampaignDraftChange('nextSession', event.target.value)
                    }
                    helperText="Optional. Use an ISO timestamp or plain text date."
                  />

                  {campaignFormMode === 'edit' ? (
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
                            label={`${membership.displayName} (${membership.role})`}
                            color={membership.role === 'owner' ? 'secondary' : 'default'}
                          />
                        ))}
                      </Stack>
                    </Box>
                  ) : null}

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Button
                      variant="contained"
                      startIcon={<SaveRoundedIcon />}
                      onClick={handleSaveCampaign}
                      disabled={isSavingCampaign}
                    >
                      {isSavingCampaign
                        ? campaignFormMode === 'create'
                          ? 'Creating campaign...'
                          : 'Saving settings...'
                        : campaignFormMode === 'create'
                          ? 'Create campaign'
                          : 'Save campaign settings'}
                    </Button>
                    <Button variant="text" onClick={handleCancelCampaignForm}>
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
              gap: 3,
              gridTemplateColumns: { xs: '1fr', lg: '1.2fr 1fr' },
            }}
          >
            <Card sx={{ borderRadius: surfaceRadius }}>
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
                        The note workflow now runs inside the selected owner campaign.
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
                    <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                      No notes yet in this campaign. Create the first one to start using the
                      workspace.
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
              <Card sx={{ borderRadius: surfaceRadius }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={2.5}>
                    <Box>
                      <Typography variant="h5">
                        {isCreating ? 'Create note' : 'Edit note'}
                      </Typography>
                      <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                        Every save is scoped to {overview.campaign.name}, so each campaign can
                        keep its own note trail.
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
                          : 'New notes are saved straight to the selected campaign.'}
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

              <Card sx={{ borderRadius: surfaceRadius }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={2}>
                    <Typography variant="h5">Recent activity</Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      The most recently updated notes for {overview.campaign.name} show up
                      here.
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
