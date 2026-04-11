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

interface CampaignFixture {
  id: string
  name: string
  tagline: string
  system: string
  setting: string
  nextSession: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

interface CampaignMembershipFixture {
  id: string
  campaignId: string
  role: 'owner' | 'guest'
  displayName: string
  userId: string | null
  guestTokenId: string | null
  createdAt: string
  updatedAt: string
}

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

const defaultCampaignId = 'moonshae-ledger'

function buildOverview(campaign: CampaignFixture, notes: NoteFixture[]) {
  return {
    campaign,
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

function readHeader(
  headers: HeadersInit | undefined,
  name: string,
) {
  if (!headers) {
    return null
  }

  if (headers instanceof Headers) {
    return headers.get(name)
  }

  if (Array.isArray(headers)) {
    const match = headers.find(([headerName]) => headerName.toLowerCase() === name.toLowerCase())
    return match?.[1] ?? null
  }

  const value = headers[name as keyof typeof headers]

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return typeof value === 'string' ? value : null
}

describe('App', () => {
  let owner:
    | {
        id: string
        email: string
        displayName: string
        createdAt: string
        updatedAt: string
      }
    | null
  let ownerPassword: string | null
  let activeToken: string | null
  let campaigns: CampaignFixture[]
  let membershipsByCampaign: Record<string, CampaignMembershipFixture[]>
  let notesByCampaign: Record<string, NoteFixture[]>

  beforeEach(() => {
    owner = null
    ownerPassword = null
    activeToken = null
    campaigns = [
      {
        id: defaultCampaignId,
        name: 'Moonshae Ledger',
        tagline:
          'Capture the clues, fallout, and character beats that matter between sessions.',
        system: 'Dungeons & Dragons 5e',
        setting: 'Moonshae Isles',
        nextSession: '2026-04-18T19:00:00.000Z',
        archivedAt: null,
        createdAt: '2026-04-01T12:00:00.000Z',
        updatedAt: '2026-04-10T20:00:00.000Z',
      },
    ]
    membershipsByCampaign = {
      [defaultCampaignId]: [
        {
          id: 'membership-default-owner',
          campaignId: defaultCampaignId,
          role: 'owner',
          displayName: 'Campaign owner',
          userId: null,
          guestTokenId: null,
          createdAt: '2026-04-01T12:00:00.000Z',
          updatedAt: '2026-04-01T12:00:00.000Z',
        },
      ],
    }
    notesByCampaign = {
      [defaultCampaignId]: [
        {
          id: 'cipher-fragment',
          campaignId: defaultCampaignId,
          title: 'Cipher fragment recovered',
          body: 'Candlekeep contact goes silent after delivering the translated cipher.',
          tags: ['clue', 'candlekeep'],
          status: 'active',
          sessionName: 'Session 11',
          createdAt: '2026-04-08T18:00:00.000Z',
          updatedAt: '2026-04-10T20:00:00.000Z',
        },
      ],
    }

    localStorage.clear()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      const parsedUrl = new URL(url, 'http://localhost')
      const path = parsedUrl.pathname
      const method = init?.method?.toUpperCase() ?? 'GET'
      const token = readHeader(init?.headers, 'Authorization')?.replace('Bearer ', '') ?? null

      const requireOwner = () => {
        if (!token || token !== activeToken || !owner) {
          return new Response(
            JSON.stringify({ error: 'Owner authentication is required.' }),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        return null
      }

      const readCampaignId = () =>
        parsedUrl.searchParams.get('campaignId') ?? defaultCampaignId

      const ensureOwnerCampaign = (campaignId: string) => {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        const membership = membershipsByCampaign[campaignId]?.find(
          (campaignMembership) =>
            campaignMembership.role === 'owner' && campaignMembership.userId === owner?.id,
        )

        if (!membership) {
          return new Response(
            JSON.stringify({ error: 'You do not have access to this campaign.' }),
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        return null
      }

      if (path === '/api/auth/register' && method === 'POST') {
        const payload = JSON.parse(String(init?.body)) as {
          displayName: string
          email: string
          password: string
        }

        owner = {
          id: 'owner-1',
          email: payload.email.toLowerCase(),
          displayName: payload.displayName,
          createdAt: '2026-04-11T20:00:00.000Z',
          updatedAt: '2026-04-11T20:00:00.000Z',
        }
        ownerPassword = payload.password
        activeToken = 'owner-token-1'
        membershipsByCampaign[defaultCampaignId] = membershipsByCampaign[
          defaultCampaignId
        ].map((membership) => ({
          ...membership,
          displayName: payload.displayName,
          userId: owner?.id ?? null,
          updatedAt: '2026-04-11T20:00:00.000Z',
        }))

        return new Response(
          JSON.stringify({ token: activeToken, owner }),
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/auth/login' && method === 'POST') {
        const payload = JSON.parse(String(init?.body)) as {
          email: string
          password: string
        }

        if (
          !owner ||
          payload.email.toLowerCase() !== owner.email ||
          payload.password !== ownerPassword
        ) {
          return new Response(
            JSON.stringify({ error: 'Email or password is incorrect.' }),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        activeToken = 'owner-token-login'

        return new Response(
          JSON.stringify({ token: activeToken, owner }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/auth/session' && method === 'GET') {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        return new Response(JSON.stringify({ owner }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (path === '/api/auth/logout' && method === 'POST') {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        activeToken = null

        return new Response(null, { status: 204 })
      }

      if (path === '/api/campaigns' && method === 'GET') {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        const ownedCampaigns = campaigns.filter((campaign) =>
          membershipsByCampaign[campaign.id]?.some(
            (membership) =>
              membership.role === 'owner' && membership.userId === owner?.id,
          ),
        )

        return new Response(JSON.stringify({ campaigns: ownedCampaigns }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (path === '/api/campaigns' && method === 'POST') {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        const payload = JSON.parse(String(init?.body)) as {
          name: string
          tagline: string
          system: string
          setting: string
          nextSession: string | null
        }

        const createdCampaign: CampaignFixture = {
          id: `campaign-${campaigns.length + 1}`,
          name: payload.name,
          tagline: payload.tagline,
          system: payload.system,
          setting: payload.setting,
          nextSession: payload.nextSession,
          archivedAt: null,
          createdAt: '2026-04-12T00:00:00.000Z',
          updatedAt: '2026-04-12T00:00:00.000Z',
        }

        campaigns = [...campaigns, createdCampaign]
        membershipsByCampaign[createdCampaign.id] = [
          {
            id: `membership-${createdCampaign.id}-owner`,
            campaignId: createdCampaign.id,
            role: 'owner',
            displayName: owner?.displayName ?? 'Owner',
            userId: owner?.id ?? null,
            guestTokenId: null,
            createdAt: '2026-04-12T00:00:00.000Z',
            updatedAt: '2026-04-12T00:00:00.000Z',
          },
        ]
        notesByCampaign[createdCampaign.id] = []

        return new Response(JSON.stringify({ campaign: createdCampaign }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      const campaignMatch = path.match(/^\/api\/campaigns\/([^/]+)$/)
      if (campaignMatch && method === 'PUT') {
        const campaignId = campaignMatch[1]
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        const payload = JSON.parse(String(init?.body)) as {
          name: string
          tagline: string
          system: string
          setting: string
          nextSession: string | null
        }

        campaigns = campaigns.map((campaign) =>
          campaign.id === campaignId
            ? {
                ...campaign,
                name: payload.name,
                tagline: payload.tagline,
                system: payload.system,
                setting: payload.setting,
                nextSession: payload.nextSession,
                updatedAt: '2026-04-12T01:00:00.000Z',
              }
            : campaign,
        )

        return new Response(
          JSON.stringify({
            campaign: campaigns.find((campaign) => campaign.id === campaignId),
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      const membershipsMatch = path.match(/^\/api\/campaigns\/([^/]+)\/memberships$/)
      if (membershipsMatch && method === 'GET') {
        const campaignId = membershipsMatch[1]
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        return new Response(
          JSON.stringify({ memberships: membershipsByCampaign[campaignId] ?? [] }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/overview' && method === 'GET') {
        const campaignId = readCampaignId()
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        const campaign = campaigns.find((candidateCampaign) => candidateCampaign.id === campaignId)

        return new Response(
          JSON.stringify(buildOverview(campaign!, notesByCampaign[campaignId] ?? [])),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/notes' && method === 'GET') {
        const campaignId = readCampaignId()
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        return new Response(
          JSON.stringify({ notes: notesByCampaign[campaignId] ?? [] }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/notes' && method === 'POST') {
        const payload = JSON.parse(String(init?.body)) as {
          campaignId: string
          title: string
          body: string
          tags: string[]
          status: NoteStatus
          sessionName: string | null
        }

        const ownershipFailure = ensureOwnerCampaign(payload.campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        const createdNote: NoteFixture = {
          id: `note-${(notesByCampaign[payload.campaignId] ?? []).length + 1}`,
          campaignId: payload.campaignId,
          title: payload.title,
          body: payload.body,
          tags: payload.tags,
          status: payload.status,
          sessionName: payload.sessionName,
          createdAt: '2026-04-12T02:00:00.000Z',
          updatedAt: '2026-04-12T02:00:00.000Z',
        }

        notesByCampaign[payload.campaignId] = [
          createdNote,
          ...(notesByCampaign[payload.campaignId] ?? []),
        ]

        return new Response(JSON.stringify({ note: createdNote }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/)

      if (noteMatch && method === 'PUT') {
        const noteId = noteMatch[1]
        const targetCampaignId =
          Object.keys(notesByCampaign).find((campaignId) =>
            (notesByCampaign[campaignId] ?? []).some((note) => note.id === noteId),
          ) ?? defaultCampaignId

        const ownershipFailure = ensureOwnerCampaign(targetCampaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        const payload = JSON.parse(String(init?.body)) as {
          title: string
          body: string
          tags: string[]
          status: NoteStatus
          sessionName: string | null
        }

        notesByCampaign[targetCampaignId] = (notesByCampaign[targetCampaignId] ?? []).map(
          (note) =>
            note.id === noteId
              ? {
                  ...note,
                  title: payload.title,
                  body: payload.body,
                  tags: payload.tags,
                  status: payload.status,
                  sessionName: payload.sessionName,
                  updatedAt: '2026-04-12T03:00:00.000Z',
                }
              : note,
        )

        const updatedNote = notesByCampaign[targetCampaignId].find(
          (note) => note.id === noteId,
        )

        return new Response(JSON.stringify({ note: updatedNote }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (noteMatch && method === 'DELETE') {
        const noteId = noteMatch[1]
        const targetCampaignId =
          Object.keys(notesByCampaign).find((campaignId) =>
            (notesByCampaign[campaignId] ?? []).some((note) => note.id === noteId),
          ) ?? defaultCampaignId

        const ownershipFailure = ensureOwnerCampaign(targetCampaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        notesByCampaign[targetCampaignId] = (notesByCampaign[targetCampaignId] ?? []).filter(
          (note) => note.id !== noteId,
        )

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
    localStorage.clear()
  })

  it('supports owner onboarding, campaign settings, and the note workflow', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Create your owner account')).toBeTruthy()

    await user.type(screen.getByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()
    expect(screen.getByText(/Signed in as Stef/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Campaign settings' }))
    await user.clear(screen.getByLabelText('Tagline'))
    await user.type(
      screen.getByLabelText('Tagline'),
      'Track the shifting alliances and secrets between sessions.',
    )
    await user.click(screen.getByRole('button', { name: 'Save campaign settings' }))

    expect(
      await screen.findByText(
        'Track the shifting alliances and secrets between sessions.',
      ),
    ).toBeTruthy()
    expect(screen.getByText(/Signed in as Stef/)).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'New note' })[0])
    await user.type(screen.getByLabelText('Title'), 'Harper safe house')
    await user.type(screen.getByLabelText('Session name'), 'Session 13')
    await user.type(screen.getByLabelText('Tags'), 'harpers, safehouse')
    await user.type(
      screen.getByLabelText('Body'),
      'A hidden cellar beneath the inn gives the party a safe fallback location.',
    )

    await user.click(screen.getAllByRole('button', { name: 'Save note' })[0])

    expect(await screen.findByDisplayValue('Harper safe house')).toBeTruthy()
    expect(screen.getByText('safehouse')).toBeTruthy()

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Harper safe house secured')
    await user.click(screen.getAllByRole('button', { name: 'Save note' })[0])

    expect(
      await screen.findByDisplayValue('Harper safe house secured'),
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete note' }))

    await waitFor(() => {
      expect(
        screen.queryByDisplayValue('Harper safe house secured'),
      ).toBeNull()
    })
  }, 15000)

  it('supports creating a second campaign and scoping the workspace to it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'New campaign' })[0])
    await user.type(screen.getByLabelText('Campaign name'), 'Ashen Skies')
    await user.type(
      screen.getByLabelText('Tagline'),
      'Keep the sky-fleet politics and frontier rumors in one place.',
    )
    await user.type(screen.getByLabelText('System'), 'Stars Without Number')
    await user.type(screen.getByLabelText('Setting'), 'The Ashen Reach')
    await user.click(screen.getByRole('button', { name: 'Create campaign' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Ashen Skies' }))[0],
    ).toBeTruthy()
    expect(
      screen.getByText('No notes yet in this campaign. Create the first one to start using the workspace.'),
    ).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'New note' })[0])
    await user.type(screen.getAllByLabelText('Title')[0], 'Dockmaster bribe trail')
    await user.type(
      screen.getAllByLabelText('Body')[0],
      'The dockmaster keeps taking payment in relic shards from the eastern miners.',
    )
    await user.click(screen.getAllByRole('button', { name: 'Save note' })[0])

    expect(await screen.findByDisplayValue('Dockmaster bribe trail')).toBeTruthy()

    const statsList = (await screen.findAllByRole('list', { name: 'Campaign stats' }))[0]
    expect(within(statsList).getByText('Total notes')).toBeTruthy()
    expect(within(statsList).getByText('Draft notes')).toBeTruthy()
  }, 15000)
})
