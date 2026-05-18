-- Mark initial_admin_email as a Phase 2 local-auth relic (#325).
-- The column is retained for backward compatibility (existing rows may have it
-- set, and the provisioning fallback in provisioning.ts still reads it for
-- legacy tenants). It is safe to drop once:
--   1. No rows have initial_admin_email IS NOT NULL, and
--   2. No callers (operator-portal ProvisionTenantPanel) still send it.
COMMENT ON COLUMN tenants.initial_admin_email IS 'DEPRECATED: Phase 2 local-auth relic — fallback for ownerId email when Keycloak lookup failed in local-auth mode. Safe to drop once no rows have it set and no callers send it.';
