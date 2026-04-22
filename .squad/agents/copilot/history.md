# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context (Summarized 2026-04-22T18:24:34Z)

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

## 2026-04-22: Issue #68 rolling update UX follow-up

- Closed the final PR #78 review thread by extracting shared `normalizeBasePath()` logic into `apps/operator-portal/src/base-path.ts`, reusing it from both `apps/operator-portal/vite.config.ts` and `apps/operator-portal/src/config.ts`, and adding `apps/operator-portal/src/base-path.test.ts` to lock the normalization behavior.
- Revalidated the touched workspace with `npm run lint:operator-portal && npm run test:operator-portal && npm run build:operator-portal`.

- Added the next thin operator-portal lifecycle slice in `apps/operator-portal`: ready tenants can now start a rolling update through the existing `POST /internal/tenants/:tenantId/provision` route by supplying a target version plus operator reason.
- Kept the UX explicit but low-friction with a dedicated dialog (`TenantUpgradeDialog.tsx`) that explains the drain-first replacement semantics and requires the target version to be re-entered before the call is sent.
- Extended `apps/operator-portal/src/OperatorPortal.actions.test.tsx` with a focused regression for the upgrade path and re-ran `npm run lint --workspace apps/operator-portal && npm run build --workspace apps/operator-portal && npm run test --workspace apps/operator-portal --` successfully.

- 2026-04-22T17:32:29Z Started issue #68 control-plane rollout failure hardening: investigating provision route, portal rolling-update consumer, and backend failure contracts before a thin mergeable fix slice.
- 2026-04-22T17:40:00Z Coordinator resumed issue #68 after compaction: rolling-update QA log is persisted, Data's rollout-failure hardening landed locally with explicit 400/409/500 control-plane contracts, and the next enforced handoff is Chunk QA on operator-facing failure copy plus regression coverage before batching commits/push prep.

