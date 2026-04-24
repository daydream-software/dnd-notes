import { type CreateNoteStoreOptions } from './note-store.js'

export interface SeedTarget {
  noteStoreOptions: CreateNoteStoreOptions
  label: string
}

export function resolveSeedTarget(
  environment: NodeJS.ProcessEnv = process.env,
): SeedTarget {
  const databaseUrl = environment.DATABASE_URL?.trim()

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for seed workflows in the Postgres-only API runtime.')
  }

  return {
    noteStoreOptions: { databaseUrl },
    label: 'postgres',
  }
}
