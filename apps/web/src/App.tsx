import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import BoltRoundedIcon from '@mui/icons-material/BoltRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import PlaylistAddCheckCircleRoundedIcon from '@mui/icons-material/PlaylistAddCheckCircleRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded'
import { DndNotesMark } from './DndNotesMark'
import {
  Alert,
  Autocomplete,
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
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  claimSharedMembership,
  consolidateCampaignMemberships,
  createCampaign,
  createCampaignShareLink,
  createNote,
  fetchAuthConfig,
  fetchAdminAccounts,
  createSharedNote,
  deleteNote,
  deleteSharedNote,
  fetchAdminOverview,
  fetchCampaignShareLinks,
  fetchCampaignMemberships,
  fetchCampaigns,
  fetchNoteActivity,
  fetchNotes,
  fetchOverview,
  fetchOwnerSession,
  fetchSessionNotes,
  fetchSessions,
  fetchSharedNotes,
  fetchSharedOverview,
  fetchSharedSession,
  joinSharedCampaign,
  loginOwner,
  logoutOwner,
  revealCampaignShareLink,
  registerOwner,
  revokeCampaignShareLink,
  updateCampaign,
  updateNote,
  updateSharedNote,
} from './api'
import {
  createRuntimeKeycloakClient,
  isKeycloakAuthConfig,
  type RuntimeKeycloakClient,
  type StoredKeycloakTokens,
} from './keycloak-client'
import {
  blankCampaignTemplateId,
  blankNoteTemplateId,
  campaignStarterTemplates,
  createStarterNoteInput,
  getCampaignStarterTemplate,
  getNoteStarterTemplate,
  noteStarterTemplates,
  type StarterNoteSeed,
} from './templates'
import CampaignWorkspaceHeader from './CampaignWorkspaceHeader'
import { formatTimestamp } from './formatTimestamp'
import { markdownToPlainText } from './note-excerpts'
import NoteBodyEditor from './NoteBodyEditor'
import NotesBrowsePane from './NotesBrowsePane'
import { NoteBodyPreview } from './note-formatting'
import { extractInlineNoteReferences } from './note-references'
import type {
  ActivityCollaborator,
  AdminAccountSummary,
  AuthConfigResponse,
  AdminOverview,
  CampaignInput,
  CampaignMembership,
  MembershipConsolidationSummary,
  CampaignShareLink,
  CampaignShareLinkInput,
  CampaignSummary,
  GuestJoinInput,
  Note,
  NoteActivityEntry,
  NoteInput,
  NoteStatus,
  NotesOverview,
  OwnerAccount,
  SessionSummary,
  ShareAccessLevel,
} from './types'
import { noteStatuses } from './types'
import SiteAdminPanel from './SiteAdminPanel'
import WorkspacePane from './WorkspacePane'
import NoteEditorActions from './NoteEditorActions'
import { WorkspaceLoadingView } from './WorkspaceLoadingView'

interface NoteDraft {
  title: string
  body: string
  tagsText: string
  status: NoteStatus
  sessionName: string
  linkedNoteIds: string[]
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

interface ShareLinkDraft {
  label: string
  accessLevel: ShareAccessLevel
  frameAncestors: string
}

interface MembershipConsolidationDraft {
  sourceMembershipId: string
  targetMembershipId: string
  confirmRoleMismatch: boolean
}

interface RevealedShareLink {
  url: string
  isVisible: boolean
}

interface TagFacet {
  tag: string
  count: number
}

interface ResolvedNoteLink {
  targetNoteId: string
  qualifiers: string[]
}

interface NoteLinkPanelItem {
  note: Note
  qualifiers: string[]
}

type CampaignFormMode = 'closed' | 'create' | 'edit'
type NoteBrowseMode = 'notes' | 'sessions' | 'activity'
type NarrowWorkspacePanel = 'browse' | 'editor'

const authTokenStorageKey = 'dnd-notes:owner-auth-token'
const keycloakTokensStorageKey = 'dnd-notes:keycloak-auth-tokens'
const selectedCampaignStorageKey = 'dnd-notes:selected-campaign-id'
const missingKeycloakClientErrorMessage =
  'Sign-in is not ready yet. Reload and try again.'
const guestTokenStoragePrefix = 'dnd-notes:guest-token:'
const recentActivityLimit = 20
const defaultNotesPaneDescription =
  'The note workflow now runs inside the selected campaign.'

function getShareTokenFromPath(pathname: string) {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

function readStoredKeycloakTokens(): StoredKeycloakTokens | null {
  const rawTokens = localStorage.getItem(keycloakTokensStorageKey)

  if (!rawTokens) {
    return null
  }

  try {
    const parsed = JSON.parse(rawTokens) as Partial<StoredKeycloakTokens>

    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string'
    ) {
      return null
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      ...(typeof parsed.idToken === 'string' ? { idToken: parsed.idToken } : {}),
    }
  } catch {
    return null
  }
}

function persistKeycloakTokens(tokens: StoredKeycloakTokens) {
  localStorage.setItem(keycloakTokensStorageKey, JSON.stringify(tokens))
  localStorage.setItem(authTokenStorageKey, tokens.accessToken)
}

function clearStoredKeycloakTokens() {
  localStorage.removeItem(keycloakTokensStorageKey)
}

function createEmptyDraft(): NoteDraft {
  return {
    title: '',
    body: '',
    tagsText: '',
    status: 'draft',
    sessionName: '',
    linkedNoteIds: [],
  }
}

function normalizeTags(rawTags: readonly string[]) {
  const seen = new Set<string>()

  return rawTags
    .flatMap((tag) => tag.split(','))
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag || seen.has(tag)) {
        return false
      }

      seen.add(tag)
      return true
    })
}

function createTagsText(tags: readonly string[]) {
  return normalizeTags(tags).join(', ')
}

function createDraftFromNote(note: Note): NoteDraft {
  return {
    title: note.title,
    body: note.body,
    tagsText: createTagsText(note.tags),
    status: note.status,
    sessionName: note.sessionName ?? '',
    linkedNoteIds: note.linkedNoteIds ?? [],
  }
}

function createDraftFromStarterNote(starterNote: StarterNoteSeed): NoteDraft {
  return {
    title: starterNote.title,
    body: starterNote.body,
    tagsText: createTagsText(starterNote.tags),
    status: starterNote.status,
    sessionName: starterNote.sessionName ?? '',
    linkedNoteIds: [],
  }
}

function trimToNull(value: string): string | null {
  const trimmedValue = value.trim()
  return trimmedValue === '' ? null : trimmedValue
}

function formatFallbackText(value: string | null, fallback: string) {
  return trimToNull(value ?? '') ?? fallback
}

function createNotePayload(
  draft: NoteDraft,
  campaignId: string | null,
): NoteInput {
  return {
    title: draft.title,
    body: draft.body,
    status: draft.status,
    tags: normalizeTags([draft.tagsText]),
    sessionName: trimToNull(draft.sessionName),
    linkedNoteIds: draft.linkedNoteIds,
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
    nextSession: trimToNull(draft.nextSession),
  }
}

function createShareLinkDraft(): ShareLinkDraft {
  return {
    label: '',
    accessLevel: 'editor',
    frameAncestors: '',
  }
}

function createShareLinkPayload(draft: ShareLinkDraft): CampaignShareLinkInput {
  return {
    label: trimToNull(draft.label),
    accessLevel: draft.accessLevel,
    frameAncestors: trimToNull(draft.frameAncestors),
  }
}

function createMembershipConsolidationDraft(): MembershipConsolidationDraft {
  return {
    sourceMembershipId: '',
    targetMembershipId: '',
    confirmRoleMismatch: false,
  }
}

function describeCampaignMembership(membership: CampaignMembership) {
  const roleLabel =
    membership.role === 'guest' && membership.userId !== null
      ? 'linked collaborator'
      : membership.role

  return `${membership.displayName} (${roleLabel})`
}

