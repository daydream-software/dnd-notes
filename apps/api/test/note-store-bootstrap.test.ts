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
      tableNames?: readonly string[]
    },
  ) {}

  prepare(sql: string) {
    return {
      get: async (...params: unknown[]) => {
        if (sql.includes('has_schema_privilege')) {
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

          return undefined
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
    tableNames: requiredPostgresTables,
  })

  await initializeNoteStoreDatabase(database, new Set(['admin@example.com']))

  assert.deepEqual(database.executedSql, [])
  assert.equal(database.loweredEmails, true)
  assert.deepEqual(database.promotedEmails, ['admin@example.com'])
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
    tableNames: requiredPostgresTables,
  })

  await assert.rejects(
    initializeNoteStoreDatabase(database, new Set(['admin@example.com'])),
    /idx_owner_accounts_email_lower unique index/,
  )
  assert.deepEqual(database.executedSql, [])
})
