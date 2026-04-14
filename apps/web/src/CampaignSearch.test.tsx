import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const owner = {
  id: 'owner-1',
  email: 'test@example.com',
  displayName: 'Test Owner',
  createdAt: '2026-04-13T00:00:00.000Z',
  updatedAt: '2026-04-13T00:00:00.000Z',
}

const campaign = {
  id: 'campaign-1',
  name: 'Test Campaign',
  tagline: 'Test tagline',
  system: 'D&D 5e',
  setting: 'Forgotten Realms',
  nextSession: null,
  archivedAt: null,
  createdAt: '2026-04-13T00:00:00.000Z',
  updatedAt: '2026-04-13T00:00:00.000Z',
}

const ownerMembership = {
  id: 'membership-owner',
  campaignId: campaign.id,
  role: 'owner',
  displayName: owner.displayName,
  userId: owner.id,
  guestTokenId: null,
  createdAt: '2026-04-13T00:00:00.000Z',
  updatedAt: '2026-04-13T00:00:00.000Z',
}

const scoutMembership = {
  id: 'membership-scout',
  campaignId: campaign.id,
  role: 'guest',
  displayName: 'Scout Mara',
  userId: null,
  guestTokenId: 'guest-token-1',
  createdAt: '2026-04-12T00:00:00.000Z',
  updatedAt: '2026-04-12T00:00:00.000Z',
}

const archivistMembership = {
  id: 'membership-archivist',
  campaignId: campaign.id,
  role: 'guest',
  displayName: 'Archivist Rune',
  userId: null,
  guestTokenId: 'guest-token-2',
  createdAt: '2026-04-12T00:00:00.000Z',
  updatedAt: '2026-04-12T00:00:00.000Z',
}

const notes = [
  {
    id: 'note-1',
    campaignId: campaign.id,
    title: 'Dragon Encounter',
    body: 'Party faced a red dragon in the mountains',
    tags: ['combat', 'dragon'],
    linkedNoteIds: [],
    status: 'active',
    sessionName: 'Session 5',
    createdBy: {
      membershipId: ownerMembership.id,
      displayName: ownerMembership.displayName,
      role: ownerMembership.role,
    },
    lastEditedBy: {
      membershipId: archivistMembership.id,
      displayName: archivistMembership.displayName,
      role: archivistMembership.role,
    },
    createdAt: '2026-04-10T10:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z',
  },
  {
    id: 'note-2',
    campaignId: campaign.id,
    title: 'Goblin Camp',
    body: 'Found a goblin camp near the river',
    tags: ['exploration', 'goblin'],
    linkedNoteIds: [],
    status: 'active',
    sessionName: 'Session 4',
    createdBy: {
      membershipId: scoutMembership.id,
      displayName: scoutMembership.displayName,
      role: scoutMembership.role,
    },
    lastEditedBy: null,
    createdAt: '2026-04-09T10:00:00.000Z',
    updatedAt: '2026-04-09T10:00:00.000Z',
  },
  {
    id: 'note-3',
    campaignId: campaign.id,
    title: 'Mysterious Artifact',
    body: 'Discovered an ancient artifact with dragon runes',
    tags: ['artifact', 'mystery'],
    linkedNoteIds: [],
    status: 'active',
    sessionName: null,
    createdBy: {
      membershipId: ownerMembership.id,
      displayName: ownerMembership.displayName,
      role: ownerMembership.role,
    },
    lastEditedBy: null,
    createdAt: '2026-04-08T10:00:00.000Z',
    updatedAt: '2026-04-08T10:00:00.000Z',
  },
  {
    id: 'note-4',
    campaignId: campaign.id,
    title: 'Village Quest',
    body: 'Villagers need help with dragon problem',
    tags: ['quest'],
    linkedNoteIds: [],
    status: 'draft',
    sessionName: null,
    createdBy: {
      membershipId: ownerMembership.id,
      displayName: ownerMembership.displayName,
      role: ownerMembership.role,
    },
    lastEditedBy: null,
    createdAt: '2026-04-07T10:00:00.000Z',
    updatedAt: '2026-04-07T10:00:00.000Z',
  },
]

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getVisibleNoteButtons() {
  return within(screen.getByRole('list', { name: 'Notes list' })).getAllByRole('button')
}

async function registerAndOpenWorkspace(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)

  await user.type(await screen.findByLabelText('Owner display name'), owner.displayName)
  await user.type(screen.getByLabelText('Email'), owner.email)
  await user.type(screen.getByLabelText('Password'), 'test-password')
  await user.click(screen.getByRole('button', { name: 'Create owner account' }))

  await screen.findByText('Dragon Encounter')
}

