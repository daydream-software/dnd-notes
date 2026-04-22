# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Copilot enabled as autonomous coding agent for squad via auto-assignment to squad:copilot issues.

## Recent Updates

📌 issue #76 ready for PR handoff (2026-04-22T02:59:10Z): User reran `npm run k3d:smoke` after the final smoke-script JWKS fix and the lane finished green end-to-end (tenant rollout, control-plane Keycloak auth, tenant `/api/auth/session`, tenant `/api/campaigns`). Branch `squad/76-complete-runtime-keycloak-auth-integration` is now review-ready and being pushed for PR creation, with squad review still recommended because the slice is auth-sensitive. — Data (Agent)

📌 k3d smoke launcher wired for tenant JWKS override (2026-04-22T02:47:52Z): The remaining live gap was in `scripts/k3d/smoke.sh` itself: the local control-plane process used for smoke rehearsals was still provisioning tenants without `TENANT_KEYCLOAK_JWKS_URL`. The smoke script now defaults that env to the in-cluster `platform-keycloak` Service and passes it into the local control-plane process, matching the runtime/provisioning changes already landed. — Data (Agent)

📌 k3d tenant JWT validation fixed (2026-04-22T02:28:08Z): The live smoke tenant token was valid, but tenant pods were still trying to fetch JWKS through `http://keycloak.127.0.0.1.nip.io:8080`, which resolves to pod-local loopback in k3d. The runtime now supports a separate `KEYCLOAK_JWKS_URL` override, control-plane provisioning injects `TENANT_KEYCLOAK_JWKS_URL`, and the k3d overlay points tenant pods at the in-cluster `platform-keycloak` Service while keeping the public Keycloak URL for browser auth/config. Also ignored `.k3d-smoke-work/` so preserved smoke artifacts stop showing up as untracked files. — Data (Agent)

📌 k3d smoke 401 traced to Keycloak `azp` handling (2026-04-22T02:15:07Z): The control-plane smoke token was valid but carried the common Keycloak direct-grant shape (`azp=dnd-notes-control-plane`, audience not equal to the client). The API and control-plane JWT validators now treat `azp` as the authoritative client binding when present, while fallbacking to `aud` when it is absent. Fake Keycloak defaults/tests were updated to exercise the `aud=account` path so the smoke-only regression is covered in automated tests. — Data (Agent)

📌 k3d smoke failure handling tightened (2026-04-22T02:05:26Z): `scripts/k3d/smoke.sh` now enables `inherit_errexit`, records the failing command via an `ERR` trap, preserves `.k3d-smoke-work` on failure, and prints the preserved log path plus the failed command alongside the control-plane log tail. This keeps non-zero smoke failures loud and debuggable instead of cleaning away the evidence. — Data (Agent)

📌 Issue #76 k3d follow-up fixed (2026-04-22T01:56:16Z): Local `k3d:smoke` exposed that the seeded Keycloak realm declared client roles under `clients[].roles`, which Keycloak 26 rejects during import. The fix moved control-plane roles to `roles.client["dnd-notes-control-plane"]` in `platform/k3d/keycloak.yaml` and extended `scripts/platform/validate-manifests.sh` to parse the embedded realm JSON so `npm run platform:validate` now catches this regression before smoke runs. — Data (Agent)

📌 Issue #76 picked up (2026-04-22T00:49:24Z): Routing to the `squad:data` lane for runtime Keycloak auth integration across tenant apps and the control-plane. Scope includes tenant JWT validation, control-plane admin JWT validation, Keycloak env/config wiring for k3d + hosted setups, and docs/tests for the runtime flow. This is auth-sensitive work and should receive squad review before merge. — Data (Agent)

📌 Issue #76 approach locked (2026-04-22T01:20:00Z): Chosen implementation shape is explicit runtime config, not build-time magic: tenant apps will expose `/api/auth/config`, validate Keycloak JWTs against configured issuer/JWKS when `AUTH_MODE=keycloak`, reconcile identities onto local `owner_accounts.keycloak_sub`, and keep guest/share-link authorization local. Control-plane auth will mirror that with its own `CONTROL_PLANE_AUTH_MODE=keycloak` workforce/admin JWT path while retaining the static bearer fallback for non-Keycloak environments. — Data (Agent)

