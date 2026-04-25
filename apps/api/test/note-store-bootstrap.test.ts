import assert from 'node:assert/strict'
import test from 'node:test'
import { initializeNoteStoreDatabase } from '../src/note-store-bootstrap.js'
import type { NoteStoreDatabase } from '../src/note-store-database.js'

const requiredPostgresTables = [
  'owner_accounts',
  'owner_sessions',
  'campaigns',
  'campaign_memberships',
  'campaign_share_links',
  'notes',
  'note_references',
] as const

const ownerEmailIndexDefinition =
  'CREATE UNIQUE INDEX idx_owner_accounts_email_lower ON public.owner_accounts USING btree (lower((email)::text))'

const keycloakSubIndexDefinition =
  'CREATE UNIQUE INDEX idx_owner_accounts_keycloak_sub ON public.owner_accounts USING btree (keycloak_sub) WHERE (keycloak_sub IS NOT NULL)'

interface FakePostgresOptions {
  ownerEmails?: string[]
  ownerEmailIndexDefinition?: string | null
  ownerKeycloakSubIndexDefinition?: string | null
  ownerAccountColumns?: readonly string[]
  tableNames?: readonly string[]
  pgIndexesUnsupported?: boolean
}

class FakePostgresDatabase implements NoteStoreDatabase {
  readonly kind = 'postgres' as const
  readonly executedSql: string[] = []
  loweredEmails = false
  promotedEmails: string[] = []

  constructor(private readonly options: FakePostgresOptions) {}

  prepare(sql: string) {
    return {
      get: async (...params: unknown[]) => {
        if (sql.includes('FROM information_schema.tables')) {
          const tableName = String(params[0] ?? '')
          if (this.options.tableNames?.includes(tableName)) {
            return { table_name: tableName }
          }
          return undefined
        }

        if (sql.includes('FROM pg_indexes')) {
          if (this.options.pgIndexesUnsupported) {
            throw new Error('relation "pg_indexes" does not exist')
          }
          const indexName = String(params[0] ?? '')
          if (
            indexName === 'idx_owner_accounts_email_lower' &&
            this.options.ownerEmailIndexDefinition
          ) {
            return { indexdef: this.options.ownerEmailIndexDefinition }
          }
          if (
            indexName === 'idx_owner_accounts_keycloak_sub' &&
            this.options.ownerKeycloakSubIndexDefinition
          ) {
            return { indexdef: this.options.ownerKeycloakSubIndexDefinition }
          }
          return undefined
        }

        if (sql.includes('FROM information_schema.columns')) {
          return this.options.ownerAccountColumns?.includes('keycloak_sub')
            ? { column_name: 'keycloak_sub' }
            : undefined
        }

        throw new Error(`Unexpected get SQL in test double: ${sql}`)
      },
      all: async () => {
        throw new Error(`Unexpected all SQL in test double: ${sql}`)
      },
      run: async (...params: unknown[]) => {
        if (sql.includes('UPDATE owner_accounts SET email = LOWER(email)')) {
          this.loweredEmails = true
          return { changes: 0 }
        }

        if (sql.includes('SET is_site_admin = 1')) {
          this.promotedEmails = params.slice(1).map((value) => String(value))
          return { changes: this.promotedEmails.length }
        }

        throw new Error(`Unexpected run SQL in test double: ${sql}`)
      },
    }
  }

  async exec(sql: string) {
    this.executedSql.push(sql)
  }

  transaction<Args extends unknown[], Result>(
    callback: (...args: Args) => Promise<Result>,
  ) {
    return (...args: Args) => callback(...args)
  }

  async close() {}
}

test('verifier passes when migrations have already provisioned the schema', async () => {
  const database = new FakePostgresDatabase({
    ownerEmails: ['Admin@Example.com'],
    ownerEmailIndexDefinition,
    ownerKeycloakSubIndexDefinition: keycloakSubIndexDefinition,
    ownerAccountColumns: ['keycloak_sub'],
    tableNames: requiredPostgresTables,
  })

  await initializeNoteStoreDatabase(database, new Set(['admin@example.com']))

  assert.deepEqual(database.executedSql, [])
  assert.equal(database.loweredEmails, true)
  assert.deepEqual(database.promotedEmails, ['admin@example.com'])
})

test('verifier fails fast when a required table is missing', async () => {
  const database = new FakePostgresDatabase({
    ownerEmailIndexDefinition,
    ownerKeycloakSubIndexDefinition: keycloakSubIndexDefinition,
    ownerAccountColumns: ['keycloak_sub'],
    tableNames: requiredPostgresTables.filter((name) => name !== 'notes'),
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set()),
    /missing tables: notes/,
  )
})

test('verifier fails fast when owner_accounts.keycloak_sub is missing', async () => {
  const database = new FakePostgresDatabase({
    ownerEmailIndexDefinition,
    ownerKeycloakSubIndexDefinition: keycloakSubIndexDefinition,
    ownerAccountColumns: [],
    tableNames: requiredPostgresTables,
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set()),
    /owner_accounts\.keycloak_sub column/,
  )
})

test('verifier fails fast when the keycloak_sub unique index is missing', async () => {
  const database = new FakePostgresDatabase({
    ownerEmailIndexDefinition,
    ownerKeycloakSubIndexDefinition: null,
    ownerAccountColumns: ['keycloak_sub'],
    tableNames: requiredPostgresTables,
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set()),
    /unique enforcement for owner_accounts\.keycloak_sub/,
  )
})

test('verifier fails fast when the owner email uniqueness index is missing', async () => {
  const database = new FakePostgresDatabase({
    ownerEmailIndexDefinition: null,
    ownerKeycloakSubIndexDefinition: keycloakSubIndexDefinition,
    ownerAccountColumns: ['keycloak_sub'],
    tableNames: requiredPostgresTables,
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set()),
    /idx_owner_accounts_email_lower unique index/,
  )
})

test('verifier tolerates adapters that do not expose pg_indexes', async () => {
  const database = new FakePostgresDatabase({
    ownerEmails: [],
    ownerAccountColumns: ['keycloak_sub'],
    tableNames: requiredPostgresTables,
    pgIndexesUnsupported: true,
  })

  await initializeNoteStoreDatabase(database, new Set())
})
