-- Phase 2 exit: drop local-auth schema (#318).
-- portal_sessions held opaque session tokens for password-based portal logins,
-- which are replaced by Keycloak bearer tokens (no server-side session store needed).
-- password_hash and auth_provider are inert after all accounts are Keycloak-linked.
DROP TABLE IF EXISTS portal_sessions; -- @migration:destructive
ALTER TABLE portal_accounts
  DROP COLUMN IF EXISTS password_hash; -- @migration:destructive
ALTER TABLE portal_accounts
  DROP COLUMN IF EXISTS auth_provider; -- @migration:destructive