describe('Campaign note search regressions', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const parsedUrl = new URL(url, 'http://localhost')
      const path = parsedUrl.pathname
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (path === '/api/auth/register' && method === 'POST') {
        return createJsonResponse({ owner, token: 'test-token' }, 201)
      }

      if (path === '/api/campaigns' && method === 'GET') {
        return createJsonResponse({ campaigns: [campaign] })
      }

      if (path === '/api/overview' && method === 'GET') {
        return createJsonResponse({
          campaign,
          membership: ownerMembership,
          stats: {
            totalNotes: notes.length,
            draftNotes: notes.filter((note) => note.status === 'draft').length,
            activeNotes: notes.filter((note) => note.status === 'active').length,
            archivedNotes: 0,
            sessionLinkedNotes: notes.filter((note) => note.sessionName !== null).length,
          },
          recentNotes: [],
        })
      }

      if (path === '/api/notes/sessions' && method === 'GET') {
        return createJsonResponse({
          sessions: [
            {
              sessionName: 'Session 5',
              noteCount: 1,
              latestActivity: '2026-04-10T10:00:00.000Z',
            },
            {
              sessionName: 'Session 4',
              noteCount: 1,
              latestActivity: '2026-04-09T10:00:00.000Z',
            },
          ],
        })
      }

      if (path === '/api/notes' && method === 'GET') {
        return createJsonResponse({ notes })
      }

      return createJsonResponse({ error: 'Unhandled ' + method + ' ' + path }, 500)
    })
  })

  it('filters notes by title search (case-insensitive)', async () => {
    const user = userEvent.setup()

    await registerAndOpenWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'dragon')

    await waitFor(() => {
      expect(getVisibleNoteButtons()).toHaveLength(3)
    })

    expect(screen.getByText('Dragon Encounter')).toBeTruthy()
    expect(screen.getByText('Mysterious Artifact')).toBeTruthy()
    expect(screen.getByText('Village Quest')).toBeTruthy()
    expect(screen.queryByText('Goblin Camp')).toBeNull()
  })

  it('filters notes by body content', async () => {
    const user = userEvent.setup()

    await registerAndOpenWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'goblin')

    await waitFor(() => {
      expect(getVisibleNoteButtons()).toHaveLength(1)
    })

    expect(screen.getByText('Goblin Camp')).toBeTruthy()
  })

  it('filters notes by session name', async () => {
    const user = userEvent.setup()

    await registerAndOpenWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'session 4')

    await waitFor(() => {
      expect(getVisibleNoteButtons()).toHaveLength(1)
    })

    expect(screen.getByText('Goblin Camp')).toBeTruthy()
  })

  it('filters notes by collaborator name', async () => {
    const user = userEvent.setup()

    await registerAndOpenWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'mara')

    await waitFor(() => {
      expect(getVisibleNoteButtons()).toHaveLength(1)
    })

    expect(screen.getByText('Goblin Camp')).toBeTruthy()
  })

  it('can clear search with clear button', async () => {
    const user = userEvent.setup()

    await registerAndOpenWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'goblin')

    await waitFor(() => {
      expect(getVisibleNoteButtons()).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    await waitFor(() => {
      expect(getVisibleNoteButtons()).toHaveLength(4)
    })

    const searchInput = screen.getByLabelText('Search notes') as HTMLInputElement
    expect(searchInput.value).toBe('')
  })

  it('combines search with tag filter', async () => {
    const user = userEvent.setup()

    await registerAndOpenWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'dragon')

    await waitFor(() => {
      expect(getVisibleNoteButtons()).toHaveLength(3)
    })

    await user.click(screen.getAllByRole('button', { name: /combat/ })[0])

    await waitFor(() => {
      expect(getVisibleNoteButtons()).toHaveLength(1)
    })

    expect(screen.getByText('Dragon Encounter')).toBeTruthy()
  })

  it('shows the expanded search-scope description', async () => {
    const user = userEvent.setup()

    await registerAndOpenWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'dragon')

    await waitFor(() => {
      expect(
        screen.getByText(
          'Showing 3 notes matching "dragon" across titles, body, tags, sessions, and collaborators.',
        ),
      ).toBeTruthy()
    })
  })

  it('clears search when starting a new note', async () => {
    const user = userEvent.setup()

    await registerAndOpenWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'dragon')

    await waitFor(() => {
      expect(screen.getByText(/Showing 3 notes matching "dragon"/)).toBeTruthy()
    })

    await user.click(screen.getAllByRole('button', { name: 'New note' })[0])

    const browseNotesButtons = screen.queryAllByRole('button', { name: 'Browse notes' })
    if (browseNotesButtons.length > 0) {
      await user.click(browseNotesButtons[0])
    }

    await waitFor(() => {
      const searchInput = screen.getByLabelText('Search notes') as HTMLInputElement
      expect(searchInput.value).toBe('')
    })
  })
})