function deleteRecordKey<Value>(record: Record<string, Value>, key: string) {
  const nextRecord = { ...record }
  delete nextRecord[key]
  return nextRecord
}

async function copyTextToClipboard(value: string) {
  if (typeof window !== 'undefined' && window.navigator.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(value)
    return
  }

  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    document.body.append(textarea)
    textarea.select()

    try {
      if (document.execCommand('copy')) {
        return
      }
    } finally {
      document.body.removeChild(textarea)
    }
  }

  throw new Error('Clipboard access is unavailable. Reveal the link and copy it manually.')
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

function getResolvedNoteLinks(note: Note): ResolvedNoteLink[] {
  const qualifiersByTargetId = new Map<string, Set<string>>()

  const ensureTarget = (targetNoteId: string) => {
    const existingQualifiers = qualifiersByTargetId.get(targetNoteId)

    if (existingQualifiers) {
      return existingQualifiers
    }

    const nextQualifiers = new Set<string>()
    qualifiersByTargetId.set(targetNoteId, nextQualifiers)
    return nextQualifiers
  }

  for (const linkedNoteId of note.linkedNoteIds ?? []) {
    ensureTarget(linkedNoteId)
  }

  const structuredReferences = Array.isArray(note.references) ? note.references : null

  if (structuredReferences && structuredReferences.length > 0) {
    for (const reference of structuredReferences) {
      const qualifiers = ensureTarget(reference.targetNoteId)

      if (reference.qualifier) {
        qualifiers.add(reference.qualifier)
      }
    }
  } else {
    for (const reference of extractInlineNoteReferences(note.body)) {
      const qualifiers = ensureTarget(reference.noteId)

      if (reference.qualifier) {
        qualifiers.add(reference.qualifier)
      }
    }
  }

  return Array.from(qualifiersByTargetId, ([targetNoteId, qualifiers]) => ({
    targetNoteId,
    qualifiers: Array.from(qualifiers).sort((left, right) => left.localeCompare(right)),
  }))
}

function getNoteDisplayTitle(note: Pick<Note, 'title' | 'id'>) {
  return note.title.trim() || note.id
}

function formatResolvedRelationshipText(
  originTitle: string,
  qualifiers: readonly string[],
  targetTitle: string,
) {
  if (qualifiers.length === 0) {
    return null
  }

  return `${originTitle} ${qualifiers.join(' / ')} ${targetTitle}`
}

function getNoteRelationshipSearchText(
  note: Note,
  noteTitleById: ReadonlyMap<string, string>,
) {
  const originTitle = getNoteDisplayTitle(note)

  return getResolvedNoteLinks(note)
    .flatMap((reference) => {
      const targetTitle = noteTitleById.get(reference.targetNoteId) ?? reference.targetNoteId
      const relationshipText = formatResolvedRelationshipText(
        originTitle,
        reference.qualifiers,
        targetTitle,
      )

      return relationshipText ? [relationshipText] : []
    })
    .join(' ')
}

function createNoteSearchText(
  note: Note,
  noteTitleById: ReadonlyMap<string, string>,
) {
  return [
    getNoteDisplayTitle(note),
    markdownToPlainText(note.body),
    getNoteRelationshipSearchText(note, noteTitleById),
    note.tags.join(' '),
    note.sessionName ?? '',
    note.createdBy?.displayName ?? '',
    note.lastEditedBy?.displayName ?? '',
  ]
    .join('\n')
    .toLowerCase()
}

function sortActivityEntries(entries: NoteActivityEntry[]) {
  return [...entries].sort((leftEntry, rightEntry) =>
    rightEntry.updatedAt.localeCompare(leftEntry.updatedAt),
  )
}

const heroCardRadius = '32px'
const surfaceRadius = '24px'
const noteItemRadius = '20px'
const statPillRadius = '999px'
const singleLineTextSx = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const
const sessionNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})
const tagFacetCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
})

function sortSessionSummaries(sessions: SessionSummary[]) {
  return [...sessions].sort((leftSession, rightSession) =>
    sessionNameCollator.compare(
      rightSession.sessionName,
      leftSession.sessionName,
    ),
  )
}

