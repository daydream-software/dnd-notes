import { type CreateNoteStoreOptions } from './note-store.js'

export interface SeedTarget {
  backend: 'postgres'
  noteStoreOptions: CreateNoteStoreOptions
  label: string
}

export function resolveSeedTarget(
  environment: NodeJS.ProcessEnv = process.env,
): SeedTarget {
  if (!environment.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required for seed workflows in the Postgres-only API runtime.')
  }

  return {
    backend: 'postgres',
    noteStoreOptions: {},
    label: 'postgres',
  }
}
