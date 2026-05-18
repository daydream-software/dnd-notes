# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context (Summarized 2026-04-26T15:45:50Z)

Data is the Backend Dev responsible for control-plane, tenant orchestration, database migrations, authentication seams, and multi-tenant infrastructure. Primary domains: schema design, provisioning contracts, per-tenant credential management, Postgres adapter patterns, migration framework orchestration.

**Foundation Work (2026-04-11 to 2026-04-15):**
- Established SQLite note schema (campaign/membership/session/note tables)
- Issue #23: Membership consolidation backend (preview/apply on note attribution)
- Issue #27: Session-browsing backend with auth fixes for collaborators
- Issue #30: Note-to-note links backend (20-link limit, JSON storage, backlinks endpoint)
- Issue #33: Recent-activity read contract (campaign-scoped, latest-state only, no audit)

**Database & Platform (2026-04-15 to 2026-04-22):**
- Issue #58: Note-store async adapter supporting SQLite (dev default) and Postgres (via DATABASE_URL)
- Issue #42: Control-plane REST layer for tenant create/state transitions with rollout guardrails
- Issue #68: Tenant contract with optional initialAdminEmail metadata
- Issue #69: Per-tenant Postgres credentials (dedicated roles, tenant-scoped DATABASE_URL, safe deprovision)
- Issue #56: Auth-provider abstraction boundaries (owner_accounts.keycloak_sub, AuthenticatedUser contract)

**Recent PR Work (2026-04-22 to 2026-04-26):**
- PR #107: Tenant advisory-lock session management (checked-out client reuse, bounded retries)
- PR #108: Centralized control-plane error logging (Bash-3.2 compat, ad-hoc handler consolidation)
- Issue #97: Control-plane Postgres migration (async registry, PVC removal, multi-agent coordination)
- Epic #87: Backend validation (control endpoints, backup/restore catalog, note-store split, migration framework)

**Cross-Team Patterns:**
- Share-link metadata-only listing with owner-only reveal API
- Membership guest-token rotation on consolidation
- Session/note queries behind resolveAccessibleCampaign() for collaborator access
- Tenant Deployment single-replica RollingUpdate with drain-first (maxSurge:0, maxUnavailable:1)

## Recent Updates

Team update (2026-05-11T22:00:00Z): #201 closed via PR #218 — `role_sync_status` column added to `portal_accounts`, `role-sync-retry.ts` background loop with 60s/300s backoff. Atomicity fix (b93c516) moves pending marker into `linkPortalAccountKeycloakSub` SET clause. 404 from KC treated as resolved. HA caveat documented. — decided by Data, merged.

### 2026-04-26: PR #120 Review Blocker — status.sh Output Contract
**Context:** Chunk's review of Brand's f461fe8 commit found an inconsistency: `status.sh` used the env-override cluster for live checks but reported the persisted `clusterName` in JSON output.

**Fix Applied:**
- Changed `status.sh` line 258: now always reports `${CLUSTER_NAME}` (the effective cluster name) instead of `${state_clusterName:-${CLUSTER_NAME}}`
- Added regression test: verifies `--json` output reports effective cluster when `K3D_CLUSTER_NAME` is set
- Preserved Brand's other fixes from commit f461fe8

**Why:** The JSON output contract must align with script behavior. When K3D_CLUSTER_NAME is explicitly set, both live checks AND reported output must use that override, not fall back to persisted state.

**Validation:** ✓ bash -n, ✓ lint, ✓ 202 tests pass, ✓ build

📌 Team update (2026-04-26T22:06:15Z): PR #120 revision 3 approved by Chunk. New bug (namespace mutation) was discovered and resolved by Mikey in revision 3 (false-green regression proof fix). Lockout pattern applied successfully: first author locked after rejection (discovery of new bug), second author locked after review discovery (namespace gap), Mikey as gate closer with surgical fix (isolated scope, clear spec, failing test). — Chunk

## Learnings

### K3D State vs Effective Config Pattern
Scripts with env-override support must distinguish:
- **Persisted state** (from `.k3d-state/state.json`) — what was last provisioned
- **Effective config** (env override > state > default) — what the script actually targets

When reporting status, always report the effective config, not the persisted state, to avoid operator confusion during env-override scenarios.

**Files:** `scripts/k3d/status.sh`, `scripts/k3d/down.sh`

Team update (2026-05-16T00:00:00Z): Use `!= null` (loose null check) when guarding reads on results from `response.json()` casts in api.ts — catches both undefined (missing field) and null (explicit null). Any read from a `.json()` cast without a runtime guard is unsafe regardless of TypeScript type annotation. Zod validation at the api.ts boundary is a valid follow-up for future hardening. — decided by Chunk + Mikey (#308 fix)

Team update (2026-05-17T22:00:00Z): Dispatched to worktree for apps/control-plane cutover in PR #320 (Keycloak-only auth phase 2 exit). Commits 6801aea + c170b78 cherry-picked: dropped `/portal/{signup,login,logout}`, removed auth-mode switches, added migration `0005_remove_local_auth.sql` with pg-mem DROP COLUMN quirk helper `wrapPoolForPgMem()`, aligned docs/env/configmaps. Merged as part of PR #320 phase-2-exit session. — decided by Coordinator