function createTagFacets(notes: Note[]): TagFacet[] {
  const tagCounts = new Map<string, number>()

  for (const note of notes) {
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }

  return [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((leftFacet, rightFacet) =>
      rightFacet.count !== leftFacet.count
        ? rightFacet.count - leftFacet.count
        : tagFacetCollator.compare(leftFacet.tag, rightFacet.tag),
    )
}

function createSessionSummariesFromNotes(notes: readonly Note[]): SessionSummary[] {
  const sessionMap = new Map<string, SessionSummary>()

  for (const note of notes) {
    const sessionName = note.sessionName?.trim()
    if (!sessionName) {
      continue
    }

    const existingSummary = sessionMap.get(sessionName)
    if (!existingSummary) {
      sessionMap.set(sessionName, {
        sessionName,
        noteCount: 1,
        latestActivity: note.updatedAt,
      })
      continue
    }

    sessionMap.set(sessionName, {
      sessionName,
      noteCount: existingSummary.noteCount + 1,
      latestActivity:
        existingSummary.latestActivity > note.updatedAt
          ? existingSummary.latestActivity
          : note.updatedAt,
    })
  }

  return sortSessionSummaries([...sessionMap.values()])
}

function toSharedActivityEntry(note: Note): NoteActivityEntry {
  return {
    ...note,
    action:
      note.lastEditedBy !== null && note.updatedAt !== note.createdAt ? 'edited' : 'created',
  }
}

function getActivityAttribution(entry: NoteActivityEntry) {
  return entry.action === 'created'
    ? (entry.createdBy ?? entry.lastEditedBy)
    : (entry.lastEditedBy ?? entry.createdBy)
}

function createActivityCollaboratorsFromEntries(
  entries: readonly NoteActivityEntry[],
): ActivityCollaborator[] {
  const collaboratorMap = new Map<string, ActivityCollaborator>()

  for (const entry of entries) {
    const attribution = getActivityAttribution(entry)
    if (!attribution) {
      continue
    }

    const existingCollaborator = collaboratorMap.get(attribution.membershipId)
    if (!existingCollaborator) {
      collaboratorMap.set(attribution.membershipId, {
        membershipId: attribution.membershipId,
        displayName: attribution.displayName,
        role: attribution.role,
        noteCount: 1,
      })
      continue
    }

    collaboratorMap.set(attribution.membershipId, {
      ...existingCollaborator,
      noteCount: existingCollaborator.noteCount + 1,
    })
  }

  return [...collaboratorMap.values()].sort((leftCollaborator, rightCollaborator) =>
    rightCollaborator.noteCount !== leftCollaborator.noteCount
      ? rightCollaborator.noteCount - leftCollaborator.noteCount
      : leftCollaborator.displayName.localeCompare(rightCollaborator.displayName),
  )
}

function formatSessionLine(sessionName: string | null) {
  return formatFallbackText(sessionName, 'No session')
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
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [owner, setOwner] = useState<OwnerAccount | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [memberships, setMemberships] = useState<CampaignMembership[]>([])
  const [shareLinks, setShareLinks] = useState<CampaignShareLink[]>([])
  const [sharedCampaign, setSharedCampaign] = useState<CampaignSummary | null>(null)
  const [shareLink, setShareLink] = useState<CampaignShareLink | null>(null)
  const [sharedMembership, setSharedMembership] = useState<CampaignMembership | null>(null)
  const [guestToken, setGuestToken] = useState<string | null>(null)
  const [overview, setOverview] = useState<NotesOverview | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [noteBrowseMode, setNoteBrowseMode] = useState<NoteBrowseMode>('notes')
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummary[]>([])
  const [selectedSessionName, setSelectedSessionName] = useState<string | null>(null)
  const [sessionNotes, setSessionNotes] = useState<Note[]>([])
  const [activityEntries, setActivityEntries] = useState<NoteActivityEntry[]>([])
  const [activityCollaborators, setActivityCollaborators] = useState<ActivityCollaborator[]>(
    [],
  )
  const [selectedActivityMembershipId, setSelectedActivityMembershipId] = useState<
    string | null
  >(null)
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null)
  const [narrowWorkspacePanel, setNarrowWorkspacePanel] =
    useState<NarrowWorkspacePanel>('browse')
  const [showSplitNoteWorkspace, setShowSplitNoteWorkspace] = useState(false)
  const [searchText, setSearchText] = useState('')
  const deferredSearchText = useDeferredValue(searchText)
  const [draft, setDraft] = useState<NoteDraft>(createEmptyDraft)
  const [tagInputValue, setTagInputValue] = useState('')
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft>(
    createCampaignDraft,
  )
  const [shareLinkDraft, setShareLinkDraft] = useState<ShareLinkDraft>(createShareLinkDraft)
  const [membershipConsolidationDraft, setMembershipConsolidationDraft] = useState<
    MembershipConsolidationDraft
  >(createMembershipConsolidationDraft)
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
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [isSharedReady, setIsSharedReady] = useState(!isSharedMode)
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)
  const [isLoadingSessionNotes, setIsLoadingSessionNotes] = useState(false)
  const [isLoadingActivity, setIsLoadingActivity] = useState(false)
  const [isQuickCapturing, setIsQuickCapturing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [isLinkingAccount, setIsLinkingAccount] = useState(false)
  const [isSavingCampaign, setIsSavingCampaign] = useState(false)
  const [isCreatingShareLink, setIsCreatingShareLink] = useState(false)
  const [isLoadingAdminOverview, setIsLoadingAdminOverview] = useState(false)
  const [isPreviewingMembershipConsolidation, setIsPreviewingMembershipConsolidation] =
    useState(false)
  const [isApplyingMembershipConsolidation, setIsApplyingMembershipConsolidation] =
    useState(false)
  const [isRegisterMode, setIsRegisterMode] = useState(true)
  const [campaignFormMode, setCampaignFormMode] =
    useState<CampaignFormMode>('closed')
  const [selectedCampaignTemplateId, setSelectedCampaignTemplateId] = useState(
    blankCampaignTemplateId,
  )
  const [selectedNoteTemplateId, setSelectedNoteTemplateId] = useState(
    blankNoteTemplateId,
  )
  const [shareLinkNotice, setShareLinkNotice] = useState<string | null>(null)
  const [accountNotice, setAccountNotice] = useState<string | null>(null)
  const [adminAccounts, setAdminAccounts] = useState<AdminAccountSummary[]>([])
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [revealedShareLinks, setRevealedShareLinks] = useState<
    Record<string, RevealedShareLink>
  >({})
  const [shareLinkActionErrors, setShareLinkActionErrors] = useState<
    Record<string, string>
  >({})
  const [revealingShareLinkId, setRevealingShareLinkId] = useState<string | null>(
    null,
  )
  const [copiedShareLinkId, setCopiedShareLinkId] = useState<string | null>(null)
  const [membershipConsolidationPreview, setMembershipConsolidationPreview] =
    useState<MembershipConsolidationSummary | null>(null)
  const [membershipConsolidationNotice, setMembershipConsolidationNotice] = useState<
    string | null
  >(null)
  const [joinDraft, setJoinDraft] = useState<GuestJoinInput>({ displayName: '' })
  const [quickCaptureTitle, setQuickCaptureTitle] = useState('')
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noteBrowseModeRef = useRef<NoteBrowseMode>('notes')
  const selectedNoteIdRef = useRef<string | null>(null)
  const selectedSessionNameRef = useRef<string | null>(null)
  const selectedActivityMembershipIdRef = useRef<string | null>(null)
  const activityRequestIdRef = useRef(0)
  const sessionRequestIdRef = useRef(0)
  const activityAbortControllerRef = useRef<AbortController | null>(null)
  const sessionAbortControllerRef = useRef<AbortController | null>(null)
  const keycloakClientRef = useRef<RuntimeKeycloakClient | null>(null)
  const isBootstrapping = !isAuthReady || !isSharedReady

  useEffect(() => {
    noteBrowseModeRef.current = noteBrowseMode
  }, [noteBrowseMode])

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId
  }, [selectedNoteId])

  useEffect(() => {
    selectedSessionNameRef.current = selectedSessionName
  }, [selectedSessionName])

  useEffect(() => {
    selectedActivityMembershipIdRef.current = selectedActivityMembershipId
  }, [selectedActivityMembershipId])

  useEffect(
    () => () => {
      activityAbortControllerRef.current?.abort()
      sessionAbortControllerRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    setTagInputValue('')
  }, [draft.tagsText])

  useEffect(() => {
    if (!canSplitNoteWorkspace) {
      setShowSplitNoteWorkspace(false)
    }
  }, [canSplitNoteWorkspace])

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
  const selectedCampaignTemplate = getCampaignStarterTemplate(
    selectedCampaignTemplateId,
  )
  const selectedNoteTemplate = getNoteStarterTemplate(selectedNoteTemplateId)
  const sharedSessionSummaries = useMemo(() => createSessionSummariesFromNotes(notes), [notes])
  const sharedSessionNotes = useMemo(
    () =>
      selectedSessionName
        ? notes.filter((note) => note.sessionName?.trim() === selectedSessionName)
        : [],
    [notes, selectedSessionName],
  )
  const sharedActivityEntries = useMemo(
    () => notes.map((note) => toSharedActivityEntry(note)),
    [notes],
  )
  const sharedActivityCollaborators = useMemo(
    () => createActivityCollaboratorsFromEntries(sharedActivityEntries),
    [sharedActivityEntries],
  )
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
  const draftTags = useMemo(() => normalizeTags([draft.tagsText]), [draft.tagsText])
  const noteLinkOptions = useMemo(
    () =>
      notes
        .filter((note) => note.id !== selectedNoteId)
        .map((note) => ({
          id: note.id,
          title: note.title || '(Untitled)',
        })),
    [notes, selectedNoteId],
  )
  const noteTitlesById = useMemo(
    () => new Map(notes.map((note) => [note.id, getNoteDisplayTitle(note)])),
    [notes],
  )
  const noteSearchEntries = useMemo(
    () =>
      notes.map((note) => ({
        note,
        searchText: createNoteSearchText(note, noteTitlesById),
      })),
    [noteTitlesById, notes],
  )

  const linkedNotes = useMemo<NoteLinkPanelItem[]>(() => {
    if (!selectedNote) {
      return []
    }

    const linkedNoteMap = new Map(
      getResolvedNoteLinks(selectedNote).map((reference) => [
        reference.targetNoteId,
        reference.qualifiers,
      ]),
    )

    return notes.flatMap((note) => {
      const qualifiers = linkedNoteMap.get(note.id)

      return qualifiers ? [{ note, qualifiers }] : []
    })
  }, [selectedNote, notes])

  const backlinks = useMemo<NoteLinkPanelItem[]>(() => {
    if (!selectedNoteId) {
      return []
    }

    return notes.flatMap((note) => {
      const matchingReference = getResolvedNoteLinks(note).find(
        (reference) => reference.targetNoteId === selectedNoteId,
      )

      return matchingReference
        ? [{ note, qualifiers: matchingReference.qualifiers }]
        : []
    })
  }, [selectedNoteId, notes])
  const tagFacets = useMemo(() => createTagFacets(notes), [notes])
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
  const filteredNotes = useMemo(() => {
    let entries = noteSearchEntries

    if (selectedTagFilter) {
      entries = entries.filter(({ note }) => note.tags.includes(selectedTagFilter))
    }

    const normalizedSearchText = deferredSearchText.trim().toLowerCase()

    if (normalizedSearchText) {
      entries = entries.filter(({ searchText }) =>
        searchText.includes(normalizedSearchText),
      )
    }

    return entries.map(({ note }) => note)
  }, [deferredSearchText, noteSearchEntries, selectedTagFilter])
  const displayedNotes = useMemo(
    () =>
      noteBrowseMode === 'sessions' && selectedSessionName
        ? isSharedMode
          ? sharedSessionNotes
          : sessionNotes
        : noteBrowseMode === 'notes'
          ? filteredNotes
          : notes,
    [filteredNotes, isSharedMode, noteBrowseMode, notes, selectedSessionName, sessionNotes, sharedSessionNotes],
  )
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
  const isSinglePaneNoteWorkspace = !showSplitNoteWorkspace
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
  const notePaneHeading =
    noteBrowseMode === 'activity'
      ? 'Recent activity'
      : noteBrowseMode === 'sessions'
        ? selectedSessionName
          ? `${selectedSessionName} notes`
          : 'Sessions'
        : selectedTagFilter
          ? `Notes tagged “${selectedTagFilter}”`
          : 'Notes'
  const notePaneDescription =
    noteBrowseMode === 'activity'
      ? resolvedSelectedActivityCollaborator
        ? `See the latest notes created or edited by ${resolvedSelectedActivityCollaborator.displayName} without digging through the full archive.`
        : 'See which notes changed recently and who touched them, without turning the workspace into a full audit log.'
      : noteBrowseMode === 'sessions'
        ? selectedSessionName
          ? `Browse the notes captured during ${selectedSessionName} without leaving the note detail view.`
          : 'Jump into a session to answer “what happened in this session?” without digging through the whole campaign.'
        : searchText.trim() && selectedTagFacet
          ? `Showing ${filteredNotes.length} ${filteredNotes.length === 1 ? 'note' : 'notes'} matching "${searchText}" in ${selectedTagFacet.tag}.`
          : searchText.trim()
            ? `Showing ${filteredNotes.length} ${filteredNotes.length === 1 ? 'note' : 'notes'} matching "${searchText}" across titles, body, link relationships, tags, sessions, and collaborators.`
            : selectedTagFacet
              ? `Showing ${selectedTagFacet.count} ${
                  selectedTagFacet.count === 1 ? 'note' : 'notes'
                } tagged ${selectedTagFacet.tag} in ${resolvedCampaign?.name ?? 'this campaign'}.`
              : defaultNotesPaneDescription

  const resetShareLinkInteractionState = useCallback(() => {
    setShareLinkNotice(null)
    setRevealedShareLinks({})
    setShareLinkActionErrors({})
    setRevealingShareLinkId(null)
    setCopiedShareLinkId(null)
  }, [])

  const resetMembershipConsolidationState = useCallback(() => {
    setMembershipConsolidationDraft(createMembershipConsolidationDraft())
    setMembershipConsolidationPreview(null)
    setMembershipConsolidationNotice(null)
    setIsPreviewingMembershipConsolidation(false)
    setIsApplyingMembershipConsolidation(false)
  }, [])

  const resetSessionBrowserState = useCallback(() => {
    sessionAbortControllerRef.current?.abort()
    setSelectedSessionName(null)
    setSessionNotes([])
    setIsLoadingSessionNotes(false)
  }, [])

  const resetActivityState = useCallback((preserveFilter = false) => {
    activityAbortControllerRef.current?.abort()
    setActivityEntries([])
    setActivityCollaborators([])
    setIsLoadingActivity(false)

    if (!preserveFilter) {
      setSelectedActivityMembershipId(null)
    }
  }, [])

  const loadActivity = useCallback(
    async (
      sessionToken: string,
      campaignId: string,
      membershipId?: string | null,
    ) => {
      activityRequestIdRef.current += 1
      const requestId = activityRequestIdRef.current

      activityAbortControllerRef.current?.abort()
      const abortController = new AbortController()
      activityAbortControllerRef.current = abortController

      setIsLoadingActivity(true)
      setActivityEntries([])

      try {
        const response = await fetchNoteActivity(sessionToken, {
          campaignId,
          membershipId,
          limit: recentActivityLimit,
          signal: abortController.signal,
        })

        if (activityRequestIdRef.current !== requestId) {
          return
        }

        setActivityCollaborators(response.collaborators)
        setActivityEntries(response.activity)
        setError(null)
      } catch (loadError) {
        if (
          abortController.signal.aborted ||
          activityRequestIdRef.current !== requestId
        ) {
          return
        }

        setActivityEntries([])
        setActivityCollaborators([])
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load recent activity.',
        )
      } finally {
        if (activityRequestIdRef.current === requestId) {
          setIsLoadingActivity(false)
        }
      }
    },
    [],
  )

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
    setAdminAccounts([])
    setAdminOverview(null)
    setAdminError(null)
    setNotes([])
    setNoteBrowseMode('notes')
    setNarrowWorkspacePanel('browse')
    setSessionSummaries([])
    setQuickCaptureTitle('')
    setSelectedNoteId(null)
    setDraft(createEmptyDraft())
    setCampaignDraft(createCampaignDraft())
    setShareLinkDraft(createShareLinkDraft())
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
    ) => {
      setIsLoadingWorkspace(true)

      try {
        const [nextOverview, notesResponse, sessionsResponse] = await Promise.all([
          fetchOverview(sessionToken, campaignId),
          fetchNotes(sessionToken, campaignId),
          fetchSessions(sessionToken, campaignId),
        ])
        const nextSessionSummaries = sortSessionSummaries(sessionsResponse.sessions)
        const currentSessionName = selectedSessionNameRef.current
        const shouldRefreshSelectedSession =
          currentSessionName !== null &&
          nextSessionSummaries.some(
            (sessionSummary) => sessionSummary.sessionName === currentSessionName,
          )
        const nextSessionNotes = shouldRefreshSelectedSession
          ? (
              await fetchSessionNotes(
                sessionToken,
                currentSessionName,
                campaignId,
              )
            ).notes
          : []

        setSelectedCampaignId(campaignId)
        localStorage.setItem(selectedCampaignStorageKey, campaignId)
        setOverview(nextOverview)
        setNotes(notesResponse.notes)
        setSessionSummaries(nextSessionSummaries)
        setSessionNotes(nextSessionNotes)
        setSelectedSessionName(
          shouldRefreshSelectedSession ? currentSessionName : null,
        )
        setCampaignDraft(createCampaignDraft(nextOverview.campaign))

        const fallbackNoteId = notesResponse.notes[0]?.id ?? null
        const currentSelection = selectedNoteIdRef.current
        const currentBrowseMode = noteBrowseModeRef.current
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
        const nextDisplayedNotes =
          currentBrowseMode === 'sessions' && shouldRefreshSelectedSession
            ? nextSessionNotes
            : notesResponse.notes
        const sessionFallbackNote =
          currentBrowseMode === 'sessions' && shouldRefreshSelectedSession
            ? nextDisplayedNotes[0] ?? null
            : null
        const resolvedActiveNote =
          activeNote &&
          (currentBrowseMode !== 'sessions' ||
            !shouldRefreshSelectedSession ||
            nextDisplayedNotes.some((note) => note.id === activeNote.id))
            ? activeNote
            : sessionFallbackNote

        if (resolvedActiveNote) {
          setSelectedNoteId(resolvedActiveNote.id)
          setIsCreating(false)
          setSelectedNoteTemplateId(blankNoteTemplateId)
          setDraft(createDraftFromNote(resolvedActiveNote))
        } else {
          setSelectedNoteId(null)
          setIsCreating(true)
          setSelectedNoteTemplateId(blankNoteTemplateId)
          setDraft(createEmptyDraft())
        }

        setError(null)
        return true
      } catch (loadError) {
        if (!suppressError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load the campaign workspace.',
          )
        }

        return false
      } finally {
        setIsLoadingWorkspace(false)
      }
    },
    [],
  )

  const loadSharedWorkspace = useCallback(
    async (
      activeGuestToken: string,
      preferredNoteId?: string | null,
      accessLevel?: CampaignShareLink['accessLevel'],
    ) => {
      setIsLoadingWorkspace(true)

      try {
        const [nextOverview, notesResponse] = await Promise.all([
          fetchSharedOverview(shareToken as string, activeGuestToken),
          fetchSharedNotes(shareToken as string, activeGuestToken),
        ])

        setOverview(nextOverview)
        setSharedCampaign(nextOverview.campaign)
        setSelectedCampaignId(nextOverview.campaign.id)
        setCampaigns([nextOverview.campaign])
        setNotes(notesResponse.notes)

        const fallbackNoteId = notesResponse.notes[0]?.id ?? null
        const currentSelection = selectedNoteIdRef.current
        const nextSelectedId =
          preferredNoteId !== undefined
            ? preferredNoteId
            : currentSelection && notesResponse.notes.some((note) => note.id === currentSelection)
              ? currentSelection
              : fallbackNoteId

        const activeNote =
          nextSelectedId !== null
            ? notesResponse.notes.find((note) => note.id === nextSelectedId) ?? null
            : null

        if (activeNote) {
          setSelectedNoteId(activeNote.id)
          setIsCreating(false)
          setSelectedNoteTemplateId(blankNoteTemplateId)
          setDraft(createDraftFromNote(activeNote))
        } else {
          setSelectedNoteId(null)
          setIsCreating((accessLevel ?? shareLink?.accessLevel) === 'editor')
          setSelectedNoteTemplateId(blankNoteTemplateId)
          setDraft(createEmptyDraft())
        }

        setError(null)
        return true
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load the shared campaign workspace.',
        )
        return false
      } finally {
        setIsLoadingWorkspace(false)
      }
    },
    [shareLink?.accessLevel, shareToken],
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

  const handleRefreshAdminOverview = useCallback(async () => {
    if (!authToken) {
      return
    }

    setIsLoadingAdminOverview(true)

    try {
      const [nextOverview, nextAccounts] = await Promise.all([
        fetchAdminOverview(authToken),
        fetchAdminAccounts(authToken),
      ])
      setAdminOverview(nextOverview)
      setAdminAccounts(nextAccounts)
      setAdminError(null)
    } catch (loadError) {
      setAdminError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load site-admin data.',
      )
    } finally {
      setIsLoadingAdminOverview(false)
    }
  }, [authToken])

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
    if (isSharedMode || !authToken || !owner?.isSiteAdmin) {
      setAdminAccounts([])
      setAdminOverview(null)
      setAdminError(null)
      setIsLoadingAdminOverview(false)
      return
    }

    let cancelled = false

    const loadSiteAdminOverview = async () => {
      setIsLoadingAdminOverview(true)

      try {
        const [nextOverview, nextAccounts] = await Promise.all([
          fetchAdminOverview(authToken),
          fetchAdminAccounts(authToken),
        ])

        if (cancelled) {
          return
        }

        setAdminAccounts(nextAccounts)
        setAdminOverview(nextOverview)
        setAdminError(null)
      } catch (loadError) {
        if (cancelled) {
          return
        }

        setAdminAccounts([])
        setAdminOverview(null)
        setAdminError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load site-admin data.',
        )
      } finally {
        if (!cancelled) {
          setIsLoadingAdminOverview(false)
        }
      }
    }

    void loadSiteAdminOverview()

    return () => {
      cancelled = true
    }
  }, [authToken, isSharedMode, owner?.isSiteAdmin])

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
          setDraft(createEmptyDraft())
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

  const handleShareLinkDraftChange = <Field extends keyof ShareLinkDraft>(
    field: Field,
    value: ShareLinkDraft[Field],
  ) => {
    setShareLinkDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))
  }

  const handleSelectNote = (note: Note) => {
    if (!showSplitNoteWorkspace) {
      setNarrowWorkspacePanel('editor')
    }

    setSelectedNoteId(note.id)
    setIsCreating(false)
    setSelectedNoteTemplateId(blankNoteTemplateId)
    setDraft(createDraftFromNote(note))
    setError(null)
  }

  const handleMembershipConsolidationDraftChange = <
    Field extends keyof MembershipConsolidationDraft,
  >(
    field: Field,
    value: MembershipConsolidationDraft[Field],
  ) => {
    setMembershipConsolidationDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
      ...(field === 'confirmRoleMismatch'
        ? {}
        : { confirmRoleMismatch: false }),
    }))

    if (field !== 'confirmRoleMismatch') {
      setMembershipConsolidationPreview(null)
      setMembershipConsolidationNotice(null)
    }

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

    setShowSplitNoteWorkspace(false)
    setNoteBrowseMode('notes')
    setNarrowWorkspacePanel('editor')
    resetSessionBrowserState()
    setSelectedTagFilter(null)
    setSearchText('')
    setSelectedNoteId(null)
    setIsCreating(true)
    setSelectedNoteTemplateId(blankNoteTemplateId)
    setDraft(createEmptyDraft())
    setError(null)
  }

  const handleQuickCapture = async () => {
    const trimmedTitle = quickCaptureTitle.trim()

    if (isSharedMode) {
      if (!guestToken || !trimmedTitle || !canEditWorkspace) {
        return
      }

      setError(null)
      setIsQuickCapturing(true)

      try {
        const createdNote = await createSharedNote(shareToken as string, guestToken, {
          title: trimmedTitle,
        })
        setQuickCaptureTitle('')
        await loadSharedWorkspace(guestToken, createdNote.id)
        setNarrowWorkspacePanel('editor')
      } catch (captureError) {
        setError(
          captureError instanceof Error ? captureError.message : 'Could not capture the note.',
        )
      } finally {
        setIsQuickCapturing(false)
      }

      return
    }

    if (!authToken || !selectedCampaignId || !trimmedTitle) {
      return
    }

    setError(null)
    setIsQuickCapturing(true)

    try {
      const createdNote = await createNote(authToken, {
        title: trimmedTitle,
        campaignId: selectedCampaignId,
      })

      setQuickCaptureTitle('')
      setIsQuickCaptureOpen(false)
      setNoteBrowseMode('notes')
      resetSessionBrowserState()
      await loadWorkspace(authToken, selectedCampaignId, createdNote.id)
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
    setSelectedNoteTemplateId(templateId)
    setError(null)

    if (templateId === blankNoteTemplateId) {
      setDraft(createEmptyDraft())
      return
    }

    const template = getNoteStarterTemplate(templateId)

    if (template.starterNote) {
      setDraft(createDraftFromStarterNote(template.starterNote))
    }
  }

  const handleDraftTagsChange = (nextTags: readonly string[]) => {
    handleDraftChange('tagsText', createTagsText(nextTags))
  }

  const commitPendingTagInput = () => {
    if (!tagInputValue.trim()) {
      return
    }

    handleDraftTagsChange([...draftTags, tagInputValue])
  }

  const handleSaveNote = async () => {
    if (isSharedMode) {
      if (!guestToken || !selectedCampaignId || !canEditWorkspace) {
        return
      }

      setError(null)
      setIsSaving(true)

      try {
        const payload = createNotePayload(draft, null)

        if (isCreating || !selectedNoteId) {
          const createdNote = await createSharedNote(shareToken as string, guestToken, payload)
          await loadSharedWorkspace(guestToken, createdNote.id)
        } else {
          const updatedNote = await updateSharedNote(
            shareToken as string,
            guestToken,
            selectedNoteId,
            payload,
          )
          await loadSharedWorkspace(guestToken, updatedNote.id)
        }
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : 'Could not save the shared note.',
        )
      } finally {
        setIsSaving(false)
      }

      return
    }

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

      if (noteBrowseModeRef.current === 'activity') {
        await loadActivity(
          authToken,
          selectedCampaignId,
          selectedActivityMembershipIdRef.current,
        )
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
    if (isSharedMode) {
      if (!guestToken || !selectedNoteId || !canEditWorkspace) {
        return
      }

      setError(null)
      setIsDeleting(true)

      try {
        await deleteSharedNote(shareToken as string, guestToken, selectedNoteId)
        await loadSharedWorkspace(guestToken, null)
        setNarrowWorkspacePanel('browse')
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : 'Could not delete the shared note.',
        )
      } finally {
        setIsDeleting(false)
      }

      return
    }

    if (!authToken || !selectedCampaignId || !selectedNoteId) {
      return
    }

    setError(null)
    setIsDeleting(true)

    try {
      await deleteNote(authToken, selectedNoteId)
      await loadWorkspace(authToken, selectedCampaignId, null)

      if (noteBrowseModeRef.current === 'activity') {
        await loadActivity(
          authToken,
          selectedCampaignId,
          selectedActivityMembershipIdRef.current,
        )
      }
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
      if (isKeycloakAuthConfig(authConfig)) {
        const keycloakClient = keycloakClientRef.current

        if (!keycloakClient) {
          throw new Error(missingKeycloakClientErrorMessage)
        }

        await keycloakClient.login(window.location.href)
        return
      }

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
      setIsAuthReady(true)
    }
  }

  const handleLogout = async () => {
    const keycloakClient = keycloakClientRef.current

    if (isKeycloakAuthConfig(authConfig) && keycloakClient) {
      clearSession()
      setShowSplitNoteWorkspace(false)
      setIsQuickCaptureOpen(false)
      setError(null)
      await keycloakClient.logout(`${window.location.origin}/`)
      return
    }

    if (isSharedMode) {
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
      if (guestStorageKey) {
        localStorage.removeItem(guestStorageKey)
      }
      window.location.assign('/')
      return
    }

    if (authToken) {
      try {
        await logoutOwner(authToken)
      } catch {
        // Intentionally ignore logout failures because local sign-out should still work.
      }
    }

    clearSession()
    setShowSplitNoteWorkspace(false)
    setIsQuickCaptureOpen(false)
    setError(null)
    setIsRegisterMode(false)
  }

  const handleOpenCampaignCreate = () => {
    setCampaignDraft(createCampaignDraft())
    setSelectedCampaignTemplateId(blankCampaignTemplateId)
    setMemberships([])
    setShareLinks([])
    setShareLinkDraft(createShareLinkDraft())
    resetShareLinkInteractionState()
    resetMembershipConsolidationState()
    setCampaignFormMode('create')
    setError(null)
  }

  const handleOpenCampaignSettings = () => {
    if (!canManageSelectedCampaign) {
      setError('Campaign settings are only available to campaign owners.')
      return
    }

    setCampaignDraft(createCampaignDraft(selectedCampaign))
    setSelectedCampaignTemplateId(blankCampaignTemplateId)
    setShareLinkDraft(createShareLinkDraft())
    resetShareLinkInteractionState()
    resetMembershipConsolidationState()
    setCampaignFormMode('edit')
    setError(null)
  }

  const handleCancelCampaignForm = () => {
    setCampaignDraft(createCampaignDraft(selectedCampaign))
    setCampaignFormMode(campaigns.length === 0 ? 'create' : 'closed')
    setSelectedCampaignTemplateId(blankCampaignTemplateId)
    setShareLinkDraft(createShareLinkDraft())
    resetShareLinkInteractionState()
    resetMembershipConsolidationState()
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
      let starterTemplateError: string | null = null

      if (campaignFormMode === 'create') {
        const createdCampaign = await createCampaign(authToken, payload)

        if (selectedCampaignTemplateId !== blankCampaignTemplateId) {
          try {
            for (const starterNote of selectedCampaignTemplate.starterNotes) {
              await createNote(
                authToken,
                createStarterNoteInput(starterNote, createdCampaign.id),
              )
            }
          } catch {
            starterTemplateError =
              'Campaign created, but the starter notes could not be added. You can still add notes manually.'
          }
        }

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
      setSelectedCampaignTemplateId(blankCampaignTemplateId)

      if (starterTemplateError) {
        setError(starterTemplateError)
      }
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

  const handleCreateShareLink = async () => {
    if (!authToken || !selectedCampaignId) {
      return
    }

    setError(null)
    setIsCreatingShareLink(true)

    try {
      const created = await createCampaignShareLink(
        authToken,
        selectedCampaignId,
        createShareLinkPayload(shareLinkDraft),
      )

      setShareLinks((currentLinks) => [created.shareLink, ...currentLinks])
      setShareLinkDraft(createShareLinkDraft())
      resetShareLinkInteractionState()
      setShareLinkNotice(
        'Shared link created. Reveal it on the card when you need to copy it again.',
      )
    } catch (shareLinkError) {
      setError(
        shareLinkError instanceof Error
          ? shareLinkError.message
          : 'Could not create the share link.',
      )
    } finally {
      setIsCreatingShareLink(false)
    }
  }

  const handlePreviewMembershipConsolidation = async () => {
    if (
      !authToken ||
      !selectedCampaignId ||
      !membershipConsolidationDraft.sourceMembershipId ||
      !membershipConsolidationDraft.targetMembershipId ||
      membershipConsolidationDraft.sourceMembershipId ===
        membershipConsolidationDraft.targetMembershipId
    ) {
      return
    }

    setError(null)
    setMembershipConsolidationNotice(null)
    setIsPreviewingMembershipConsolidation(true)

    try {
      const response = await consolidateCampaignMemberships(authToken, selectedCampaignId, {
        sourceMembershipId: membershipConsolidationDraft.sourceMembershipId,
        targetMembershipId: membershipConsolidationDraft.targetMembershipId,
      })

      setMembershipConsolidationPreview(response.consolidation)
    } catch (consolidationError) {
      setError(
        consolidationError instanceof Error
          ? consolidationError.message
          : 'Could not preview the consolidation.',
      )
    } finally {
      setIsPreviewingMembershipConsolidation(false)
    }
  }

  const handleApplyMembershipConsolidation = async () => {
    if (
      !authToken ||
      !selectedCampaignId ||
      !membershipConsolidationPreview ||
      membershipConsolidationPreview.applied
    ) {
      return
    }

    setError(null)
    setMembershipConsolidationNotice(null)
    setIsApplyingMembershipConsolidation(true)

    let response: Awaited<
      ReturnType<typeof consolidateCampaignMemberships>
    >

    try {
      response = await consolidateCampaignMemberships(authToken, selectedCampaignId, {
        sourceMembershipId: membershipConsolidationDraft.sourceMembershipId,
        targetMembershipId: membershipConsolidationDraft.targetMembershipId,
        confirm: true,
        confirmRoleMismatch: membershipConsolidationDraft.confirmRoleMismatch,
      })

      setMembershipConsolidationPreview(response.consolidation)
      setMembershipConsolidationNotice(
        `Moved note attribution from ${response.consolidation.sourceMembership.displayName} to ${response.consolidation.targetMembership.displayName}.`,
      )
    } catch (consolidationError) {
      setError(
        consolidationError instanceof Error
          ? consolidationError.message
          : 'Could not apply the consolidation.',
      )
      setIsApplyingMembershipConsolidation(false)
      return
    }

    setMembershipConsolidationPreview(response.consolidation)
    setMembershipConsolidationNotice(
      `Moved note attribution from ${response.consolidation.sourceMembership.displayName} to ${response.consolidation.targetMembership.displayName}.`,
    )

    const refreshed = await loadWorkspace(
      authToken,
      selectedCampaignId,
      selectedNoteIdRef.current,
      true,
    )

    if (!refreshed) {
      setError(
        'Consolidation succeeded, but the workspace could not refresh. Reload the page to see the latest note attribution.',
      )
    }

    setIsApplyingMembershipConsolidation(false)
  }

  const handleRevealShareLink = async (shareLinkId: string) => {
    if (!authToken || !selectedCampaignId) {
      return
    }

    setError(null)
    setShareLinkNotice(null)
    setCopiedShareLinkId((currentId) =>
      currentId === shareLinkId ? null : currentId,
    )
    setShareLinkActionErrors((currentErrors) =>
      deleteRecordKey(currentErrors, shareLinkId),
    )
    setRevealingShareLinkId(shareLinkId)

    try {
      const revealed = await revealCampaignShareLink(
        authToken,
        selectedCampaignId,
        shareLinkId,
      )

      setRevealedShareLinks((currentLinks) => ({
        ...currentLinks,
        [shareLinkId]: {
          url: revealed.url,
          isVisible: false,
        },
      }))
    } catch (shareLinkError) {
      setShareLinkActionErrors((currentErrors) => ({
        ...currentErrors,
        [shareLinkId]:
          shareLinkError instanceof Error
            ? shareLinkError.message
            : 'Could not reveal the shared link.',
      }))
    } finally {
      setRevealingShareLinkId((currentId) =>
        currentId === shareLinkId ? null : currentId,
      )
    }
  }

  const handleToggleShareLinkVisibility = (shareLinkId: string) => {
    setRevealedShareLinks((currentLinks) => {
      const revealedShareLink = currentLinks[shareLinkId]

      if (!revealedShareLink) {
        return currentLinks
      }

      return {
        ...currentLinks,
        [shareLinkId]: {
          ...revealedShareLink,
          isVisible: !revealedShareLink.isVisible,
        },
      }
    })
  }

  const handleCopyShareLink = async (shareLinkId: string) => {
    const revealedShareLink = revealedShareLinks[shareLinkId]

    if (!revealedShareLink) {
      return
    }

    setError(null)
    setShareLinkNotice(null)

    try {
      await copyTextToClipboard(revealedShareLink.url)
      setShareLinkActionErrors((currentErrors) =>
        deleteRecordKey(currentErrors, shareLinkId),
      )
      setCopiedShareLinkId(shareLinkId)
    } catch (shareLinkError) {
      setShareLinkActionErrors((currentErrors) => ({
        ...currentErrors,
        [shareLinkId]:
          shareLinkError instanceof Error
            ? shareLinkError.message
            : 'Could not copy the shared link.',
      }))
    }
  }

  const handleRevokeShareLink = async (shareLinkId: string) => {
    if (!authToken || !selectedCampaignId) {
      return
    }

    setError(null)

    try {
      await revokeCampaignShareLink(authToken, selectedCampaignId, shareLinkId)
      setShareLinks((currentLinks) =>
        currentLinks.filter((shareLink) => shareLink.id !== shareLinkId),
      )
      setRevealedShareLinks((currentLinks) =>
        deleteRecordKey(currentLinks, shareLinkId),
      )
      setShareLinkActionErrors((currentErrors) =>
        deleteRecordKey(currentErrors, shareLinkId),
      )
      setCopiedShareLinkId((currentId) =>
        currentId === shareLinkId ? null : currentId,
      )
      setShareLinkNotice(null)
    } catch (shareLinkError) {
      setError(
        shareLinkError instanceof Error
          ? shareLinkError.message
          : 'Could not revoke the share link.',
      )
    }
  }

  const handleSelectCampaign = async (campaignId: string) => {
    if (!authToken) {
      return
    }

    setCampaignFormMode('closed')
    setShowSplitNoteWorkspace(false)
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
    setShowSplitNoteWorkspace(false)
    setNarrowWorkspacePanel('browse')
  }

  const handleShowEditorPane = () => {
    setShowSplitNoteWorkspace(false)
    setNarrowWorkspacePanel('editor')
  }

  const handleToggleSplitWorkspace = () => {
    if (!canSplitNoteWorkspace) {
      return
    }

    setShowSplitNoteWorkspace((currentValue) => {
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
                      {isKeycloakMode
                        ? 'Sign in to your campaigns'
                        : isRegisterMode
                          ? 'Create your owner account'
                          : 'Sign in to your campaigns'}
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 2 }}>
                      {isKeycloakMode
                        ? 'Use your tenant account to access campaigns. Campaign authorization stays local to this tenant.'
                        : 'Finish setting up campaigns, manage campaign details, and keep note workflows scoped to the right table.'}
                    </Typography>
                  </Box>

                  {error ? (
                    <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
                      {error}
                    </Alert>
                  ) : null}

                  {!isKeycloakMode && isRegisterMode ? (
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

                  {!isKeycloakMode ? (
                    <>
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
                    </>
                  ) : null}

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Button
                      variant="contained"
                      onClick={handleSubmitAuth}
                      disabled={isSubmittingAuth}
                    >
                      {isSubmittingAuth
                        ? isKeycloakMode
                          ? 'Signing in…'
                          : isRegisterMode
                            ? 'Creating account…'
                            : 'Signing in…'
                        : isKeycloakMode
                          ? 'Continue'
                          : isRegisterMode
                            ? 'Create owner account'
                            : 'Sign in'}
                    </Button>
                    {!isKeycloakMode ? (
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
                    ) : null}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </Box>
    )
  }

  if (!isSharedMode && (campaigns.length === 0 || (!selectedCampaignId && campaignFormMode === 'create'))) {
    return (
      <Box component="main" sx={{ minHeight: '100vh', py: { xs: 4, md: 6 } }}>
        <Container maxWidth="md">
          <Stack spacing={3}>
            {owner?.isSiteAdmin ? (
              <SiteAdminPanel
                accounts={adminAccounts}
                overview={adminOverview}
                isLoading={isLoadingAdminOverview}
                error={adminError}
                onRefresh={() => void handleRefreshAdminOverview()}
                surfaceRadius={surfaceRadius}
              />
            ) : null}
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

                  <Stack spacing={1.5}>
                    <TextField
                      select
                      label="Campaign starter"
                      value={selectedCampaignTemplateId}
                      onChange={(event) =>
                        setSelectedCampaignTemplateId(event.target.value)
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
                      {isSavingCampaign ? 'Creating campaign…' : 'Create campaign'}
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
                  void handleSelectCampaign(campaignId)
                }
              }}
              actions={[
                {
                  ariaLabel: 'New campaign',
                  color: 'inherit',
                  icon: <AddCircleOutlineRoundedIcon fontSize="small" />,
                  onClick: isSharedMode ? () => window.location.assign('/') : handleOpenCampaignCreate,
                },
                {
                  ariaLabel: 'Campaign settings',
                  color: 'inherit',
                  icon: <SettingsRoundedIcon fontSize="small" />,
                  onClick: isSharedMode ? () => window.location.assign('/') : handleOpenCampaignSettings,
                  disabled: isSharedMode ? resolvedMembership?.userId === null : !canManageSelectedCampaign,
                },
                {
                  ariaLabel: 'New note',
                  color: 'secondary',
                  icon: <AddRoundedIcon fontSize="small" />,
                  onClick: handleStartNote,
                  disabled: !canEditWorkspace,
                },
                {
                  ariaLabel: 'Sign out',
                  color: 'inherit',
                  icon: <LogoutRoundedIcon fontSize="small" />,
                  onClick: handleLogout,
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

          {!isSharedMode && owner?.isSiteAdmin ? (
            <SiteAdminPanel
              accounts={adminAccounts}
              overview={adminOverview}
              isLoading={isLoadingAdminOverview}
              error={adminError}
              onRefresh={() => void handleRefreshAdminOverview()}
              surfaceRadius={surfaceRadius}
            />
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
                        setRegisterDraft((currentDraft) => ({
                          ...currentDraft,
                          displayName: event.target.value,
                        }))
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
                            setRegisterDraft((currentDraft) => ({
                              ...currentDraft,
                              email: value,
                            }))
                          } else {
                            setLoginDraft((currentDraft) => ({ ...currentDraft, email: value }))
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
                    </>
                  ) : null}

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Button variant="contained" onClick={handleLinkSharedMembership} disabled={isLinkingAccount}>
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
                          setSelectedCampaignTemplateId(event.target.value)
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
                                handleMembershipConsolidationDraftChange(
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
                                handleMembershipConsolidationDraftChange(
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
                              onClick={handlePreviewMembershipConsolidation}
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
                              onClick={handleApplyMembershipConsolidation}
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
                                  {'->'}{' '}
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
                                          handleMembershipConsolidationDraftChange(
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
                            handleShareLinkDraftChange('label', event.target.value)
                          }
                          helperText="Optional. Use this to remember where the link is shared."
                        />
                        <TextField
                          select
                          label="Access"
                          value={shareLinkDraft.accessLevel}
                          onChange={(event) =>
                            handleShareLinkDraftChange(
                              'accessLevel',
                              event.target.value as ShareAccessLevel,
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
                          handleShareLinkDraftChange('frameAncestors', event.target.value)
                        }
                        helperText="Optional. Use 'self', 'none', or space-separated origins such as https://app.roll20.net."
                      />

                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        <Button
                          variant="outlined"
                          onClick={handleCreateShareLink}
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
                            const shareLinkLabel = formatFallbackText(
                              shareLink.label,
                              'Untitled shared link',
                            )

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
                                            handleToggleShareLinkVisibility(shareLink.id)
                                          }
                                        >
                                          {revealedShareLink.isVisible
                                            ? 'Hide link'
                                            : 'Show link'}
                                        </Button>
                                        <Button
                                          variant="outlined"
                                          onClick={() =>
                                            void handleCopyShareLink(shareLink.id)
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
                                          void handleRevealShareLink(shareLink.id)
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
                                      onClick={() => void handleRevokeShareLink(shareLink.id)}
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
                      onClick={handleSaveCampaign}
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
              onShowBrowsePane={handleShowBrowsePane}
              onShowEditorPane={handleShowEditorPane}
              onToggleSplitWorkspace={handleToggleSplitWorkspace}
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
                      onClick={handleOpenAllNotes}
                    >
                      All notes
                    </Button>
                    <Button
                      size="small"
                      variant={noteBrowseMode === 'sessions' ? 'contained' : 'outlined'}
                      onClick={handleOpenSessionBrowser}
                    >
                      Browse by session
                    </Button>
                    <Button
                      size="small"
                      variant={noteBrowseMode === 'activity' ? 'contained' : 'outlined'}
                      onClick={() => void handleOpenRecentActivity()}
                    >
                      Recent activity
                    </Button>
                    <Button
                      size="small"
                      variant={isQuickCaptureOpen ? 'contained' : 'outlined'}
                      startIcon={<BoltRoundedIcon />}
                      onClick={() => setIsQuickCaptureOpen((currentValue) => !currentValue)}
                      disabled={!canEditWorkspace}
                    >
                      Quick capture
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<AddRoundedIcon />}
                      onClick={handleStartNote}
                      disabled={!canEditWorkspace}
                    >
                      New note
                    </Button>
                  </>
                }
                searchText={searchText}
                onSearchTextChange={setSearchText}
                onClearSearch={handleClearSearch}
                selectedTagLabel={
                  selectedTagFacet
                    ? `Filtering by ${selectedTagFacet.tag} (${selectedTagFacet.count})`
                    : null
                }
                onClearTagFilter={handleClearTagFilter}
                quickCapture={{
                  isOpen: isQuickCaptureOpen,
                  value: quickCaptureTitle,
                  onValueChange: setQuickCaptureTitle,
                  onSubmit: () => void handleQuickCapture(),
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
                          onClick={() => handleSelectTagFilter(tagFacet.tag)}
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
                            onClick={() => void handleSelectActivityCollaborator(null)}
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
                                void handleSelectActivityCollaborator(
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
                              onClick={() => void handleSelectActivityCollaborator(null)}
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
                              onClick={() => handleSelectNote(activityEntry)}
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
                        a quick “what happened in this session?” view.
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
                              void handleSelectSession(sessionSummary.sessionName)
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
                          <Button variant="text" onClick={handleOpenSessionBrowser}>
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
                              onClick={handleStartNote}
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
              <Stack spacing={3} sx={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
                <Card sx={{ borderRadius: surfaceRadius, minWidth: 0, width: '100%', maxWidth: '100%' }}>
                  <CardContent sx={{ p: 3, minWidth: 0 }}>
                    <Stack spacing={2.5} sx={{ minWidth: 0 }}>
                      {isSinglePaneNoteWorkspace ? (
                        <Button
                          variant="text"
                          size="small"
                          startIcon={<ArrowBackRoundedIcon />}
                          onClick={() => setNarrowWorkspacePanel('browse')}
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
                              ? `Every save is scoped to ${resolvedCampaign?.name ?? overview.campaign.name}. You are currently reviewing ${selectedSessionName}.`
                              : `Every save is scoped to ${resolvedCampaign?.name ?? overview.campaign.name}, so each campaign can keep its own note trail.`}
                        </Typography>
                      </Box>

                    {isCreating && canEditWorkspace ? (
                      <Stack spacing={1.5}>
                        <TextField
                          select
                          label="Note template"
                          value={selectedNoteTemplateId}
                          onChange={(event) =>
                            handleSelectNoteTemplate(event.target.value)
                          }
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
                      onChange={(event) =>
                        handleDraftChange('title', event.target.value)
                      }
                      slotProps={{ input: { readOnly: !canEditWorkspace } }}
                    />

                    <TextField
                      label="Session name"
                      value={draft.sessionName}
                      onChange={(event) =>
                        handleDraftChange('sessionName', event.target.value)
                      }
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

                          setTagInputValue(value)
                        }}
                        onChange={(_, value) => {
                          handleDraftTagsChange(value)
                          setTagInputValue('')
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Tags"
                            helperText="Reuse existing tags or type new ones. Press Enter, comma, or blur to commit."
                            onBlur={commitPendingTagInput}
                            onKeyDown={(event) => {
                              if (
                                (event.key === 'Enter' || event.key === ',') &&
                                tagInputValue.trim()
                              ) {
                                event.preventDefault()
                                commitPendingTagInput()
                              }
                            }}
                          />
                        )}
                      />
                    ) : (
                      <TextField label="Tags" value={createTagsText(draftTags)} slotProps={{ input: { readOnly: true } }} />
                    )}

                    <TextField
                      select
                      label="Status"
                      value={draft.status}
                      onChange={(event) =>
                        handleDraftChange('status', event.target.value as NoteStatus)
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
                        onChange={(value) => handleDraftChange('body', value)}
                        surfaceRadius={surfaceRadius}
                        noteOptions={noteLinkOptions}
                      />
                    ) : (
                      <Stack spacing={1}>
                        <Typography variant="subtitle1">Body</Typography>
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: surfaceRadius, p: { xs: 2, sm: 2.5 } }}>
                          <NoteBodyPreview ariaLabel="Note body preview" body={draft.body} emptyMessage="Nothing to preview yet." />
                        </Box>
                      </Stack>
                    )}

                    <NoteEditorActions
                      canEditWorkspace={canEditWorkspace}
                      isCreating={isCreating}
                      isSaving={isSaving}
                      isDeleting={isDeleting}
                      selectedNoteUpdatedAt={selectedNote?.updatedAt}
                      onSave={handleSaveNote}
                      onDelete={handleDeleteNote}
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
                                  onClick={() => handleSelectNote(note)}
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
                                      {excerpt(note.body)}
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
                                  onClick={() => handleSelectNote(note)}
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
                                      {excerpt(note.body)}
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

export default App
