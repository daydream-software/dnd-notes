import type {
  AuthSessionResponse,
  CampaignInput,
  CampaignMembershipsResponse,
  CampaignShareLinkCreateResponse,
  CampaignShareLinkInput,
  CampaignShareLinkRevealResponse,
  CampaignShareLinksResponse,
  CampaignResponse,
  CampaignsResponse,
  CurrentOwnerResponse,
  ErrorResponse,
  GuestJoinInput,
  NoteActivityResponse,
  NoteInput,
  NoteResponse,
  NotesOverview,
  NotesResponse,
  OwnerLoginInput,
  OwnerRegistrationInput,
  SessionsResponse,
  SharedJoinResponse,
  SharedMembershipClaimResponse,
  SharedSessionResponse,
} from './types'

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3001'

function createHeaders(authToken?: string, includeJson = false) {
  const headers = new Headers()

  if (includeJson) {
    headers.set('Content-Type', 'application/json')
  }

  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`)
  }

  return headers
}

function createGuestHeaders(guestToken?: string, includeJson = false) {
  const headers = new Headers()

  if (includeJson) {
    headers.set('Content-Type', 'application/json')
  }

  if (guestToken) {
    headers.set('X-Guest-Token', guestToken)
  }

  return headers
}

function createCampaignPath(path: string, campaignId?: string | null) {
  if (!campaignId) {
    return `${apiBaseUrl}${path}`
  }

  const searchParams = new URLSearchParams({ campaignId })
  return `${apiBaseUrl}${path}?${searchParams.toString()}`
}

async function readJson<T>(response: Response) {
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`

    try {
      const errorBody: ErrorResponse = await response.json()
      const details = errorBody.details?.join(' ')
      errorMessage = details
        ? `${errorBody.error} ${details}`
        : errorBody.error
    } catch {
      // Ignore malformed error payloads and use the generic message above.
    }

    throw new Error(errorMessage)
  }

  return (await response.json()) as T
}

export async function registerOwner(input: OwnerRegistrationInput) {
  const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
    method: 'POST',
    headers: createHeaders(undefined, true),
    body: JSON.stringify(input),
  })

  return readJson<AuthSessionResponse>(response)
}

export async function loginOwner(input: OwnerLoginInput) {
  const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: createHeaders(undefined, true),
    body: JSON.stringify(input),
  })

  return readJson<AuthSessionResponse>(response)
}

export async function fetchOwnerSession(authToken: string, signal?: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/api/auth/session`, {
    headers: createHeaders(authToken),
    signal,
  })

  return readJson<CurrentOwnerResponse>(response)
}

export async function logoutOwner(authToken: string) {
  const response = await fetch(`${apiBaseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: createHeaders(authToken),
  })

  if (!response.ok) {
    await readJson(response)
  }
}

