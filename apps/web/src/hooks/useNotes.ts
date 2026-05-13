import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  createNote,
  createSharedNote,
  deleteNote,
  deleteSharedNote,
  fetchNoteActivity,
  fetchNotes,
  fetchOverview,
  fetchSessionNotes,
  fetchSessions,
  fetchSharedNotes,
  fetchSharedOverview,
  updateNote,
  updateSharedNote,
} from '../api'
import {
  blankNoteTemplateId,
  getNoteStarterTemplate,
  noteStarterTemplates,
} from '../templates'
import { extractInlineNoteReferences } from '../note-references'
import { markdownToPlainText } from '../note-excerpts'
import type {
  ActivityCollaborator,
  Note,
  NoteActivityEntry,
  NoteInput,
  NoteStatus,
  NotesOverview,
  SessionSummary,
} from '../types'

export type NoteBrowseMode = 'notes' | 'sessions' | 'activity'

export interface NoteDraft {
  title: string
  body: string
  tagsText: string
  status: NoteStatus
  sessionName: string
  linkedNoteIds: string[]
}

export interface TagFacet {
  tag: string
  count: number
}

export interface NoteLinkPanelItem {
  note: Note
  qualifiers: string[]
}

export { blankNoteTemplateId, getNoteStarterTemplate, noteStarterTemplates }

export function createEmptyDraft(): NoteDraft {
  return {
    title: '',
    body: '',
    tagsText: '',
    status: 'draft',
    sessionName: '',
    linkedNoteIds: [],
  }
}

