-- Phase 2 exit: drop local-auth schema (#318).
--
-- After the Keycloak-only cutover, owner_accounts no longer carry a
-- password hash and owner_sessions has no callers. Both are dropped
-- here. Idempotent.

DROP TABLE IF EXISTS owner_sessions; -- @migration:destructive

ALTER TABLE owner_accounts
DROP COLUMN IF EXISTS password_hash; -- @migration:destructive