📌 Issue #76 implementation validated (2026-04-22T02:05:00Z): API, control-plane, web, and platform validation all passed after the runtime Keycloak slice landed. k3d smoke was updated to exercise live Keycloak tokens for both control-plane and tenant runtime auth, but this environment still blocks the full live rehearsal because the existing `dnd-notes` k3d cluster never becomes API-reachable. — Data (Agent)


📌 Issue #69 supported (2026-04-21T19:55:31Z): Data implemented per-tenant Postgres credentials with control-plane schema pre-seeding and safe deprovision cleanup. Copilot co-authored commit 695c0f9 on squad/69-per-tenant-postgres-credentials. Validation passed (lint/test/build/platform:validate). — Data (Agent)


📌 Team update (2026-04-18T14:57:36Z): EPIC SYNC DIRECTIVE CODIFIED — User directive: when the team makes decisions on an epic, update the GitHub epic so the visible GitHub source stays synchronized with squad decisions. Standing practice established. Mikey synchronized GitHub issue #42 (body + syncing comment) to reflect locked platform direction (Postgres, ghcr.io, ingress-nginx, cert-manager wildcard DNS-01, K8s Secrets, dropped OKE/ARM). Directive merged to `.squad/decisions.md` and captured in orchestration/session logs. — Scribe
📌 Team update (2026-04-18T14:57:36Z): EPIC SYNC DIRECTIVE CODIFIED — User directive: when the team makes decisions on an epic, update the GitHub epic so the visible GitHub source stays synchronized with squad decisions. Standing practice established. Mikey synchronized GitHub issue #42 (body + syncing comment) to reflect locked platform direction (Postgres, ghcr.io, ingress-nginx, cert-manager wildcard DNS-01, K8s Secrets, dropped OKE/ARM). Directive merged to `.squad/decisions.md` and captured in orchestration/session logs. — Scribe

**[8 older updates archived to decisions.md/orchestration-log]**

## 2026-04-21
- Picked up issue #55 in worktree `.worktrees/55-rolling-update-choreography`; target slice is Postgres-backed tenant rolling-update choreography plus explicit drain semantics, with stale squad branch/worktree cleanup checked first.
- Completed issue #55 thin slice as an implementation-backed docs update: tenant provisioning now encodes explicit RollingUpdate settings, rollout docs were updated in README/RUNTIME/control-plane docs, issue #55 body was rewritten to the Postgres-backed scope, and focused control-plane/API validation passed.
- Followed up on PR #67's suppressed rollout note: `TenantProvisioningService.provisionTenant()` now rejects blank version overrides before state transitions so direct callers cannot mark a tenant `upgrading` without persisting a new image/version; focused control-plane test/lint/build passed.

## 2026-04-21: Issue #69 least-privilege tenant Postgres credentials
- New-tenant provisioning now creates dedicated Postgres runtime roles/passwords, bootstraps schema before pod start, and keeps ordinary reprovisioning on existing runtime secrets unless an explicit migration is performed.
## 2026-04-21: Phase 2 backend/security attack plan

