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

const noteStoreSchemaSql = `
  CREATE TABLE IF NOT EXISTS owner_accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_site_admin INTEGER NOT NULL DEFAULT 0,
    keycloak_sub TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS owner_sessions (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES owner_accounts(id),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_owner_sessions_owner_user_id
  ON owner_sessions(owner_user_id);

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    system TEXT NOT NULL,
    setting TEXT NOT NULL,
    next_session TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaign_memberships (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id),
    role TEXT NOT NULL,
    display_name TEXT NOT NULL,
    user_id TEXT REFERENCES owner_accounts(id),
    guest_token_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_campaign_memberships_campaign_id
  ON campaign_memberships(campaign_id);

  CREATE INDEX IF NOT EXISTS idx_campaign_memberships_user_id
  ON campaign_memberships(user_id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_memberships_guest_token_id
  ON campaign_memberships(guest_token_id)
  WHERE guest_token_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS campaign_share_links (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id),
    token_hash TEXT NOT NULL UNIQUE,
    token_plaintext TEXT,
    label TEXT,
    access_level TEXT NOT NULL,
    frame_ancestors TEXT,
    expires_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_campaign_share_links_campaign_id
  ON campaign_share_links(campaign_id);

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    linked_notes_json TEXT NOT NULL DEFAULT '[]',
    session_name TEXT,
    created_by_membership_id TEXT REFERENCES campaign_memberships(id),
    last_edited_by_membership_id TEXT REFERENCES campaign_memberships(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notes_campaign_updated_at
  ON notes(campaign_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS note_references (
    id TEXT PRIMARY KEY,
    source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id),
    reference_type TEXT NOT NULL,
    label TEXT,
    qualifier TEXT,
    position_in_body INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_note_references_target
  ON note_references(target_note_id, campaign_id);

  CREATE INDEX IF NOT EXISTS idx_note_references_source
  ON note_references(source_note_id, campaign_id);
`

export interface InitializeNoteStoreDatabaseOptions {
  allowSchemaChanges?: boolean
}

type PostgresSchemaMode =
  | 'schema-capable'
  | 'least-privilege'
  | 'pg-mem-fallback'

async function determinePostgresSchemaMode(
  database: NoteStoreDatabase,
  options: InitializeNoteStoreDatabaseOptions,
): Promise<PostgresSchemaMode> {
  if (options.allowSchemaChanges !== undefined) {
    return options.allowSchemaChanges ? 'schema-capable' : 'least-privilege'
  }

  try {
    const privileges = await database
      .prepare<{ can_create: boolean | string }>(`
        SELECT has_schema_privilege(current_schema(), 'CREATE') AS can_create
      `)
      .get()

    return privileges?.can_create === true || privileges?.can_create === 't'
      ? 'schema-capable'
      : 'least-privilege'
  } catch (error) {
    if (
      error instanceof Error &&
      /function has_schema_privilege\(text,text\) does not exist/i.test(error.message)
    ) {
      return 'pg-mem-fallback'
    }

    console.error(
      '[note-store-bootstrap] Failed to check schema privileges; assuming least-privilege mode:',
      error,
    )
    return 'least-privilege'
  }
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
      `Postgres note store requires a pre-initialized schema for least-privilege runtime credentials; missing tables: ${missingTables.join(', ')}`,
    )
  }
}

