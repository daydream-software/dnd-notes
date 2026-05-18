-- Phase 2 exit: drop local-auth schema (#318).
--
-- After the Keycloak-only cutover, owner_accounts no longer carry a
-- password hash and owner_sessions has no callers. Both are dropped
-- here. Idempotent.
--
-- Safety: every owner_accounts row must already be Keycloak-linked
-- (keycloak_sub IS NOT NULL) before we drop password_hash. The
-- expression below divides by zero (and aborts the migration) if any
-- unlinked owner remains. The control-plane auto-link path provisions
-- keycloak_sub on the next sign-in, so the operator's remediation is
-- to ask each unlinked owner to sign in via Keycloak once.
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE 1 / 0
  END
FROM owner_accounts
WHERE keycloak_sub IS NULL;

DROP TABLE IF EXISTS owner_sessions; -- @migration:destructive

ALTER TABLE owner_accounts
DROP COLUMN IF EXISTS password_hash; -- @migration:destructive