- 2026-04-22T17:38:00Z Completed issue #68 rollout failure hardening: versioned control-plane provision requests now return explicit 400/409/500 rollout contracts for unsupported targets, concurrent/disallowed rollout attempts, and mid-flight rollout failures; focused control-plane tests plus operator-portal validation passed. Shared worktree was already dirty with unrelated #68 changes, so Data left the code uncommitted; Scribe logged the slice in `.squad/log/2026-04-22T17:38:00Z-issue68-rollout-failure-hardening.md` and `.squad/orchestration-log/2026-04-22T17:38:00Z-data.md`.
- 2026-04-22T18:00:00Z Chunk QA picked up issue #68 rollout-failure hardening review: inspecting Data's uncommitted control-plane failure-contract slice, operator-portal operator-facing copy/tests, and validating both touched workspaces before approving for batching.
- 2026-04-22T18:02:00Z Completed Chunk QA review for issue #68 rollout-failure hardening: approved Data's control-plane slice after adding route-level regressions for stale/no-op and non-ready rollout mappings plus operator-portal inline rollout-error coverage/copy so stale 400/409/500 rollout contracts stay visible to operators. Re-ran lint/test/build for both `apps/control-plane` and `apps/operator-portal` successfully; worktree remains intentionally dirty/uncommitted because unrelated #68 changes are present.
- 2026-04-22T19:08:00Z Picked up the newest PR #78 Copilot review follow-up on `squad/68-operator-control-portal`: one portal UX gap let a stale open provision dialog proceed after mutations became disabled, and one parameterized portal regression still produced unreadable `[object Object]` case names in CI output.
- 2026-04-22T19:12:00Z Landed the PR #78 review-fix batch for issue #68: `ProvisionTenantPanel` now re-checks `disabledReason` inside confirm and disables the confirm CTA, operator-portal actions tests cover the stale-review lockout, and rollout guidance cases now use readable scenario labels. Re-ran `npm run lint --workspace apps/operator-portal && npm run test --workspace apps/operator-portal && npm run build --workspace apps/operator-portal` successfully before push/reply/resolve work.
- 2026-04-22T19:20:00Z Picked up the next PR #78 review round immediately after the previous threads were resolved: Mikey triaged two fresh comments down to an operator-portal test-mock fix plus a duplicate `Core Context` cleanup in `.squad/agents/stef/history.md`, while Scribe logged the new cycle.
- 2026-04-22T19:28:00Z Completed the latest PR #78 follow-up batch for issue #68: `apps/operator-portal/src/OperatorPortal.actions.test.tsx` now returns explicit 500 responses for unexpected POST calls in the stale-dialog regression instead of crashing on `undefined`, the duplicate `## Core Context` header was removed from `stef/history.md`, and Chunk approved the batch after focused operator-portal lint/test/build stayed green.
- 2026-04-22T19:31:00Z Picked up another PR #78 round after two fresh comments and two red checks appeared: Mikey triaged both new comments to operator-portal session/auth lifecycle fixes, Brand diagnosed the red checks down to a new control-plane test with an overly tight 50ms polling timeout, and Scribe logged the combined review/CI cycle.
- 2026-04-22T19:39:00Z Completed the current PR #78 follow-up batch for issue #68: stored operator-portal Keycloak tokens are now shape-validated before reuse and invalid blobs are cleared, `clearSession()` resets stale error/loading state so logout returns to a clean sign-in screen, a focused `keycloak-client` test was added alongside updated app-level regressions, and the new control-plane namespace-termination test timeout was relaxed from 50ms to 200ms to keep CI stable without touching production logic. Chunk approved the batch after rerunning the touched operator-portal and control-plane lint/test/build paths.
- 2026-04-22T19:45:00Z Picked up the final known PR #78 review comment immediately after the previous batch was pushed: Mikey triaged it to a duplicated `normalizeBasePath()` helper shared between `apps/operator-portal/vite.config.ts` and `apps/operator-portal/src/config.ts`, Scribe logged the round, and Brand owned the low-risk config refactor while Chunk prepared the reviewer gate.
- 2026-04-22T19:48:00Z Completed the final PR #78 follow-up batch for issue #68: `normalizeBasePath()` now lives in a shared `apps/operator-portal/src/base-path.ts` helper consumed by both Vite and runtime config, `apps/operator-portal/src/base-path.test.ts` locks the blank/root/trailing-slash behavior, and Chunk approved the refactor after operator-portal plus full-repo validation stayed green.
- 2026-04-22T20:45:44Z Picked up issue #70 on isolated worktree `squad/70-build-public-landing-signup-portal` as Brand. Locked the implementation shape to a separate `apps/customer-portal` workspace plus a customer-facing `/portal` control-plane surface, with local email signup/session auth for the first slice and an explicit seam for future Keycloak migration instead of reusing the operator portal.
- 2026-04-22T22:05:00Z Completed issue #70 on `squad/70-build-public-landing-signup-portal`: added the new `apps/customer-portal` workspace, shipped the control-plane `/portal` catalog/signup/login/dashboard/self-serve-tenant API with local email+password auth and compensating cleanup on failure paths, updated the portal README/docs, and re-ran `npm run lint --workspace apps/control-plane && npm run test --workspace apps/control-plane -- && npm run build --workspace apps/control-plane && npm run lint --workspace apps/customer-portal && npm run test --workspace apps/customer-portal -- && npm run build --workspace apps/customer-portal` successfully. Final code review found no material issues, but this remains a **needs-review** slice because it spans API + UI.
- 2026-04-22T22:40:00Z Completed the PR #80 Copilot review-fix batch for issue #70: portal sessions now use SQLite-safe expiry timestamps plus `datetime(expires_at)` comparisons, portal signup/login moved password hashing to async `crypto.scrypt()` with login-side dummy verification to avoid timing leaks, public portal auth endpoints gained per-IP rate limiting and bounded JSON parsing, the customer portal stores the bearer token in `sessionStorage`, and root `scripts/run-ci-tests.mjs` now includes the new customer-portal suite. Re-ran `npm run lint --workspace apps/control-plane && npm run test --workspace apps/control-plane -- && npm run build --workspace apps/control-plane && npm run lint --workspace apps/customer-portal && npm run test --workspace apps/customer-portal -- && npm run build --workspace apps/customer-portal && npm run test:ci` successfully, then validated the final timing fix again with control-plane lint/test/build.
- 2026-04-22T22:55:00Z Completed the second PR #80 Copilot review-fix batch for issue #70: `POST /portal/logout` now uses the bounded portal JSON parser so client/test request bodies are consumed safely, portal rate-limit bucket cleanup is amortized behind a periodic sweep instead of scanning on every request, and `TenantRegistry` now creates an expression index on `datetime(expires_at)` to match the session expiry queries. Re-ran `npm run lint --workspace apps/control-plane && npm run test --workspace apps/control-plane -- && npm run build --workspace apps/control-plane` successfully, and the follow-up review confirmed the new expiry query plan uses the expression index.
- 2026-04-22T23:05:00Z Completed the third PR #80 Copilot review-fix batch for issue #70: portal signup/create-tenant rollback now always removes the tenant registry row even when infrastructure deprovisioning fails, failed signup always deletes the portal account so no orphaned owner survives cleanup, and control-plane rate limiting now supports an explicit `CONTROL_PLANE_TRUST_PROXY` setting for ingress-backed deployments. Updated `apps/control-plane/.env.example` and `apps/control-plane/README.md`, added rollback + trust-proxy regressions, and re-ran `npm run lint --workspace apps/control-plane && npm run test --workspace apps/control-plane -- && npm run build --workspace apps/control-plane` successfully through the final 101-test pass.
- 2026-04-22T23:20:00Z Completed the fourth PR #80 Copilot review-fix batch for issue #70: the customer portal now remembers when signup/login already hydrated the dashboard so it does not immediately re-fetch `/portal/me` and accidentally clear a fresh session on transient restore failures, while control-plane self-serve tenant creation now preserves an existing portal-account `billingEmail` when callers omit that optional field. Added focused regressions for both signup/login hydration paths in `apps/customer-portal/src/App.test.tsx` plus the preserved billing-email path in `apps/control-plane/test/app.test.ts`, and re-ran `npm run lint --workspace apps/control-plane && npm run test --workspace apps/control-plane -- && npm run build --workspace apps/control-plane && npm run lint --workspace apps/customer-portal && npm run test --workspace apps/customer-portal -- && npm run build --workspace apps/customer-portal` successfully after a clean diff review.
