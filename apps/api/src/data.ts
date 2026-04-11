import type { CampaignOverview } from './types.js'

export const overview: CampaignOverview = {
  campaign: {
    name: 'Moonshae Ledger',
    tagline:
      'Track factions, fallout, and secrets between sessions before anything slips through the cracks.',
    system: 'Dungeons & Dragons 5e',
    setting: 'Moonshae Isles',
    nextSession: '2026-04-18T19:00:00.000Z',
    focusAreas: [
      'Session recaps',
      'NPC relationships',
      'Location lore',
      'Quest threads',
    ],
  },
  stats: {
    totalNotes: 24,
    characters: 17,
    locations: 9,
    openThreads: 5,
  },
  party: [
    'Anwen the druid',
    'Bramble the rogue',
    'Sister Ilyra',
    'Torvald Stonewake',
  ],
  factions: [
    'The Black Boar Company',
    'Wardens of Candlekeep',
    'Court of High King Kendrick',
  ],
  notes: [
    {
      id: 'cipher-fragment',
      title: 'Cipher fragment recovered',
      category: 'Session recap',
      summary:
        'Candlekeep contact goes silent after delivering the translated cipher.',
      updatedAt: '2 days ago',
      tags: ['clue', 'candlekeep'],
      status: 'Hot lead',
    },
    {
      id: 'wreck-of-the-ashen-star',
      title: 'Wreck of the Ashen Star',
      category: 'Location',
      summary:
        'A half-sunken warship near Moray holds a sealed reliquary and a nest of harpies.',
      updatedAt: '4 days ago',
      tags: ['location', 'harpies', 'loot'],
      status: 'Ready to prep',
    },
    {
      id: 'black-boar-oath',
      title: 'Black Boar oath ledger',
      category: 'Faction',
      summary:
        'Mercenaries are keeping contracts that point to a patron inside the royal court.',
      updatedAt: '1 week ago',
      tags: ['faction', 'court', 'intrigue'],
      status: 'Needs detail',
    },
  ],
}
