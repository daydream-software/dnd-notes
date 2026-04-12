import type { NoteInput, NoteStatus } from './types'

export interface StarterNoteSeed {
  title: string
  body: string
  tags: string[]
  status: NoteStatus
  sessionName: string | null
}

export interface NoteStarterTemplate {
  id: string
  name: string
  description: string
  starterNote: StarterNoteSeed | null
}

export interface CampaignStarterTemplate {
  id: string
  name: string
  description: string
  starterNotes: StarterNoteSeed[]
}

export const blankNoteTemplateId = 'blank'
export const blankCampaignTemplateId = 'blank'

const npcProfileStarter: StarterNoteSeed = {
  title: 'NPC profile',
  body: [
    'Role in the story:',
    'First impression:',
    'What they want:',
    'Secrets or leverage:',
    'How to bring them back:',
  ].join('\n'),
  tags: ['npc', 'people'],
  status: 'draft',
  sessionName: null,
}

const factionBriefStarter: StarterNoteSeed = {
  title: 'Faction brief',
  body: [
    'What the faction wants:',
    'Known leaders:',
    'Allies and rivals:',
    'Current pressure:',
    'Open questions:',
  ].join('\n'),
  tags: ['faction', 'politics'],
  status: 'draft',
  sessionName: null,
}

const sessionRecapStarter: StarterNoteSeed = {
  title: 'Session recap',
  body: [
    'Summary:',
    'Wins:',
    'Complications:',
    'Loose threads:',
    'Prep for next session:',
  ].join('\n'),
  tags: ['session', 'recap'],
  status: 'draft',
  sessionName: 'Session ?',
}

const locationEntryStarter: StarterNoteSeed = {
  title: 'Location entry',
  body: [
    'First impression:',
    'Who controls it:',
    'Useful details:',
    'Risks:',
    'Hooks:',
  ].join('\n'),
  tags: ['location', 'travel'],
  status: 'draft',
  sessionName: null,
}

export const noteStarterTemplates: NoteStarterTemplate[] = [
  {
    id: blankNoteTemplateId,
    name: 'Blank note',
    description: 'Start from scratch with an empty note.',
    starterNote: null,
  },
  {
    id: 'npc-profile',
    name: 'NPC profile',
    description: 'A lightweight scaffold for recurring people notes.',
    starterNote: npcProfileStarter,
  },
  {
    id: 'faction-brief',
    name: 'Faction brief',
    description: 'Capture goals, pressure, and relationships for a faction.',
    starterNote: factionBriefStarter,
  },
  {
    id: 'session-recap',
    name: 'Session recap',
    description: 'Log the beats, fallout, and next steps after a session.',
    starterNote: sessionRecapStarter,
  },
  {
    id: 'location-entry',
    name: 'Location entry',
    description: 'Track control, risks, and hooks for a place.',
    starterNote: locationEntryStarter,
  },
]

export const campaignStarterTemplates: CampaignStarterTemplate[] = [
  {
    id: blankCampaignTemplateId,
    name: 'Blank campaign',
    description: 'Create the campaign without starter notes.',
    starterNotes: [],
  },
  {
    id: 'starter-pack',
    name: 'Starter pack',
    description:
      'Seeds flexible notes for NPCs, factions, locations, and session tracking.',
    starterNotes: [
      {
        title: 'NPC roster',
        body: [
          'Use this note as a running list of notable NPCs.',
          '',
          '- Name:',
          '- Role in campaign:',
          '- What they want:',
          '- Connection to the party:',
        ].join('\n'),
        tags: ['npc', 'roster'],
        status: 'draft',
        sessionName: null,
      },
      {
        title: 'Faction tracker',
        body: [
          'Keep faction goals and tension in one place.',
          '',
          '- Faction:',
          '- Agenda:',
          '- Allies and rivals:',
          '- Current pressure:',
        ].join('\n'),
        tags: ['faction', 'tracker'],
        status: 'draft',
        sessionName: null,
      },
      {
        title: 'Location ledger',
        body: [
          'Collect places worth revisiting.',
          '',
          '- Location:',
          '- First impression:',
          '- Who controls it:',
          '- Hooks or risks:',
        ].join('\n'),
        tags: ['location', 'reference'],
        status: 'draft',
        sessionName: null,
      },
      {
        title: 'Session log',
        body: [
          'Use one section per session so prep and fallout stay together.',
          '',
          'Session:',
          'Highlights:',
          'Complications:',
          'Open threads:',
        ].join('\n'),
        tags: ['session', 'log'],
        status: 'draft',
        sessionName: 'Session 1',
      },
    ],
  },
]

export function getNoteStarterTemplate(id: string) {
  return (
    noteStarterTemplates.find((template) => template.id === id) ??
    noteStarterTemplates[0]
  )
}

export function getCampaignStarterTemplate(id: string) {
  return (
    campaignStarterTemplates.find((template) => template.id === id) ??
    campaignStarterTemplates[0]
  )
}

export function createStarterNoteInput(
  starterNote: StarterNoteSeed,
  campaignId: string,
): NoteInput {
  return {
    title: starterNote.title,
    body: starterNote.body,
    tags: starterNote.tags,
    status: starterNote.status,
    sessionName: starterNote.sessionName,
    campaignId,
  }
}
