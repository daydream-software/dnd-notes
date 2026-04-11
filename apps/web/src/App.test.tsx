import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import App from './App'

type NoteStatus = 'draft' | 'active' | 'archived'

interface NoteFixture {
  id: string
  campaignId: string
  title: string
  body: string
  tags: string[]
  status: NoteStatus
  sessionName: string | null
  createdAt: string
  updatedAt: string
}

function buildOverview(notes: NoteFixture[]) {
  return {
    campaign: {
      id: 'moonshae-ledger',
      name: 'Moonshae Ledger',
      tagline:
        'Capture the clues, fallout, and character beats that matter between sessions.',
      system: 'Dungeons & Dragons 5e',
      setting: 'Moonshae Isles',
      nextSession: '2026-04-18T19:00:00.000Z',
    },
    stats: {
      totalNotes: notes.length,
      draftNotes: notes.filter((note) => note.status === 'draft').length,
      activeNotes: notes.filter((note) => note.status === 'active').length,
      archivedNotes: notes.filter((note) => note.status === 'archived').length,
      sessionLinkedNotes: notes.filter((note) => note.sessionName !== null).length,
    },
    recentNotes: notes.slice(0, 3),
  }
}

describe('App', () => {
  let notes: NoteFixture[]

  beforeEach(() => {
    notes = [
      {
        id: 'cipher-fragment',
        campaignId: 'moonshae-ledger',
        title: 'Cipher fragment recovered',
        body: 'Candlekeep contact goes silent after delivering the translated cipher.',
        tags: ['clue', 'candlekeep'],
        status: 'active',
        sessionName: 'Session 11',
        createdAt: '2026-04-08T18:00:00.000Z',
        updatedAt: '2026-04-10T20:00:00.000Z',
      },
    ]

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url.endsWith('/api/overview') && method === 'GET') {
        return new Response(JSON.stringify(buildOverview(notes)), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (url.endsWith('/api/notes') && method === 'GET') {
        return new Response(JSON.stringify({ notes }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (url.endsWith('/api/notes') && method === 'POST') {
        const payload = JSON.parse(String(init?.body)) as {
          title: string
          body: string
          tags: string[]
          status: NoteStatus
          sessionName: string | null
        }

        const createdNote: NoteFixture = {
          id: `note-${notes.length + 1}`,
          campaignId: 'moonshae-ledger',
          title: payload.title,
          body: payload.body,
          tags: payload.tags,
          status: payload.status,
          sessionName: payload.sessionName,
          createdAt: '2026-04-11T20:00:00.000Z',
          updatedAt: '2026-04-11T20:00:00.000Z',
        }

        notes = [createdNote, ...notes]

        return new Response(JSON.stringify({ note: createdNote }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      const noteMatch = url.match(/\/api\/notes\/([^/]+)$/)

      if (noteMatch && method === 'PUT') {
        const noteId = noteMatch[1]
        const payload = JSON.parse(String(init?.body)) as {
          title: string
          body: string
          tags: string[]
          status: NoteStatus
          sessionName: string | null
        }

        notes = notes.map((note) =>
          note.id === noteId
            ? {
                ...note,
                title: payload.title,
                body: payload.body,
                tags: payload.tags,
                status: payload.status,
                sessionName: payload.sessionName,
                updatedAt: '2026-04-11T21:00:00.000Z',
              }
            : note,
        )

        const updatedNote = notes.find((note) => note.id === noteId)

        return new Response(JSON.stringify({ note: updatedNote }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (noteMatch && method === 'DELETE') {
        const noteId = noteMatch[1]
        notes = notes.filter((note) => note.id !== noteId)

        return new Response(null, { status: 204 })
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports the main create edit delete note workflow', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Moonshae Ledger')).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'New note' })[0])
    await user.type(screen.getByLabelText('Title'), 'Harper safe house')
    await user.type(screen.getByLabelText('Session name'), 'Session 13')
    await user.type(screen.getByLabelText('Tags'), 'harpers, safehouse')
    await user.type(
      screen.getByLabelText('Body'),
      'A hidden cellar beneath the inn gives the party a safe fallback location.',
    )

    await user.click(screen.getByRole('button', { name: 'Save note' }))

    expect(await screen.findByDisplayValue('Harper safe house')).toBeTruthy()
    expect(screen.getByText('safehouse')).toBeTruthy()

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Harper safe house secured')
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    expect(
      await screen.findByDisplayValue('Harper safe house secured'),
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete note' }))

    await waitFor(() => {
      expect(
        screen.queryByDisplayValue('Harper safe house secured'),
      ).toBeNull()
    })
  }, 10000)

  it('renders the overview stats as four campaign pills', async () => {
    render(<App />)

    const statsList = await screen.findByRole('list', { name: 'Campaign stats' })

    expect(within(statsList).getAllByRole('listitem')).toHaveLength(4)
    expect(within(statsList).getByText('Total notes')).toBeTruthy()
    expect(within(statsList).getByText('Draft notes')).toBeTruthy()
    expect(within(statsList).getByText('Active notes')).toBeTruthy()
    expect(within(statsList).getByText('Session-linked notes')).toBeTruthy()
  })
})
