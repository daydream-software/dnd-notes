import type {
  ErrorResponse,
  NoteInput,
  NoteResponse,
  NotesOverview,
  NotesResponse,
} from './types'

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3001'

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

export async function fetchOverview(signal?: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/api/overview`, { signal })

  return readJson<NotesOverview>(response)
}

export async function fetchNotes(signal?: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/api/notes`, { signal })

  return readJson<NotesResponse>(response)
}

export async function createNote(note: NoteInput) {
  const response = await fetch(`${apiBaseUrl}/api/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(note),
  })

  const data = await readJson<NoteResponse>(response)
  return data.note
}

export async function updateNote(noteId: string, note: NoteInput) {
  const response = await fetch(`${apiBaseUrl}/api/notes/${noteId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(note),
  })

  const data = await readJson<NoteResponse>(response)
  return data.note
}

export async function deleteNote(noteId: string) {
  const response = await fetch(`${apiBaseUrl}/api/notes/${noteId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    await readJson(response)
  }
}