export function normalizeTags(rawTags: readonly string[]): string[] {
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

export function createTagsText(tags: readonly string[]): string {
  return normalizeTags(tags).join(', ')
}

export function createDraftFromNote(note: Note): NoteDraft {
  return {
    title: note.title,
    body: note.body,
    tagsText: createTagsText(note.tags),
    status: note.status,
    sessionName: note.sessionName ?? '',
    linkedNoteIds: note.linkedNoteIds ?? [],
  }
}

export function getNoteDisplayTitle(note: Pick<Note, 'title' | 'id'>): string {
  const trimmed = note.title.trim()
  return trimmed === '' ? note.id : trimmed
}

interface ResolvedNoteLink {
  targetNoteId: string
  qualifiers: string[]
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

export function formatResolvedRelationshipText(
  originTitle: string,
  qualifiers: readonly string[],
  targetTitle: string,
): string | null {
  if (qualifiers.length === 0) {
    return null
  }

  return `${originTitle} ${qualifiers.join(' / ')} ${targetTitle}`
}

function trimToNull(value: string): string | null {
  const trimmedValue = value.trim()
  return trimmedValue === '' ? null : trimmedValue
}

function createNotePayload(draft: NoteDraft, campaignId: string | null): NoteInput {
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

const sessionNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

const tagFacetCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
})

function sortSessionSummaries(sessions: SessionSummary[]): SessionSummary[] {
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

const recentActivityLimit = 20

export interface UseNotesResult {
  overview: NotesOverview | null
  notes: Note[]
  noteBrowseMode: NoteBrowseMode
  sessionSummaries: SessionSummary[]
  selectedSessionName: string | null
  sessionNotes: Note[]
  activityEntries: NoteActivityEntry[]
  activityCollaborators: ActivityCollaborator[]
  selectedActivityMembershipId: string | null
  selectedTagFilter: string | null
  searchText: string
  deferredSearchText: string
  draft: NoteDraft
  tagInputValue: string
  selectedNoteId: string | null
  isCreating: boolean
  isLoadingWorkspace: boolean
  isLoadingSessionNotes: boolean
  isLoadingActivity: boolean
  isQuickCapturing: boolean
  isSaving: boolean
  isDeleting: boolean
  selectedNoteTemplateId: string
  quickCaptureTitle: string
  isQuickCaptureOpen: boolean
  // Derived state
  selectedNote: Note | null
  filteredNotes: Note[]
  displayedNotes: Note[]
  tagFacets: TagFacet[]
  draftTags: string[]
  noteLinkOptions: { id: string; title: string }[]
  noteTitlesById: ReadonlyMap<string, string>
  linkedNotes: NoteLinkPanelItem[]
  backlinks: NoteLinkPanelItem[]
  sharedSessionSummaries: SessionSummary[]
  sharedSessionNotes: Note[]
  sharedActivityEntries: NoteActivityEntry[]
  sharedActivityCollaborators: ActivityCollaborator[]
  // Refs (for use in callbacks)
  selectedNoteIdRef: React.RefObject<string | null>
  noteBrowseModeRef: React.RefObject<NoteBrowseMode>
  selectedSessionNameRef: React.RefObject<string | null>
  selectedActivityMembershipIdRef: React.RefObject<string | null>
  activityRequestIdRef: React.RefObject<number>
  sessionRequestIdRef: React.RefObject<number>
  activityAbortControllerRef: React.RefObject<AbortController | null>
  sessionAbortControllerRef: React.RefObject<AbortController | null>
  // Setters
  setOverview: React.Dispatch<React.SetStateAction<NotesOverview | null>>
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  setNoteBrowseMode: React.Dispatch<React.SetStateAction<NoteBrowseMode>>
  setSessionSummaries: React.Dispatch<React.SetStateAction<SessionSummary[]>>
  setSelectedSessionName: React.Dispatch<React.SetStateAction<string | null>>
  setSessionNotes: React.Dispatch<React.SetStateAction<Note[]>>
  setActivityEntries: React.Dispatch<React.SetStateAction<NoteActivityEntry[]>>
  setActivityCollaborators: React.Dispatch<React.SetStateAction<ActivityCollaborator[]>>
  setSelectedActivityMembershipId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedTagFilter: React.Dispatch<React.SetStateAction<string | null>>
  setSearchText: React.Dispatch<React.SetStateAction<string>>
  setDraft: React.Dispatch<React.SetStateAction<NoteDraft>>
  setTagInputValue: React.Dispatch<React.SetStateAction<string>>
  setSelectedNoteId: React.Dispatch<React.SetStateAction<string | null>>
  setIsCreating: React.Dispatch<React.SetStateAction<boolean>>
  setIsLoadingWorkspace: React.Dispatch<React.SetStateAction<boolean>>
  setIsLoadingSessionNotes: React.Dispatch<React.SetStateAction<boolean>>
  setIsLoadingActivity: React.Dispatch<React.SetStateAction<boolean>>
  setIsQuickCapturing: React.Dispatch<React.SetStateAction<boolean>>
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>
  setIsDeleting: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedNoteTemplateId: React.Dispatch<React.SetStateAction<string>>
  setQuickCaptureTitle: React.Dispatch<React.SetStateAction<string>>
  setIsQuickCaptureOpen: React.Dispatch<React.SetStateAction<boolean>>
  // Callbacks
  resetSessionBrowserState: () => void
  resetActivityState: (preserveFilter?: boolean) => void
  loadActivity: (
    sessionToken: string,
    campaignId: string,
    membershipId?: string | null,
    onError?: (message: string) => void,
  ) => Promise<void>
  loadWorkspace: (
    sessionToken: string,
    campaignId: string,
    preferredNoteId: string | null | undefined,
    suppressError?: boolean,
    onSetCampaignId?: (id: string) => void,
    onSetCampaignDraft?: (campaign: import('../types').CampaignSummary) => void,
    onError?: (message: string) => void,
  ) => Promise<boolean>
  loadSharedWorkspace: (
    shareToken: string,
    activeGuestToken: string,
    preferredNoteId: string | null | undefined,
    accessLevel?: import('../types').CampaignShareLink['accessLevel'],
    shareLink?: import('../types').CampaignShareLink | null,
    onSetCampaigns?: (campaign: import('../types').CampaignSummary) => void,
    onError?: (message: string) => void,
  ) => Promise<boolean>
  handleDraftChange: <Field extends keyof NoteDraft>(field: Field, value: NoteDraft[Field]) => void
  handleDraftTagsChange: (nextTags: readonly string[]) => void
  commitPendingTagInput: () => void
  handleSelectNote: (note: Note, onNarrowPanel?: () => void, onError?: () => void) => void
  handleStartNote: (canEdit: boolean, onNarrowPanel?: () => void, onError?: () => void) => void
  handleSelectNoteTemplate: (templateId: string, onError?: () => void) => void
  handleSaveNote: (
    isSharedMode: boolean,
    shareToken: string | null,
    guestToken: string | null,
    selectedCampaignId: string | null,
    authToken: string | null,
    canEditWorkspace: boolean,
    onNarrowPanel?: () => void,
    onError?: (message: string) => void,
  ) => Promise<void>
  handleDeleteNote: (
    isSharedMode: boolean,
    shareToken: string | null,
    guestToken: string | null,
    selectedCampaignId: string | null,
    authToken: string | null,
    canEditWorkspace: boolean,
    onNarrowPanel?: () => void,
    onError?: (message: string) => void,
  ) => Promise<void>
  handleQuickCapture: (
    isSharedMode: boolean,
    shareToken: string | null,
    guestToken: string | null,
    selectedCampaignId: string | null,
    authToken: string | null,
    canEditWorkspace: boolean,
    onNarrowPanel?: () => void,
    onError?: (message: string) => void,
  ) => Promise<void>
}

export function useNotes(isSharedMode: boolean): UseNotesResult {
  const [overview, setOverview] = useState<NotesOverview | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [noteBrowseMode, setNoteBrowseMode] = useState<NoteBrowseMode>('notes')
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummary[]>([])
  const [selectedSessionName, setSelectedSessionName] = useState<string | null>(null)
  const [sessionNotes, setSessionNotes] = useState<Note[]>([])
  const [activityEntries, setActivityEntries] = useState<NoteActivityEntry[]>([])
  const [activityCollaborators, setActivityCollaborators] = useState<ActivityCollaborator[]>([])
  const [selectedActivityMembershipId, setSelectedActivityMembershipId] = useState<
    string | null
  >(null)
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const deferredSearchText = useDeferredValue(searchText)
  const [draft, setDraft] = useState<NoteDraft>(createEmptyDraft)
  const [tagInputValue, setTagInputValue] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)
  const [isLoadingSessionNotes, setIsLoadingSessionNotes] = useState(false)
  const [isLoadingActivity, setIsLoadingActivity] = useState(false)
  const [isQuickCapturing, setIsQuickCapturing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectedNoteTemplateId, setSelectedNoteTemplateId] = useState(blankNoteTemplateId)
  const [quickCaptureTitle, setQuickCaptureTitle] = useState('')
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false)

  const noteBrowseModeRef = useRef<NoteBrowseMode>('notes')
  const selectedNoteIdRef = useRef<string | null>(null)
  const selectedSessionNameRef = useRef<string | null>(null)
  const selectedActivityMembershipIdRef = useRef<string | null>(null)
  const activityRequestIdRef = useRef(0)
  const sessionRequestIdRef = useRef(0)
  const activityAbortControllerRef = useRef<AbortController | null>(null)
  const sessionAbortControllerRef = useRef<AbortController | null>(null)

  // Sync refs with their corresponding state values
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


  // Cleanup: abort any in-flight requests on unmount
  useEffect(
    () => () => {
      activityAbortControllerRef.current?.abort()
      sessionAbortControllerRef.current?.abort()
    },
    [],
  )

  // Derived state
  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  )

  const sharedSessionSummaries = useMemo(
    () => createSessionSummariesFromNotes(notes),
    [notes],
  )

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

  const tagFacets = useMemo(() => createTagFacets(notes), [notes])

  const getNoteRelationshipSearchText = useCallback(
    (note: Note) => {
      const originTitle = getNoteDisplayTitle(note)

      return getResolvedNoteLinks(note)
        .flatMap((reference) => {
          const targetTitle = noteTitlesById.get(reference.targetNoteId) ?? reference.targetNoteId
          const relationshipText = formatResolvedRelationshipText(
            originTitle,
            reference.qualifiers,
            targetTitle,
          )

          return relationshipText ? [relationshipText] : []
        })
        .join(' ')
    },
    [noteTitlesById],
  )

  const noteSearchEntries = useMemo(
    () =>
      notes.map((note) => ({
        note,
        searchText: [
          getNoteDisplayTitle(note),
          markdownToPlainText(note.body),
          getNoteRelationshipSearchText(note),
          note.tags.join(' '),
          note.sessionName ?? '',
          note.createdBy?.displayName ?? '',
          note.lastEditedBy?.displayName ?? '',
        ]
          .join('\n')
          .toLowerCase(),
      })),
    [getNoteRelationshipSearchText, notes],
  )

  const filteredNotes = useMemo(() => {
    let entries = noteSearchEntries

    if (selectedTagFilter) {
      entries = entries.filter(({ note }) => note.tags.includes(selectedTagFilter))
    }

    const normalizedSearchText = deferredSearchText.trim().toLowerCase()

    if (normalizedSearchText) {
      entries = entries.filter(({ searchText: entrySearchText }) =>
        entrySearchText.includes(normalizedSearchText),
      )
    }

    return entries.map(({ note }) => note)
  }, [deferredSearchText, noteSearchEntries, selectedTagFilter])

  const resolvedSessionNotes = isSharedMode ? sharedSessionNotes : sessionNotes

  const displayedNotes = useMemo(
    () =>
      noteBrowseMode === 'sessions' && selectedSessionName
        ? resolvedSessionNotes
        : noteBrowseMode === 'notes'
          ? filteredNotes
          : notes,
    [filteredNotes, noteBrowseMode, notes, resolvedSessionNotes, selectedSessionName],
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

  // Callbacks
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
      onError?: (message: string) => void,
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
      } catch (loadError) {
        if (
          abortController.signal.aborted ||
          activityRequestIdRef.current !== requestId
        ) {
          return
        }

        setActivityEntries([])
        setActivityCollaborators([])
        onError?.(
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

  const loadWorkspace = useCallback(
    async (
      sessionToken: string,
      campaignId: string,
      preferredNoteId: string | null | undefined,
      suppressError = false,
      onSetCampaignId?: (id: string) => void,
      onSetCampaignDraft?: (campaign: import('../types').CampaignSummary) => void,
      onError?: (message: string) => void,
    ): Promise<boolean> => {
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

        onSetCampaignId?.(campaignId)
        onSetCampaignDraft?.(nextOverview.campaign)
        setOverview(nextOverview)
        setNotes(notesResponse.notes)
        setSessionSummaries(nextSessionSummaries)
        setSessionNotes(nextSessionNotes)
        setSelectedSessionName(
          shouldRefreshSelectedSession ? currentSessionName : null,
        )

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
          setTagInputValue('')
        } else {
          setSelectedNoteId(null)
          setIsCreating(true)
          setSelectedNoteTemplateId(blankNoteTemplateId)
          setDraft(createEmptyDraft())
          setTagInputValue('')
        }

        return true
      } catch (loadError) {
        if (!suppressError) {
          onError?.(
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
      shareToken: string,
      activeGuestToken: string,
      preferredNoteId: string | null | undefined,
      accessLevel?: import('../types').CampaignShareLink['accessLevel'],
      shareLink?: import('../types').CampaignShareLink | null,
      onSetCampaigns?: (campaign: import('../types').CampaignSummary) => void,
      onError?: (message: string) => void,
    ): Promise<boolean> => {
      setIsLoadingWorkspace(true)

      try {
        const [nextOverview, notesResponse] = await Promise.all([
          fetchSharedOverview(shareToken, activeGuestToken),
          fetchSharedNotes(shareToken, activeGuestToken),
        ])

        setOverview(nextOverview)
        onSetCampaigns?.(nextOverview.campaign)
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
          setTagInputValue('')
        } else {
          setSelectedNoteId(null)
          setIsCreating((accessLevel ?? shareLink?.accessLevel) === 'editor')
          setSelectedNoteTemplateId(blankNoteTemplateId)
          setDraft(createEmptyDraft())
          setTagInputValue('')
        }

        return true
      } catch (loadError) {
        onError?.(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load the shared campaign workspace.',
        )
        return false
      } finally {
        setIsLoadingWorkspace(false)
      }
    },
    [],
  )

  const handleDraftChange = useCallback(
    <Field extends keyof NoteDraft>(field: Field, value: NoteDraft[Field]) => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        [field]: value,
      }))
    },
    [],
  )

  const handleDraftTagsChange = useCallback(
    (nextTags: readonly string[]) => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        tagsText: createTagsText(nextTags),
      }))
      setTagInputValue('')
    },
    [],
  )

  const commitPendingTagInput = useCallback(() => {
    if (!tagInputValue.trim()) {
      return
    }

    const nextTags = normalizeTags([...draftTags, tagInputValue])
    setDraft((currentDraft) => ({
      ...currentDraft,
      tagsText: createTagsText(nextTags),
    }))
    setTagInputValue('')
  }, [draftTags, tagInputValue])

  const handleSelectNote = useCallback(
    (note: Note, onNarrowPanel?: () => void, onError?: () => void) => {
      onNarrowPanel?.()
      setSelectedNoteId(note.id)
      setIsCreating(false)
      setSelectedNoteTemplateId(blankNoteTemplateId)
      setDraft(createDraftFromNote(note))
      setTagInputValue('')
      onError?.()
    },
    [],
  )

  const handleStartNote = useCallback(
    (canEdit: boolean, onNarrowPanel?: () => void, onError?: () => void) => {
      if (!canEdit) {
        return
      }

      onNarrowPanel?.()
      setSelectedNoteId(null)
      setIsCreating(true)
      setSelectedNoteTemplateId(blankNoteTemplateId)
      setDraft(createEmptyDraft())
      setTagInputValue('')
      onError?.()
    },
    [],
  )

  const handleSelectNoteTemplate = useCallback(
    (templateId: string, onError?: () => void) => {
      setSelectedNoteTemplateId(templateId)
      onError?.()

      if (templateId === blankNoteTemplateId) {
        setDraft(createEmptyDraft())
        setTagInputValue('')
        return
      }

      const template = getNoteStarterTemplate(templateId)

      if (template.starterNote) {
        const starterNote = template.starterNote
        setDraft({
          title: starterNote.title,
          body: starterNote.body,
          tagsText: createTagsText(starterNote.tags),
          status: starterNote.status,
          sessionName: starterNote.sessionName ?? '',
          linkedNoteIds: [],
        })
        setTagInputValue('')
      }
    },
    [],
  )

  const handleSaveNote = useCallback(
    async (
      isSharedModeArg: boolean,
      shareToken: string | null,
      guestToken: string | null,
      selectedCampaignId: string | null,
      authToken: string | null,
      canEditWorkspace: boolean,
      onNarrowPanel?: () => void,
      onError?: (message: string) => void,
    ): Promise<void> => {
      if (isSharedModeArg) {
        if (!guestToken || !selectedCampaignId || !canEditWorkspace) {
          return
        }

        setIsSaving(true)

        try {
          const payload = createNotePayload(draft, null)

          if (isCreating || !selectedNoteId) {
            const createdNote = await createSharedNote(shareToken as string, guestToken, payload)
            await loadSharedWorkspace(
              shareToken as string,
              guestToken,
              createdNote.id,
              undefined,
              null,
              undefined,
              onError,
            )
          } else {
            const updatedNote = await updateSharedNote(
              shareToken as string,
              guestToken,
              selectedNoteId,
              payload,
            )
            await loadSharedWorkspace(
              shareToken as string,
              guestToken,
              updatedNote.id,
              undefined,
              null,
              undefined,
              onError,
            )
          }

          onNarrowPanel?.()
        } catch (saveError) {
          onError?.(
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

      setIsSaving(true)

      try {
        const payload = createNotePayload(draft, selectedCampaignId)

        if (isCreating || !selectedNoteId) {
          const createdNote = await createNote(authToken, payload)
          await loadWorkspace(authToken, selectedCampaignId, createdNote.id, false, undefined, undefined, onError)
        } else {
          const updatedNote = await updateNote(authToken, selectedNoteId, payload)
          await loadWorkspace(authToken, selectedCampaignId, updatedNote.id, false, undefined, undefined, onError)
        }

        if (noteBrowseModeRef.current === 'activity') {
          await loadActivity(authToken, selectedCampaignId, selectedActivityMembershipIdRef.current, onError)
        }
      } catch (saveError) {
        onError?.(
          saveError instanceof Error
            ? saveError.message
            : 'Could not save the note.',
        )
      } finally {
        setIsSaving(false)
      }
    },
    [draft, isCreating, loadActivity, loadSharedWorkspace, loadWorkspace, selectedActivityMembershipIdRef, selectedNoteId],
  )

  const handleDeleteNote = useCallback(
    async (
      isSharedModeArg: boolean,
      shareToken: string | null,
      guestToken: string | null,
      selectedCampaignId: string | null,
      authToken: string | null,
      canEditWorkspace: boolean,
      onNarrowPanel?: () => void,
      onError?: (message: string) => void,
    ): Promise<void> => {
      if (isSharedModeArg) {
        if (!guestToken || !selectedNoteId || !canEditWorkspace) {
          return
        }

        setIsDeleting(true)

        try {
          await deleteSharedNote(shareToken as string, guestToken, selectedNoteId)
          await loadSharedWorkspace(
            shareToken as string,
            guestToken,
            null,
            undefined,
            null,
            undefined,
            onError,
          )
          onNarrowPanel?.()
        } catch (deleteError) {
          onError?.(
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

      setIsDeleting(true)

      try {
        await deleteNote(authToken, selectedNoteId)
        await loadWorkspace(authToken, selectedCampaignId, null, false, undefined, undefined, onError)

        if (noteBrowseModeRef.current === 'activity') {
          await loadActivity(authToken, selectedCampaignId, selectedActivityMembershipIdRef.current, onError)
        }
      } catch (deleteError) {
        onError?.(
          deleteError instanceof Error
            ? deleteError.message
            : 'Could not delete the note.',
        )
      } finally {
        setIsDeleting(false)
      }
    },
    [loadActivity, loadSharedWorkspace, loadWorkspace, selectedActivityMembershipIdRef, selectedNoteId],
  )

  const handleQuickCapture = useCallback(
    async (
      isSharedModeArg: boolean,
      shareToken: string | null,
      guestToken: string | null,
      selectedCampaignId: string | null,
      authToken: string | null,
      canEditWorkspace: boolean,
      onNarrowPanel?: () => void,
      onError?: (message: string) => void,
    ): Promise<void> => {
      const trimmedTitle = quickCaptureTitle.trim()

      if (isSharedModeArg) {
        if (!guestToken || !trimmedTitle || !canEditWorkspace) {
          return
        }

        setIsQuickCapturing(true)

        try {
          const createdNote = await createSharedNote(shareToken as string, guestToken, {
            title: trimmedTitle,
          })
          setQuickCaptureTitle('')
          await loadSharedWorkspace(
            shareToken as string,
            guestToken,
            createdNote.id,
            undefined,
            null,
            undefined,
            onError,
          )
          onNarrowPanel?.()
        } catch (captureError) {
          onError?.(
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
        await loadWorkspace(authToken, selectedCampaignId, createdNote.id, false, undefined, undefined, onError)
      } catch (captureError) {
        onError?.(
          captureError instanceof Error
            ? captureError.message
            : 'Could not capture the note.',
        )
      } finally {
        setIsQuickCapturing(false)
      }
    },
    [loadSharedWorkspace, loadWorkspace, quickCaptureTitle, resetSessionBrowserState],
  )

  return {
    overview,
    notes,
    noteBrowseMode,
    sessionSummaries,
    selectedSessionName,
    sessionNotes,
    activityEntries,
    activityCollaborators,
    selectedActivityMembershipId,
    selectedTagFilter,
    searchText,
    deferredSearchText,
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
    noteTitlesById,
    linkedNotes,
    backlinks,
    sharedSessionSummaries,
    sharedSessionNotes,
    sharedActivityEntries,
    sharedActivityCollaborators,
    selectedNoteIdRef,
    noteBrowseModeRef,
    selectedSessionNameRef,
    selectedActivityMembershipIdRef,
    activityRequestIdRef,
    sessionRequestIdRef,
    activityAbortControllerRef,
    sessionAbortControllerRef,
    setOverview,
    setNotes,
    setNoteBrowseMode,
    setSessionSummaries,
    setSelectedSessionName,
    setSessionNotes,
    setActivityEntries,
    setActivityCollaborators,
    setSelectedActivityMembershipId,
    setSelectedTagFilter,
    setSearchText,
    setDraft,
    setTagInputValue,
    setSelectedNoteId,
    setIsCreating,
    setIsLoadingWorkspace,
    setIsLoadingSessionNotes,
    setIsLoadingActivity,
    setIsQuickCapturing,
    setIsSaving,
    setIsDeleting,
    setSelectedNoteTemplateId,
    setQuickCaptureTitle,
    setIsQuickCaptureOpen,
    resetSessionBrowserState,
    resetActivityState,
    loadActivity,
    loadWorkspace,
    loadSharedWorkspace,
    handleDraftChange,
    handleDraftTagsChange,
    commitPendingTagInput,
    handleSelectNote,
    handleStartNote,
    handleSelectNoteTemplate,
    handleSaveNote,
    handleDeleteNote,
    handleQuickCapture,
  }
}
