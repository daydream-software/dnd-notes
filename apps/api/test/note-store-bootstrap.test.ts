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

class FakePostgresDatabase implements NoteStoreDatabase {
  readonly kind = 'postgres' as const
  readonly executedSql: string[] = []
  loweredEmails = false
  promotedEmails: string[] = []

  constructor(
    private readonly options: {
      allowSchemaChanges: boolean
      ownerEmails?: string[]
      ownerEmailIndexDefinition?: string | null
      ownerKeycloakSubIndexDefinition?: string | null
      ownerAccountColumns?: readonly string[]
      ownerAccountUniqueColumns?: readonly string[]
      privilegeCheckError?: Error
      tableNames?: readonly string[]
    },
  ) {}

  prepare(sql: string) {
    return {
      get: async (...params: unknown[]) => {
        if (sql.includes('has_schema_privilege')) {
          if (this.options.privilegeCheckError) {
            throw this.options.privilegeCheckError
          }

          return { can_create: this.options.allowSchemaChanges }
        }

        if (sql.includes('FROM information_schema.tables')) {
          const tableName = String(params[0] ?? '')

          if (this.options.tableNames?.includes(tableName)) {
            return { table_name: tableName }
          }

          return undefined
        }

        if (sql.includes('FROM pg_indexes')) {
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

        if (sql.includes('FROM information_schema.table_constraints')) {
          const uniqueColumns = this.options.ownerAccountUniqueColumns ?? []
          const includesKeycloakSub = uniqueColumns.includes('keycloak_sub')
          const requiresStandaloneKeycloakSub =
            sql.includes('HAVING COUNT(*) = 1') &&
            sql.includes("MIN(kcu.column_name) = 'keycloak_sub'") &&
            sql.includes("MAX(kcu.column_name) = 'keycloak_sub'")

          if (!includesKeycloakSub) {
            return undefined
          }

          return !requiresStandaloneKeycloakSub ||
            (uniqueColumns.length === 1 && uniqueColumns[0] === 'keycloak_sub')
            ? { constraint_name: 'owner_accounts_keycloak_sub_key' }
            : undefined
        }

        throw new Error(`Unexpected get SQL in test double: ${sql}`)
      },
      all: async () => {
        if (sql.includes('SELECT email') && sql.includes('FROM owner_accounts')) {
          return (this.options.ownerEmails ?? []).map((email) => ({ email }))
        }

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

test('least-privilege postgres runtime skips schema DDL after control-plane bootstrap', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: false,
    ownerEmails: ['Admin@Example.com'],
    ownerEmailIndexDefinition,
    ownerAccountColumns: ['keycloak_sub'],
    ownerAccountUniqueColumns: ['keycloak_sub'],
    tableNames: requiredPostgresTables,
  })

  await initializeNoteStoreDatabase(database, new Set(['admin@example.com']))

  assert.deepEqual(database.executedSql, [])
  assert.equal(database.loweredEmails, true)
  assert.deepEqual(database.promotedEmails, ['admin@example.com'])
})

test('schema-capable postgres runtime reapplies idempotent schema SQL after control-plane bootstrap', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: true,
    tableNames: requiredPostgresTables,
  })

  await initializeNoteStoreDatabase(database, new Set())

  assert.match(database.executedSql[0] ?? '', /CREATE TABLE IF NOT EXISTS owner_accounts/)
  assert.match(
    database.executedSql[0] ?? '',
    /CREATE INDEX IF NOT EXISTS idx_note_references_target/i,
  )
})

test('least-privilege postgres runtime accepts a unique keycloak_sub index', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: false,
    ownerEmails: ['Admin@Example.com'],
    ownerEmailIndexDefinition,
    ownerAccountColumns: ['keycloak_sub'],
    ownerKeycloakSubIndexDefinition:
      'CREATE UNIQUE INDEX idx_owner_accounts_keycloak_sub ON public.owner_accounts USING btree (keycloak_sub) WHERE (keycloak_sub IS NOT NULL)',
    tableNames: requiredPostgresTables,
  })

  await initializeNoteStoreDatabase(database, new Set(['admin@example.com']))

  assert.deepEqual(database.executedSql, [])
})

test('least-privilege postgres runtime rejects composite keycloak_sub unique constraints', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: false,
    ownerEmails: ['Admin@Example.com'],
    ownerEmailIndexDefinition,
    ownerAccountColumns: ['keycloak_sub'],
    ownerAccountUniqueColumns: ['keycloak_sub', 'tenant_id'],
    tableNames: requiredPostgresTables,
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set(['admin@example.com'])),
    /unique owner_accounts\.keycloak_sub enforcement/,
  )
})

test('least-privilege postgres runtime rejects composite keycloak_sub unique indexes', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: false,
    ownerEmails: ['Admin@Example.com'],
    ownerEmailIndexDefinition,
    ownerAccountColumns: ['keycloak_sub'],
    ownerKeycloakSubIndexDefinition:
      'CREATE UNIQUE INDEX idx_owner_accounts_keycloak_sub ON public.owner_accounts USING btree (keycloak_sub, tenant_id) WHERE (keycloak_sub IS NOT NULL)',
    tableNames: requiredPostgresTables,
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set(['admin@example.com'])),
    /unique owner_accounts\.keycloak_sub enforcement/,
  )
})

test('least-privilege postgres runtime fails fast when the pre-initialized schema is incomplete', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: false,
    tableNames: requiredPostgresTables.filter((tableName) => tableName !== 'note_references'),
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set()),
    /missing tables: note_references/,
  )
  assert.deepEqual(database.executedSql, [])
})

test('least-privilege postgres runtime fails fast when the owner email uniqueness index is missing', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: false,
    ownerEmails: ['Admin@Example.com'],
    ownerAccountColumns: ['keycloak_sub'],
    ownerAccountUniqueColumns: ['keycloak_sub'],
    tableNames: requiredPostgresTables,
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set(['admin@example.com'])),
    /idx_owner_accounts_email_lower unique index/,
  )
  assert.deepEqual(database.executedSql, [])
})

test('least-privilege postgres runtime fails fast when owner_accounts.keycloak_sub is missing', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: false,
    ownerEmails: ['Admin@Example.com'],
    ownerEmailIndexDefinition,
    tableNames: requiredPostgresTables,
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set(['admin@example.com'])),
    /owner_accounts\.keycloak_sub column/,
  )
  assert.deepEqual(database.executedSql, [])
})

test('least-privilege postgres runtime fails fast when owner_accounts.keycloak_sub is not unique', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: false,
    ownerEmails: ['Admin@Example.com'],
    ownerEmailIndexDefinition,
    ownerAccountColumns: ['keycloak_sub'],
    tableNames: requiredPostgresTables,
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set(['admin@example.com'])),
    /unique owner_accounts\.keycloak_sub enforcement/,
  )
  assert.deepEqual(database.executedSql, [])
})

test('pg-mem style privilege lookup failures fall back to schema bootstrap', async () => {
  const database = new FakePostgresDatabase({
    allowSchemaChanges: false,
    ownerEmails: [],
    privilegeCheckError: new Error(
      'function has_schema_privilege(text,text) does not exist',
    ),
  })

  await initializeNoteStoreDatabase(database, new Set())

  assert.equal(database.executedSql.length, 4)
  assert.match(database.executedSql[1] ?? '', /ADD COLUMN IF NOT EXISTS keycloak_sub TEXT/)
  assert.match(
    database.executedSql[2] ?? '',
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_accounts_keycloak_sub/i,
  )
})
