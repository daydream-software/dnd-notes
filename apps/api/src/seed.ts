import 'dotenv/config'
import { createNoteStore } from './note-store.js'
import { resetStarterNotes, seedStarterNotes } from './seed-data.js'
import { resolveSeedTarget } from './seed-target.js'

type SeedCommand = 'seed' | 'reset'

function parseCommand(input: string | undefined): SeedCommand {
  if (input === 'seed' || input === 'reset') {
    return input
  }

  throw new Error('Expected "seed" or "reset" as the command.')
}

const command = parseCommand(process.argv[2])
const target = resolveSeedTarget()
const noteStore = await createNoteStore(target.noteStoreOptions)

try {
  const result =
    command === 'seed'
      ? await seedStarterNotes(noteStore)
      : await resetStarterNotes(noteStore)

  if (result.status === 'skipped') {
    console.log(
      `Skipped seeding ${target.label} because it already contains ${result.existingCount} notes. Run "npm run reset:data" to replace them.`,
    )
  } else {
    const actionLabel = command === 'seed' ? 'Seeded' : 'Reset'
    console.log(`${actionLabel} ${result.noteCount} starter notes in ${target.label}.`)
  }
} finally {
  await noteStore.close()
}
