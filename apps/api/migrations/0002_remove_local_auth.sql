-- Phase 2 exit: drop local-auth schema (#318).
--
-- After the Keycloak-only cutover, owner_accounts no longer carry a
-- password hash and owner_sessions has no callers. Both are dropped
-- here. Idempotent.
--
-- Safety: every owner_accounts row must already be Keycloak-linked
-- (keycloak_sub IS NOT NULL) before we drop password_hash. The
-- expression below divides 1 by a runtime-computed value that is 1
-- when no unlinked owners exist and 0 otherwise, so the migration
-- aborts with "division by zero" if any unlinked owner remains. The
-- runtime divisor prevents Postgres from constant-folding 1/0 at
-- plan time (which would always abort). Operator remediation: ask
-- each unlinked owner to sign in via Keycloak once — the auto-link
-- path provisions keycloak_sub on next sign-in.
SELECT 1 / (CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END)
FROM owner_accounts
WHERE keycloak_sub IS NULL;

DROP TABLE IF EXISTS owner_sessions; -- @migration:destructive

ALTER TABLE owner_accounts
DROP COLUMN IF EXISTS password_hash; -- @migration:destructive