async function ensureRequiredPostgresIndexes(database: NoteStoreDatabase) {
  const ownerEmailIndex = await database
    .prepare<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = ?
    `)
    .get('idx_owner_accounts_email_lower')

  const indexDefinition = ownerEmailIndex?.indexdef ?? ''
  const hasOwnerEmailUniquenessIndex =
    /\bcreate unique index\b/i.test(indexDefinition) &&
    /\bon\b.*owner_accounts\b/i.test(indexDefinition) &&
    /lower\s*\(.*email/i.test(indexDefinition)

  if (!hasOwnerEmailUniquenessIndex) {
    throw new Error(
      'Postgres note store requires the idx_owner_accounts_email_lower unique index for least-privilege runtime credentials.',
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
      'Postgres note store requires the owner_accounts.keycloak_sub column for least-privilege runtime credentials.',
    )
  }

  const keycloakSubUniqueConstraint = await database
    .prepare<{ constraint_name: string }>(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      INNER JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      WHERE tc.table_schema = current_schema()
        AND tc.table_name = 'owner_accounts'
        AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name
      HAVING COUNT(*) = 1
         AND MIN(kcu.column_name) = 'keycloak_sub'
         AND MAX(kcu.column_name) = 'keycloak_sub'
      LIMIT 1
    `)
    .get()

  const keycloakSubUniqueIndex = await database
    .prepare<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = ?
    `)
    .get('idx_owner_accounts_keycloak_sub')

  const indexDefinition = keycloakSubUniqueIndex?.indexdef ?? ''
  const hasKeycloakSubUniqueIndex =
    /\bcreate unique index\b/i.test(indexDefinition) &&
    /\bon\b.*owner_accounts\b/i.test(indexDefinition) &&
    /\(\s*"?(?:public\.)?keycloak_sub"?\s*\)/i.test(indexDefinition)

  if (!keycloakSubUniqueConstraint && !hasKeycloakSubUniqueIndex) {
    throw new Error(
      'Postgres note store requires unique owner_accounts.keycloak_sub enforcement for least-privilege runtime credentials.',
    )
  }
}

async function ensureOwnerKeycloakSubColumn(
  database: NoteStoreDatabase,
  options: { allowSchemaChanges: boolean },
) {
  if (!options.allowSchemaChanges) {
    return
  }

  await database.exec(`
    ALTER TABLE owner_accounts
    ADD COLUMN IF NOT EXISTS keycloak_sub TEXT
  `)
  await database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_accounts_keycloak_sub
    ON owner_accounts(keycloak_sub)
    WHERE keycloak_sub IS NOT NULL
  `)
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

async function ensureOwnerEmailUniqueness(
  database: NoteStoreDatabase,
  options: { allowSchemaChanges: boolean },
) {
  const existingEmails = (await database
    .prepare<{ email: string }>(`
      SELECT email
      FROM owner_accounts
    `)
    .all()) as Array<{ email: string }>
  const normalizedEmails = new Set<string>()
  let duplicate: string | undefined

  for (const row of existingEmails) {
    const normalizedEmail = row.email.toLowerCase()

    if (normalizedEmails.has(normalizedEmail)) {
      duplicate = normalizedEmail
      break
    }

    normalizedEmails.add(normalizedEmail)
  }

  if (duplicate) {
    throw new Error(
      `Owner accounts contain duplicate email addresses for "${duplicate}" when compared case-insensitively.`,
    )
  }

  await database.prepare(`UPDATE owner_accounts SET email = LOWER(email) WHERE email != LOWER(email)`).run()

  if (!options.allowSchemaChanges) {
    await ensureRequiredPostgresIndexes(database)
    return
  }

  await database.exec(`
    DROP INDEX IF EXISTS idx_owner_accounts_email_lower;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_accounts_email_lower
    ON owner_accounts(LOWER(email));
  `)
}

export async function initializeNoteStoreDatabase(
  database: NoteStoreDatabase,
  configuredSiteAdminEmails: ReadonlySet<string>,
  options: InitializeNoteStoreDatabaseOptions = {},
) {
  const schemaMode = await determinePostgresSchemaMode(database, options)
  const allowSchemaChanges = schemaMode !== 'least-privilege'

  if (schemaMode === 'schema-capable') {
    await database.exec(noteStoreSchemaSql)
  } else if (schemaMode === 'pg-mem-fallback') {
    const missingTables = await listMissingRequiredPostgresTables(database)

    if (missingTables.length > 0) {
      await database.exec(noteStoreSchemaSql)
    }
  } else {
    await ensureRequiredPostgresTables(database)
    await ensureRequiredPostgresOwnerAccountKeycloakSub(database)
  }

  await ensureOwnerKeycloakSubColumn(database, { allowSchemaChanges })
  await ensureOwnerEmailUniqueness(database, { allowSchemaChanges })
  await elevateConfiguredSiteAdminAccounts(database, configuredSiteAdminEmails)
}
