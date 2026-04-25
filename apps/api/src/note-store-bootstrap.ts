import type { NoteStoreDatabase } from './note-store-database.js'

const requiredPostgresTableNames = [
  'owner_accounts',
  'owner_sessions',
  'campaigns',
  'campaign_memberships',
  'campaign_share_links',
  'notes',
  'note_references',
] as const

export interface InitializeNoteStoreDatabaseOptions {
  /**
   * Retained for backwards compatibility with existing callers and tests.
   * Schema changes are now applied exclusively through the migration runner
   * before this function is invoked, so this option no longer affects DDL.
   */
  allowSchemaChanges?: boolean
}

async function listMissingRequiredPostgresTables(database: NoteStoreDatabase) {
  const missingTables: string[] = []

  for (const tableName of requiredPostgresTableNames) {
    const existing = await database
      .prepare<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = ?
      `)
      .get(tableName)

    if (!existing) {
      missingTables.push(tableName)
    }
  }

  return missingTables
}

async function ensureRequiredPostgresTables(database: NoteStoreDatabase) {
  const missingTables = await listMissingRequiredPostgresTables(database)

  if (missingTables.length > 0) {
    throw new Error(
      `Postgres note store schema is incomplete; missing tables: ${missingTables.join(', ')}. Run "npm run db:migrate" before starting the API.`,
    )
  }
}

async function tryFetchIndexDefinition(
  database: NoteStoreDatabase,
  indexName: string,
): Promise<string | null | 'unsupported'> {
  try {
    const row = await database
      .prepare<{ indexdef: string }>(`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = ?
      `)
      .get(indexName)
    return row?.indexdef ?? null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/pg_indexes/i.test(message) && /does not exist/i.test(message)) {
      // pg-mem and similar adapters don't expose pg_indexes; trust migrations.
      return 'unsupported'
    }
    throw error
  }
}

async function ensureRequiredPostgresIndexes(database: NoteStoreDatabase) {
  const indexDefinition = await tryFetchIndexDefinition(
    database,
    'idx_owner_accounts_email_lower',
  )

  if (indexDefinition === 'unsupported') {
    return
  }

  const definition = indexDefinition ?? ''
  const hasOwnerEmailUniquenessIndex =
    /\bcreate unique index\b/i.test(definition) &&
    /\bon\b.*owner_accounts\b/i.test(definition) &&
    /lower\s*\(.*email/i.test(definition)

  if (!hasOwnerEmailUniquenessIndex) {
    throw new Error(
      'Postgres note store is missing the idx_owner_accounts_email_lower unique index. Run "npm run db:migrate" before starting the API.',
    )
  }
}

async function ensureRequiredPostgresOwnerAccountKeycloakSub(
  database: NoteStoreDatabase,
) {
  const keycloakSubColumn = await database
    .prepare<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'owner_accounts'
        AND column_name = 'keycloak_sub'
    `)
    .get()

  if (!keycloakSubColumn) {
    throw new Error(
      'Postgres note store is missing the owner_accounts.keycloak_sub column. Run "npm run db:migrate" before starting the API.',
    )
  }

  const indexDefinition = await tryFetchIndexDefinition(
    database,
    'idx_owner_accounts_keycloak_sub',
  )

  if (indexDefinition === 'unsupported') {
    return
  }

  const definition = indexDefinition ?? ''
  const hasKeycloakSubUniqueIndex =
    /\bcreate unique index\b/i.test(definition) &&
    /\bon\b.*owner_accounts\b/i.test(definition) &&
    /\(\s*"?(?:public\.)?keycloak_sub"?\s*\)/i.test(definition)

  if (!hasKeycloakSubUniqueIndex) {
    throw new Error(
      'Postgres note store is missing unique enforcement for owner_accounts.keycloak_sub. Run "npm run db:migrate" before starting the API.',
    )
  }
}

async function elevateConfiguredSiteAdminAccounts(
  database: NoteStoreDatabase,
  configuredSiteAdminEmails: ReadonlySet<string>,
) {
  if (configuredSiteAdminEmails.size === 0) {
    return
  }

  const placeholders = Array.from(
    { length: configuredSiteAdminEmails.size },
    () => '?',
  ).join(', ')
  const timestamp = new Date().toISOString()

  await database
    .prepare(`
      UPDATE owner_accounts
      SET is_site_admin = 1,
          updated_at = ?
      WHERE is_site_admin != 1
        AND lower(email) IN (${placeholders})
    `)
    .run(timestamp, ...configuredSiteAdminEmails)
}

async function ensureOwnerEmailsLowercased(database: NoteStoreDatabase) {
  await database
    .prepare(`UPDATE owner_accounts SET email = LOWER(email) WHERE email != LOWER(email)`)
    .run()
}

/**
 * Verifier and data-fixup pass that runs after the migration runner has applied
 * all schema migrations. It does NOT emit DDL; it only confirms that the
 * expected tables/indexes/columns exist and applies idempotent data steps.
 */
export async function initializeNoteStoreDatabase(
  database: NoteStoreDatabase,
  configuredSiteAdminEmails: ReadonlySet<string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- option retained for caller compatibility
  _options: InitializeNoteStoreDatabaseOptions = {},
) {
  await ensureRequiredPostgresTables(database)
  await ensureRequiredPostgresOwnerAccountKeycloakSub(database)
  await ensureRequiredPostgresIndexes(database)
  await ensureOwnerEmailsLowercased(database)
  await elevateConfiguredSiteAdminAccounts(database, configuredSiteAdminEmails)
}
