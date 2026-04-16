import 'dotenv/config'
import { createNoteStore, resolveNoteDbPath } from './note-store.js'
import { resetStarterNotes, seedStarterNotes } from './seed-data.js'

type SeedCommand = 'seed' | 'reset'

function parseCommand(input: string | undefined): SeedCommand {
  if (input === 'seed' || input === 'reset') {
    return input
  }

  throw new Error('Expected "seed" or "reset" as the command.')
}

const command = parseCommand(process.argv[2])
const dbPath = resolveNoteDbPath()
const noteStore = createNoteStore({ dbPath })

try {
  const result =
    command === 'seed'
      ? seedStarterNotes(noteStore)
      : resetStarterNotes(noteStore)

  if (result.status === 'skipped') {
    console.log(
      `Skipped seeding ${dbPath} because it already contains ${result.existingCount} notes. Run "npm run reset:data" to replace them.`,
    )
  } else {
    const actionLabel = command === 'seed' ? 'Seeded' : 'Reset'
    console.log(`${actionLabel} ${result.noteCount} starter notes in ${dbPath}.`)
  }
} finally {
  noteStore.close()
}
