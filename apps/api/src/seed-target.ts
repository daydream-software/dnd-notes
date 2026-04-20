import {
  resolveNoteDbPath,
  resolveNoteStoreBackend,
  type CreateNoteStoreOptions,
} from './note-store.js'

export interface SeedTarget {
  backend: 'sqlite' | 'postgres'
  noteStoreOptions: CreateNoteStoreOptions
  label: string
}

export function resolveSeedTarget(
  environment: NodeJS.ProcessEnv = process.env,
): SeedTarget {
  const backend = resolveNoteStoreBackend({}, environment)

  if (backend === 'postgres') {
    return {
      backend,
      noteStoreOptions: {},
      label: 'postgres',
    }
  }

  const dbPath = resolveNoteDbPath({}, environment)

  return {
    backend,
    noteStoreOptions: { dbPath },
    label: dbPath,
  }
}
