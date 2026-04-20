import type { NoteStoreDatabase } from './note-store-database.js'

const pragmaTableNames = ['notes', 'owner_accounts', 'campaign_share_links'] as const
type PragmaTableName = (typeof pragmaTableNames)[number]
const pragmaTableNameSet = new Set<string>(pragmaTableNames)

async function tableExists(database: NoteStoreDatabase, tableName: string) {
  return database
    .prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `)
    .get(tableName)
}

async function listTableColumns(database: NoteStoreDatabase, tableName: PragmaTableName) {
  if (!pragmaTableNameSet.has(tableName)) {
    throw new Error(`Unsupported PRAGMA table lookup for "${tableName}".`)
  }

  return new Set(
    ((await database.prepare(`
        PRAGMA table_info("${tableName}")
      `).all()) as Array<{ name: string }>).map((column) => column.name),
  )
}

async function ensureNotesAttributionColumns(database: NoteStoreDatabase) {
  if (database.kind !== 'sqlite') {
    return
  }

  const transaction = database.transaction(async () => {
    if (!(await tableExists(database, 'notes'))) {
      return
    }

    const noteColumns = await listTableColumns(database, 'notes')

    if (!noteColumns.has('created_by_membership_id')) {
      await database.exec(`
        ALTER TABLE notes
        ADD COLUMN created_by_membership_id TEXT REFERENCES campaign_memberships(id)
      `)
    }

    if (!noteColumns.has('last_edited_by_membership_id')) {
      await database.exec(`
        ALTER TABLE notes
        ADD COLUMN last_edited_by_membership_id TEXT REFERENCES campaign_memberships(id)
      `)
    }

    if (!noteColumns.has('linked_notes_json')) {
      await database.exec(`
        ALTER TABLE notes
        ADD COLUMN linked_notes_json TEXT NOT NULL DEFAULT '[]'
      `)
    }
  })

  await transaction()
}

async function ensureOwnerSiteAdminColumn(database: NoteStoreDatabase) {
  if (database.kind !== 'sqlite') {
    return
  }

  const transaction = database.transaction(async () => {
    if (!(await tableExists(database, 'owner_accounts'))) {
      return
    }

    const ownerColumns = await listTableColumns(database, 'owner_accounts')

    if (!ownerColumns.has('is_site_admin')) {
      await database.exec(`
        ALTER TABLE owner_accounts
        ADD COLUMN is_site_admin INTEGER NOT NULL DEFAULT 0
      `)
    }
  })

  await transaction()
}

async function ensureShareLinkRevealTokens(database: NoteStoreDatabase) {
  if (database.kind !== 'sqlite') {
    return
  }

  const transaction = database.transaction(async () => {
    if (!(await tableExists(database, 'campaign_share_links'))) {
      return
    }

    const shareLinkColumns = await listTableColumns(database, 'campaign_share_links')

    if (!shareLinkColumns.has('token_plaintext')) {
      await database.exec(`
        ALTER TABLE campaign_share_links
        ADD COLUMN token_plaintext TEXT
      `)
    }
  })

  await transaction()
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

export async function initializeNoteStoreDatabase(
  database: NoteStoreDatabase,
  configuredSiteAdminEmails: ReadonlySet<string>,
) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS owner_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_site_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_owner_accounts_email_lower
    ON owner_accounts(LOWER(email));

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
  `)
  await ensureOwnerSiteAdminColumn(database)
  await ensureNotesAttributionColumns(database)
  await ensureShareLinkRevealTokens(database)
  await elevateConfiguredSiteAdminAccounts(database, configuredSiteAdminEmails)
}
