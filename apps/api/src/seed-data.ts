import type { NoteStore } from './note-store.js'
import type { NoteInput } from './types.js'

export const starterNotes: NoteInput[] = [
  {
    title: 'Bryn\'s ledger of moonwell debts',
    body:
      'Bryn believes three village elders owe favors to the moonwell wardens. Collect proof before the midsummer council.',
    tags: ['moonwell', 'politics'],
    status: 'active',
    sessionName: 'Session 15',
  },
  {
    title: 'Smuggler tunnel under Blackstone pier',
    body:
      'The tide cave connects to a hidden dock. Mark the low-tide entry and note the crates stamped with the red gull sigil.',
    tags: ['smugglers', 'harbor'],
    status: 'draft',
    sessionName: 'Session 14',
  },
  {
    title: 'Witness account from the druid circle',
    body:
      'Maeve heard chanting in Primwood before the standing stones flared. Cross-reference her description with the old ward maps.',
    tags: ['druids', 'primwood'],
    status: 'archived',
    sessionName: null,
  },
]

export type SeedWorkflowResult =
  | {
      action: 'seed'
      status: 'seeded'
      noteCount: number
    }
  | {
      action: 'seed'
      status: 'skipped'
      existingCount: number
    }
  | {
      action: 'reset'
      status: 'seeded'
      noteCount: number
    }

export function seedStarterNotes(noteStore: NoteStore): SeedWorkflowResult {
  const existingCount = noteStore.getStats().totalNotes

  if (existingCount > 0) {
    return {
      action: 'seed',
      status: 'skipped',
      existingCount,
    }
  }

  const notes = noteStore.resetNotes(starterNotes)

  return {
    action: 'seed',
    status: 'seeded',
    noteCount: notes.length,
  }
}

export function resetStarterNotes(noteStore: NoteStore): SeedWorkflowResult {
  const notes = noteStore.resetNotes(starterNotes)

  return {
    action: 'reset',
    status: 'seeded',
    noteCount: notes.length,
  }
}
