import assert from 'node:assert/strict'
import test from 'node:test'
import { initializeTenantNoteStoreDatabase } from '../src/tenant-database-bootstrap.js'

test('tenant database bootstrap includes owner_accounts.keycloak_sub in the provisioned schema', async () => {
  const executedQueries: string[] = []

  const client = {
    async query(text: string) {
      executedQueries.push(text)
      return {}
    },
  }

  await initializeTenantNoteStoreDatabase(client)

  assert.match(executedQueries[0] ?? '', /keycloak_sub TEXT/)
  assert.doesNotMatch(executedQueries[0] ?? '', /keycloak_sub TEXT UNIQUE/)
  assert.match(executedQueries[1] ?? '', /ADD COLUMN IF NOT EXISTS keycloak_sub TEXT/)
  assert.match(
    executedQueries[2] ?? '',
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_accounts_keycloak_sub/,
  )
  assert.match(executedQueries[3] ?? '', /UPDATE owner_accounts SET email = LOWER\(email\)/)
  assert.match(executedQueries[4] ?? '', /idx_owner_accounts_email_lower/)
})
