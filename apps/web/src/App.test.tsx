import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const overview = {
  campaign: {
    name: 'Moonshae Ledger',
    tagline: 'Track factions, fallout, and secrets between sessions before anything slips through the cracks.',
    system: 'Dungeons & Dragons 5e',
    setting: 'Moonshae Isles',
    nextSession: '2026-04-18T19:00:00.000Z',
    focusAreas: ['Session recaps', 'NPC relationships', 'Location lore', 'Quest threads'],
  },
  stats: {
    totalNotes: 24,
    characters: 17,
    locations: 9,
    openThreads: 5,
  },
  party: ['Anwen the druid', 'Bramble the rogue', 'Sister Ilyra', 'Torvald Stonewake'],
  factions: ['The Black Boar Company', 'Wardens of Candlekeep', 'Court of High King Kendrick'],
  notes: [
    {
      id: 'cipher-fragment',
      title: 'Cipher fragment recovered',
      category: 'Session recap',
      summary: 'Candlekeep contact goes silent after delivering the translated cipher.',
      updatedAt: '2 days ago',
      tags: ['clue', 'candlekeep'],
      status: 'Hot lead',
    },
  ],
}

describe('App', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(overview), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders starter campaign data from the API', async () => {
    render(<App />)

    expect(await screen.findByText('Moonshae Ledger')).toBeTruthy()
    expect(screen.getByText('Recent notes')).toBeTruthy()
    expect(
      screen.getByText(
        'Candlekeep contact goes silent after delivering the translated cipher.',
      ),
    ).toBeTruthy()
  })
})
