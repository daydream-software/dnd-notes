-- Add role_sync_status to portal_accounts (#201).
--
-- Tracks whether a portal account's per-tenant Keycloak role assignments are
-- fully confirmed. Used by the background retry sweep to find accounts that
-- need another attempt after a transient Keycloak failure at the auto-link
-- moment (createPortalKeycloakSessionMiddleware, #196 transition path).
--
-- Design decision — Option A (per-account flag):
--   A per-account TEXT flag is sufficient for the goal stated in #201: ensure
--   transient sweep failures trigger a retry rather than silently degrading
--   into permanent missing-role state. Granularity per tenant-link (Option B)
--   would allow surfacing which specific tenant is failing, but the issue
--   explicitly defers an operator UI for sync state. Without a UI, the extra
--   join table only adds moving parts without observable benefit. This can be
--   promoted to Option B if per-tenant visibility is ever required.
--
-- Default 'complete': existing accounts created before this migration have
-- either never gone through the auto-link sweep (keycloak_sub is null — local
-- auth only, no role sync needed) or were linked successfully before this
-- column existed. Setting the default to 'complete' means the retry loop
-- ignores them, which is the safest interpretation: roles were assigned at
-- link time and no transient failure was recorded.

ALTER TABLE portal_accounts
ADD COLUMN IF NOT EXISTS role_sync_status TEXT NOT NULL DEFAULT 'complete'
  CHECK (role_sync_status IN ('pending', 'complete'));
