export interface Note {
  id: string
  title: string
  category: string
  summary: string
  updatedAt: string
  tags: string[]
  status: string
}

export interface CampaignOverview {
  campaign: {
    name: string
    tagline: string
    system: string
    setting: string
    nextSession: string
    focusAreas: string[]
  }
  stats: {
    totalNotes: number
    characters: number
    locations: number
    openThreads: number
  }
  party: string[]
  factions: string[]
  notes: Note[]
}
