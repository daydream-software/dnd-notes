interface QueryableClient {
  query(text: string, values?: readonly unknown[]): Promise<unknown>
}

const tenantNoteStoreSchemaSql = `
  CREATE TABLE IF NOT EXISTS owner_accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_site_admin INTEGER NOT NULL DEFAULT 0,
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

export async function initializeTenantNoteStoreDatabase(
  client: QueryableClient,
): Promise<void> {
  await client.query(tenantNoteStoreSchemaSql)
  await client.query(
    'UPDATE owner_accounts SET email = LOWER(email) WHERE email != LOWER(email)',
  )
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_accounts_email_lower
    ON owner_accounts(LOWER(email));
  `)
}

export async function applyLeastPrivilegeTenantGrants(
  client: QueryableClient,
  runtimeRoleName: string,
): Promise<void> {
  const role = quoteIdentifier(runtimeRoleName)

  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
  await client.query(`REVOKE CREATE ON SCHEMA public FROM ${role}`)
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`)
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
  )
  await client.query(
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
  )
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
  )
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`,
  )
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`)
  }

  return `"${identifier.replace(/"/g, '""')}"`
}
