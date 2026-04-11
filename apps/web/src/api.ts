import type {
  AuthSessionResponse,
  CampaignInput,
  CampaignMembershipsResponse,
  CampaignResponse,
  CampaignsResponse,
  CurrentOwnerResponse,
  ErrorResponse,
  NoteInput,
  NoteResponse,
  NotesOverview,
  NotesResponse,
  OwnerLoginInput,
  OwnerRegistrationInput,
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
