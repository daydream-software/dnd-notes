-- Scale-to-zero: tenant_activity table + sleeping state (#340).
--
-- Two changes:
--
-- 1. tenant_activity table
--    Written by the activator on every proxied request; read by the idle scaler
--    CronJob to decide which tenants have been idle longer than the threshold.
--    Primary key is tenant_id. UPSERT pattern: activator does
--    INSERT ... ON CONFLICT (tenant_id) DO UPDATE SET last_request_at = EXCLUDED.last_request_at.
--    This table lives in the control-plane registry database (same Postgres instance,
--    same database) so the idle scaler can JOIN against the tenants table without a
--    cross-database query.
--
-- 2. Widen state CHECK constraints to allow 'sleeping'
--    Four anonymous CHECK constraints in 0001_baseline.sql cover the same state set:
--      tenants.desired_state, tenants.current_state,
--      state_transitions.from_state, state_transitions.to_state
--    All four are widened here. The idle scaler writes current_state='sleeping';
--    the activator writes current_state='ready' after a successful wake.
--    desired_state also allows 'sleeping' for symmetry (an operator could request
--    explicit scale-to-zero via the admin API in the future).
--    The state_transitions table must allow 'sleeping' in from_state and to_state
--    to record the ready->sleeping and sleeping->ready transitions.
--
--    PostgreSQL auto-names inline anonymous CHECK constraints as
--    {table}_{column}_check. The DROP / ADD sequence below is destructive
--    (drops old constraint, adds wider one) and is explicitly opted-in with
--    @migration:destructive per the additive-only guard policy.
--
--    Constraint names on each RDBMS:
--      Real Postgres: tenants_desired_state_check, tenants_current_state_check,
--                     state_transitions_from_state_check, state_transitions_to_state_check
--      pg-mem: tenants_constraint_1, tenants_constraint_2,
--              state_transitions_constraint_1, state_transitions_constraint_2
--    The test helper in tenant-registry-test-helpers.ts translates real Postgres
--    constraint names to pg-mem sequential names before each statement executes.

CREATE TABLE IF NOT EXISTS tenant_activity (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_request_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_activity_last_request_at
  ON tenant_activity(last_request_at);

-- Widen tenants.desired_state
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_desired_state_check; -- @migration:destructive
ALTER TABLE tenants
  ADD CONSTRAINT tenants_desired_state_check
    CHECK (desired_state IN (
      'provisioning', 'ready', 'sleeping', 'maintenance', 'upgrading',
      'restoring', 'failed', 'deprovisioned'
    ));

-- Widen tenants.current_state
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_current_state_check; -- @migration:destructive
ALTER TABLE tenants
  ADD CONSTRAINT tenants_current_state_check
    CHECK (current_state IN (
      'provisioning', 'ready', 'sleeping', 'maintenance', 'upgrading',
      'restoring', 'failed', 'deprovisioned'
    ));

-- Widen state_transitions.from_state
ALTER TABLE state_transitions
  DROP CONSTRAINT IF EXISTS state_transitions_from_state_check; -- @migration:destructive
ALTER TABLE state_transitions
  ADD CONSTRAINT state_transitions_from_state_check
    CHECK (from_state IN (
      'provisioning', 'ready', 'sleeping', 'maintenance', 'upgrading',
      'restoring', 'failed', 'deprovisioned'
    ));

-- Widen state_transitions.to_state
ALTER TABLE state_transitions
  DROP CONSTRAINT IF EXISTS state_transitions_to_state_check; -- @migration:destructive
ALTER TABLE state_transitions
  ADD CONSTRAINT state_transitions_to_state_check
    CHECK (to_state IN (
      'provisioning', 'ready', 'sleeping', 'maintenance', 'upgrading',
      'restoring', 'failed', 'deprovisioned'
    ));

-- Update the schema_metadata sentinel so the registry validates correctly
-- after the new state is added to types.ts.
UPDATE schema_metadata
SET value = 'provisioning,ready,sleeping,maintenance,upgrading,restoring,failed,deprovisioned'
WHERE key = 'tenant_state_signature';
