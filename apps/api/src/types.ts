export const noteStatuses = ['draft', 'active', 'archived'] as const

export type NoteStatus = (typeof noteStatuses)[number]

export interface CampaignSummary {
  id: string
  name: string
  tagline: string
  system: string
  setting: string
  nextSession: string | null
}

export interface Note {
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

export interface NoteInput {
  title: string
  body: string
  tags: string[]
  status: NoteStatus
  sessionName: string | null
}

export interface NoteStats {
  totalNotes: number
  draftNotes: number
  activeNotes: number
  archivedNotes: number
  sessionLinkedNotes: number
}

export interface NotesOverview {
  campaign: CampaignSummary
  stats: NoteStats
  recentNotes: Note[]
}

export interface HealthResponse {
  status: 'ok'
  service: 'dnd-notes-api'
}

export interface NotesResponse {
  notes: Note[]
}

export interface NoteResponse {
  note: Note
}

export interface ErrorResponse {
  error: string
  details?: string[]
}
