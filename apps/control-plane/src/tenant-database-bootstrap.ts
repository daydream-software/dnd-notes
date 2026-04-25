import { runTenantApiMigrations } from './migrations.js'
import type { MigrationPoolLike } from './migrate.js'

interface QueryableClient {
  query(text: string, values?: readonly unknown[]): Promise<unknown>
}

/**
 * Bootstrap or upgrade the tenant API note-store schema using the authoritative
 * tenant API migration set while the control-plane still holds admin database
 * credentials. Tenant runtime pods only verify the schema later under their
 * least-privilege runtime role.
 */
export async function initializeTenantNoteStoreDatabase(
  pool: MigrationPoolLike,
): Promise<void> {
  await runTenantApiMigrations({ pool })
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
