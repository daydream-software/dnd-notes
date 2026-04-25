import { runTenantBootstrapMigrations } from './migrations.js'
import type { MigrationPoolLike } from './migrate.js'

interface QueryableClient {
  query(text: string, values?: readonly unknown[]): Promise<unknown>
}

/**
 * Bootstrap the tenant API note-store schema in a freshly created tenant
 * database. Delegates to the migration framework so every tenant starts at
 * the same revision the tenant API expects.
 */
export async function initializeTenantNoteStoreDatabase(
  pool: MigrationPoolLike,
): Promise<void> {
  await runTenantBootstrapMigrations({ pool })
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
