-- Baseline control-plane registry schema.
--
-- This migration recreates the schema previously emitted implicitly by
-- TenantRegistry.bootstrap()/migrateLegacySchema() (see issue #93). It is
-- idempotent (CREATE TABLE/INDEX IF NOT EXISTS), so it is safe to apply
-- against an already-bootstrapped database that was provisioned by the
-- pre-migration-framework codebase.
--
-- Tenant-state values are inlined here intentionally. Adding a new tenant
-- state, storage mode, or storage migration status is a schema change and
-- requires its own additive migration that widens the CHECK constraint.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  subdomain TEXT,
  owner_id TEXT NOT NULL,
  display_name TEXT,
  plan_tier TEXT,
  initial_admin_email TEXT,
  desired_state TEXT NOT NULL CHECK (desired_state IN (
    'provisioning', 'ready', 'maintenance', 'upgrading',
    'restoring', 'failed', 'deprovisioned'
  )),
  current_state TEXT NOT NULL CHECK (current_state IN (
    'provisioning', 'ready', 'maintenance', 'upgrading',
    'restoring', 'failed', 'deprovisioned'
  )),
  version TEXT NOT NULL,
  storage_reference TEXT,
  backup_metadata TEXT,
  storage_mode TEXT NOT NULL DEFAULT 'unknown'
    CHECK (storage_mode IN (
      'unknown', 'sqlite-pvc', 'postgres-shared-user', 'postgres-dedicated-user'
    )),
  storage_migration_status TEXT NOT NULL DEFAULT 'not-started'
    CHECK (storage_migration_status IN (
      'not-started', 'in-progress', 'failed', 'completed', 'not-required'
    )),
  storage_migration_failure_reason TEXT,
  storage_migration_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS state_transitions (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL CHECK (from_state IN (
    'provisioning', 'ready', 'maintenance', 'upgrading',
    'restoring', 'failed', 'deprovisioned'
  )),
  to_state TEXT NOT NULL CHECK (to_state IN (
    'provisioning', 'ready', 'maintenance', 'upgrading',
    'restoring', 'failed', 'deprovisioned'
  )),
  triggered_by TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  billing_email TEXT,
  billing_provider TEXT,
  password_hash TEXT,
  auth_provider TEXT NOT NULL CHECK (auth_provider IN ('local', 'keycloak')),
  keycloak_sub TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_metadata (key, value)
VALUES (
  'tenant_state_signature',
  'provisioning,ready,maintenance,upgrading,restoring,failed,deprovisioned'
)
ON CONFLICT (key) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_subdomain
  ON tenants(subdomain)
  WHERE subdomain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_owner_id
  ON tenants(owner_id);

CREATE INDEX IF NOT EXISTS idx_state_transitions_tenant_id
  ON state_transitions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_state_transitions_created_at
  ON state_transitions(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_keycloak_sub
  ON portal_accounts(keycloak_sub)
  WHERE keycloak_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_portal_sessions_account_id
  ON portal_sessions(account_id);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_expires_at
  ON portal_sessions(expires_at);