export async function fetchCampaigns(authToken: string, signal?: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/api/campaigns`, {
    headers: createHeaders(authToken),
    signal,
  })

  return readJson<CampaignsResponse>(response)
}

export async function fetchCampaignMemberships(
  authToken: string,
  campaignId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `${apiBaseUrl}/api/campaigns/${campaignId}/memberships`,
    {
      headers: createHeaders(authToken),
      signal,
    },
  )

  return readJson<CampaignMembershipsResponse>(response)
}

export async function fetchCampaignShareLinks(
  authToken: string,
  campaignId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `${apiBaseUrl}/api/campaigns/${campaignId}/share-links`,
    {
      headers: createHeaders(authToken),
      signal,
    },
  )

  return readJson<CampaignShareLinksResponse>(response)
}

export async function createCampaignShareLink(
  authToken: string,
  campaignId: string,
  input: CampaignShareLinkInput,
) {
  const response = await fetch(
    `${apiBaseUrl}/api/campaigns/${campaignId}/share-links`,
    {
      method: 'POST',
      headers: createHeaders(authToken, true),
      body: JSON.stringify(input),
    },
  )

  return readJson<CampaignShareLinkCreateResponse>(response)
}

export async function revealCampaignShareLink(
  authToken: string,
  campaignId: string,
  shareLinkId: string,
) {
  const response = await fetch(
    `${apiBaseUrl}/api/campaigns/${campaignId}/share-links/${shareLinkId}`,
    {
      headers: createHeaders(authToken),
    },
  )

  return readJson<CampaignShareLinkRevealResponse>(response)
}

export async function revokeCampaignShareLink(
  authToken: string,
  campaignId: string,
  shareLinkId: string,
) {
  const response = await fetch(
    `${apiBaseUrl}/api/campaigns/${campaignId}/share-links/${shareLinkId}`,
    {
      method: 'DELETE',
      headers: createHeaders(authToken),
    },
  )

  if (!response.ok) {
    await readJson(response)
  }
}

export async function createCampaign(authToken: string, input: CampaignInput) {
  const response = await fetch(`${apiBaseUrl}/api/campaigns`, {
    method: 'POST',
    headers: createHeaders(authToken, true),
    body: JSON.stringify(input),
  })

  const data = await readJson<CampaignResponse>(response)
  return data.campaign
}

export async function updateCampaign(
  authToken: string,
  campaignId: string,
  input: CampaignInput,
) {
  const response = await fetch(`${apiBaseUrl}/api/campaigns/${campaignId}`, {
    method: 'PUT',
    headers: createHeaders(authToken, true),
    body: JSON.stringify(input),
  })

  const data = await readJson<CampaignResponse>(response)
  return data.campaign
}

export async function fetchOverview(
  authToken: string,
  campaignId?: string | null,
  signal?: AbortSignal,
) {
  const response = await fetch(createCampaignPath('/api/overview', campaignId), {
    headers: createHeaders(authToken),
    signal,
  })

  return readJson<NotesOverview>(response)
}

export async function fetchNotes(
  authToken: string,
  campaignId?: string | null,
  signal?: AbortSignal,
) {
  const response = await fetch(createCampaignPath('/api/notes', campaignId), {
    headers: createHeaders(authToken),
    signal,
  })

  return readJson<NotesResponse>(response)
}

export async function fetchNoteActivity(
  authToken: string,
  options: {
    campaignId?: string | null
    membershipId?: string | null
    limit?: number
    signal?: AbortSignal
  } = {},
) {
  const searchParams = new URLSearchParams()

  if (options.campaignId) {
    searchParams.set('campaignId', options.campaignId)
  }

  if (options.membershipId) {
    searchParams.set('membershipId', options.membershipId)
  }

  if (options.limit !== undefined) {
    searchParams.set('limit', String(options.limit))
  }

  const search = searchParams.toString()
  const response = await fetch(
    `${apiBaseUrl}/api/notes/activity${search ? `?${search}` : ''}`,
    {
      headers: createHeaders(authToken),
      signal: options.signal,
    },
  )

  return readJson<NoteActivityResponse>(response)
}

export async function fetchSessions(
  authToken: string,
  campaignId?: string | null,
  signal?: AbortSignal,
) {
  const response = await fetch(
    createCampaignPath('/api/notes/sessions', campaignId),
    {
      headers: createHeaders(authToken),
      signal,
    },
  )

  return readJson<SessionsResponse>(response)
}

export async function fetchSessionNotes(
  authToken: string,
  sessionName: string,
  campaignId?: string | null,
  signal?: AbortSignal,
) {
  const response = await fetch(
    createCampaignPath(
      `/api/notes/sessions/${encodeURIComponent(sessionName)}`,
      campaignId,
    ),
    {
      headers: createHeaders(authToken),
      signal,
    },
  )

  return readJson<NotesResponse>(response)
}

export async function createNote(authToken: string, note: NoteInput) {
  const response = await fetch(`${apiBaseUrl}/api/notes`, {
    method: 'POST',
    headers: createHeaders(authToken, true),
    body: JSON.stringify(note),
  })

  const data = await readJson<NoteResponse>(response)
  return data.note
}

export async function updateNote(
  authToken: string,
  noteId: string,
  note: NoteInput,
) {
  const response = await fetch(`${apiBaseUrl}/api/notes/${noteId}`, {
    method: 'PUT',
    headers: createHeaders(authToken, true),
    body: JSON.stringify(note),
  })

  const data = await readJson<NoteResponse>(response)
  return data.note
}

export async function deleteNote(authToken: string, noteId: string) {
  const response = await fetch(`${apiBaseUrl}/api/notes/${noteId}`, {
    method: 'DELETE',
    headers: createHeaders(authToken),
  })

  if (!response.ok) {
    await readJson(response)
  }
}

export async function fetchSharedSession(
  shareToken: string,
  guestToken?: string | null,
  signal?: AbortSignal,
) {
  const response = await fetch(`${apiBaseUrl}/api/shared/${shareToken}/session`, {
    headers: createGuestHeaders(guestToken ?? undefined),
    signal,
  })

  return readJson<SharedSessionResponse>(response)
}

export async function joinSharedCampaign(
  shareToken: string,
  input: GuestJoinInput,
) {
  const response = await fetch(`${apiBaseUrl}/api/shared/${shareToken}/join`, {
    method: 'POST',
    headers: createGuestHeaders(undefined, true),
    body: JSON.stringify(input),
  })

  return readJson<SharedJoinResponse>(response)
}

export async function claimSharedMembership(
  shareToken: string,
  authToken: string,
  guestToken: string,
) {
  const headers = createGuestHeaders(guestToken)
  headers.set('Authorization', `Bearer ${authToken}`)

  const response = await fetch(`${apiBaseUrl}/api/shared/${shareToken}/membership/claim`, {
    method: 'POST',
    headers,
  })

  return readJson<SharedMembershipClaimResponse>(response)
}

export async function fetchSharedOverview(
  shareToken: string,
  guestToken: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`${apiBaseUrl}/api/shared/${shareToken}/overview`, {
    headers: createGuestHeaders(guestToken),
    signal,
  })

  return readJson<NotesOverview>(response)
}

export async function fetchSharedNotes(
  shareToken: string,
  guestToken: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`${apiBaseUrl}/api/shared/${shareToken}/notes`, {
    headers: createGuestHeaders(guestToken),
    signal,
  })

  return readJson<NotesResponse>(response)
}

export async function createSharedNote(
  shareToken: string,
  guestToken: string,
  note: NoteInput,
) {
  const response = await fetch(`${apiBaseUrl}/api/shared/${shareToken}/notes`, {
    method: 'POST',
    headers: createGuestHeaders(guestToken, true),
    body: JSON.stringify(note),
  })

  const data = await readJson<NoteResponse>(response)
  return data.note
}

export async function updateSharedNote(
  shareToken: string,
  guestToken: string,
  noteId: string,
  note: NoteInput,
) {
  const response = await fetch(`${apiBaseUrl}/api/shared/${shareToken}/notes/${noteId}`, {
    method: 'PUT',
    headers: createGuestHeaders(guestToken, true),
    body: JSON.stringify(note),
  })

  const data = await readJson<NoteResponse>(response)
  return data.note
}

export async function deleteSharedNote(
  shareToken: string,
  guestToken: string,
  noteId: string,
) {
  const response = await fetch(`${apiBaseUrl}/api/shared/${shareToken}/notes/${noteId}`, {
    method: 'DELETE',
    headers: createGuestHeaders(guestToken),
  })

  if (!response.ok) {
    await readJson(response)
  }
}