- Data reviewed the Phase 2 backend/platform-security starting slice and recommends landing per-tenant Postgres credentials first (#69) before full OIDC wiring (#56) or restore orchestration (#40).
- Main blocker to a naive least-privilege swap: `apps/api/src/note-store-bootstrap.ts` still runs Postgres schema DDL on startup, so the control plane must pre-seed schema/default grants (or a separate migrator path) before tenant pods receive runtime-only credentials.
- Follow-up plan captured in `.squad/decisions/inbox/data-phase-2-backend-plan.md`; reusable pattern captured in `.squad/skills/postgres-tenant-least-privilege/SKILL.md`.

## 2026-04-21: Issue #39 SQLite WAL decision

- Picked up issue #39 on branch `squad/39-investigate-sqlite-wal-mode`.
- Current finding: writable SQLite stores only enable `foreign_keys = ON`; they do not intentionally enable WAL, and the restore runbook still assumes a single `.sqlite` snapshot plus operator-managed pause in user edits.
- Planned thin slice: keep SQLite on rollback-journal mode by default unless a concrete restore/concurrency need proves otherwise, add regression coverage, and document that hosted production targets Postgres while SQLite remains the local/snapshot format.
- Completed the thin slice: `createSqliteDatabase()` now normalizes writable file-backed SQLite databases to `journal_mode=DELETE`, API regression coverage proves the persisted journal mode stays `delete`, README/runbook guidance documents the choice, and the team decision was recorded in `.squad/decisions/inbox/data-sqlite-wal-default.md`.
- Focused validation passed for `apps/api` (`npm run lint --workspace apps/api && npm run test --workspace apps/api && npm run build --workspace apps/api`).

## 2026-04-21: Issue #57 fleet status surface

- Picked up issue `#57` on branch `squad/57-fleet-status-surface` after handing the auth-heavy `#56` slice back to the assigned data lane.
- Landed the first fleet-status slice as a read-only control-plane endpoint, `GET /internal/fleet/status`, instead of a standalone UI. The response now includes control-plane health, dependency status, summary counts by tenant state/version, and per-tenant details with latest transition plus lifted backup metadata fields when parseable JSON is already present.
- Updated `apps/control-plane/README.md` to document the internal surface and the future path to a redacted public status page, while keeping issue `#68` as the richer operator portal.
- Focused validation passed for `apps/control-plane` (`npm run lint --workspace apps/control-plane && npm test --workspace apps/control-plane && npm run build --workspace apps/control-plane`).

## 2026-04-22: PR #75 review + smoke follow-up

- Addressed the remaining live PR review items on `squad/57-fleet-status-surface`: `GET /internal/fleet/status` now trims whitespace-only backup metadata consistently, the tenant API session-token owner lookup selects `owner_accounts.keycloak_sub` again, and the control-plane tenant Postgres bootstrap now provisions `keycloak_sub` in `owner_accounts` so tenant pods do not boot against a stale schema contract.
- Added regression coverage in `apps/control-plane/test/tenant-database-bootstrap.test.ts`, tightened the blank-backup assertion in `apps/control-plane/test/app.test.ts`, and asserted `keycloakSub: null` in the API auth login workflow test so the owner response shape cannot silently regress.
- Workspace validation passed again for `apps/api` and `apps/control-plane`. Local `npm run k3d:smoke` is blocked in this environment before cluster creation because the Docker broker rejects the required `rancher/k3s:v1.35.3-k3s1` image, so smoke could not be replayed here end-to-end.
- GitHub CI validated the application fix anyway: after the bootstrap/schema alignment landed, PR #75's hosted `smoke` job passed.
- A final review follow-up flagged the SQLite migration shape for `owner_accounts.keycloak_sub`. The fix now keeps SQLite upgrades safe by adding the column first and then creating a separate unique partial index, with a real migration regression test covering legacy SQLite owner tables.
- Another late review round caught the equivalent upgrade gap for existing Postgres schemas and previously provisioned tenant databases. The fix now removes inline `keycloak_sub UNIQUE` from the bootstrap table definitions, adds explicit `keycloak_sub` ensure/migration steps for existing Postgres `owner_accounts` tables, and treats either a unique constraint or the named `idx_owner_accounts_keycloak_sub` index as valid least-privilege enforcement. Focused API + control-plane validation passed again afterward.
- The final review round tightened the least-privilege guarantee further: composite unique constraints or indexes that merely include `keycloak_sub` are now rejected, so only uniqueness on `keycloak_sub` alone passes bootstrap validation. I also synced the stale `.squad/decisions.md` wording to the implemented partial-index shape and removed an empty dangling header from `.squad/agents/data/history.md`.
- One more follow-up review pointed out that the `FakePostgresDatabase` stub was still too idealized for `information_schema.table_constraints`. The stub now mirrors the current production SQL more closely, so composite-key cases only pass when the query itself truly asks for standalone `keycloak_sub` uniqueness. Focused `apps/api` test/build passed again.
- Another review round then exposed the real gap: the production `ensureRequiredPostgresOwnerAccountKeycloakSub()` hardening had remained uncommitted locally. The branch now carries the standalone-column `GROUP BY/HAVING` constraint check and the stricter single-column `idx_owner_accounts_keycloak_sub` regex, matching the regression coverage that was already passing locally.

## 2026-04-22: Issue #76 auth collision follow-up

- Fixed the remaining tenant runtime Keycloak reconciliation edge in `apps/api/src/note-store.ts`: when an existing `keycloak_sub` logs in with a new IdP email that already belongs to another local owner row, the API now keeps the linked row’s persisted email/admin state instead of crashing on the unique-email constraint.
- Added a runtime-auth regression in `apps/api/test/keycloak-runtime-auth.test.ts` that proves the linked owner still reaches campaigns while `/api/admin/accounts` stays forbidden during the collision, so tenant-local authorization boundaries remain anchored to the local row.
- Cleaned the duplicate `AUTH_MODE` entry in `apps/api/.env.example` and re-ran `npm run lint --workspace apps/api && npm run test --workspace apps/api && npm run build --workspace apps/api`.

## 2026-04-22: PR #77 backend review follow-up

- Replaced the brittle `/api/auth/session` 409 mapping in `apps/api/src/route-support.ts` with a typed `OwnerKeycloakLinkConflictError` exported from `apps/api/src/note-store.ts`, so route behavior no longer depends on parsing `Error.message`.
- Added runtime-auth regressions in `apps/api/test/keycloak-runtime-auth.test.ts` for both the real conflicting-subject 409 path and a synthetic typed-conflict case with an arbitrary message, proving the HTTP mapping stays stable across refactors.

## 2026-04-22: PR #77 frontend review follow-up

- `apps/web/src/App.tsx` no longer silently optional-chains the Keycloak login CTA. In Keycloak mode, a missing `keycloakClientRef.current` now throws a user-facing inline auth error telling the user to reload and try again.
- `apps/web/src/App.keycloak-auth.test.tsx` now covers the missing-client path by rejecting Keycloak init during bootstrap, then asserting the sign-in CTA surfaces the inline error instead of no-oping.

## Session Update (2026-04-22)
- Started Issue #68 QA-lane prep as Chunk/Tester.
- Focus: inspect control-plane + web test surfaces, lock stable operator-slice contracts with tests where possible, and publish first-slice QA gate + risks.
- Issue #68 QA prep landed control-plane acceptance tests for admin-realm auth on the fleet-status read surface and audit-trail preservation on provision/deprovision flows; first-slice recommendation is an auth-gated read-heavy portal before live write controls.

## 2026-04-22: Issue #68 operator portal UX slice

- Extended `apps/operator-portal` beyond the read-only dashboard: the portal now provisions tenants via the existing create + provision control-plane routes, requires an operator reason, and reloads fleet state from `/internal/fleet/status` instead of synthesizing local lifecycle updates.
- Added a destructive deprovision dialog with typed-slug confirmation and reason capture so the portal makes side effects explicit before sending `POST /internal/tenants/:tenantId/deprovision`.
- Focused operator lifecycle regressions now live in `apps/operator-portal/src/OperatorPortal.actions.test.tsx`; workspace validation passed with `npm run lint --workspace apps/operator-portal && npm run test --workspace apps/operator-portal && npm run build --workspace apps/operator-portal`.


## 2026-04-22: Issue #68 control-plane contract slice

- Extended the control-plane tenant contract so `POST /internal/tenants` can persist an optional `initialAdminEmail`, and surfaced it back through tenant reads plus `GET /internal/fleet/status`.
- Updated the operator portal to send that field on the existing create → provision flow, display it in the fleet read model, and warn that the email is only recorded metadata until a later bootstrap slice lands.
- Added focused control-plane and operator-portal regressions, updated the relevant READMEs, and re-ran lint/test/build for both workspaces successfully.
