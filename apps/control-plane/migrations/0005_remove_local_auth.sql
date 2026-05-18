-- Phase 2 exit: drop local-auth schema (#318).
-- portal_sessions held opaque session tokens for password-based portal logins,
-- which are replaced by Keycloak bearer tokens (no server-side session store needed).
-- password_hash and auth_provider are inert after all accounts are Keycloak-linked.
--
-- Safety: every portal_accounts row must already be Keycloak-linked
-- (keycloak_sub IS NOT NULL) before we drop password_hash + auth_provider.
-- The expression below divides by zero (and aborts the migration) if any
-- unlinked account remains. The /portal/me auto-link middleware populates
-- keycloak_sub on next sign-in, so the operator's remediation is to ask
-- each unlinked customer to sign in via Keycloak once.
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE 1 / 0
  END
FROM portal_accounts
WHERE keycloak_sub IS NULL;

DROP TABLE IF EXISTS portal_sessions; -- @migration:destructive
ALTER TABLE portal_accounts
  DROP COLUMN IF EXISTS password_hash; -- @migration:destructive
ALTER TABLE portal_accounts
  DROP COLUMN IF EXISTS auth_provider; -- @migration:destructive
