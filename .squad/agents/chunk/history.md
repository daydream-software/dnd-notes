# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context (Summarized 2026-04-22T18:24:34Z)

Chunk is the QA/Tester for the squad, responsible for regression coverage, gate validation, and identifying high-risk parity gaps.

**Early milestones (2026-04-11 to 2026-04-20, archived from history):** Initialized on 2026-04-11; validated SQLite regression, approved share-link/session-browsing slices, caught guest-token backdoor and state-machine isolation gaps, identified route shadowing + decoding traps, led Phase 0 QA (5 critical checkers), resolved npm test infrastructure.

**Key Pattern:** Find parity gaps early (SQLite ↔ Postgres), gate on measurable regression coverage, propagate learnings to future issues.

## Recent Updates (Last 5)

📌 Team update (2026-04-22T17:38:00Z): Issue #68 rollout-failure hardening landed locally by Data. Ready-tenant rolling updates now return stable control-plane responses: `400 unsupported_target_version` for same-version/no-op targets, `409 tenant_rollout_in_progress` / `tenant_rollout_disallowed` for concurrent or non-ready requests, and `500 tenant_rollout_failed` with operator guidance instead of raw backend text. Focused control-plane tests and operator-portal validation passed. Shared worktree stayed dirty, so no code commit was cut. Next: Chunk QA should validate operator-facing failure copy + regression coverage before batching. — Scribe

📌 Team update (2026-04-22T17:27:18Z): Issue #68 rolling-update lifecycle action completed by Stef. Reuses POST /internal/tenants/:tenantId/provision with version override, exposed only for ready tenants, requires operator reason + typed target-version confirmation. Focused regression in OperatorPortal.actions.test.tsx. Portal lint/build/test passing. Next: Chunk owns QA/reviewer pass on rolling-update action. — Scribe

📌 Issue #68 rolling-update lifecycle action QA review (2026-04-22T17:31:44Z): Chunk approved rolling-update slice. Verified ready-only guardrail, audit visibility, operator-facing confirmation flow. Added focused regression lock in OperatorPortal.actions.test.tsx. Portal validation passing (lint/test/build). Ready for merge. Orchestration log at `.squad/orchestration-log/2026-04-22T17:31:44Z-chunk.md`. Session log at `.squad/log/2026-04-22T17:31:44Z-issue68-lifecycle-review.md`. — Chunk (QA/Tester)



## Learnings

### Phase 2 QA Gate (2026-04-22)
- **Critical discovery:** #40 (Restore Safety) is a blocker for both #56 (OIDC) and #69 (Per-Tenant Roles). Execution order is not optional.
- **Why:** #69 credential rotation and #56 token refresh both require maintenance-mode signaling. Without #40's restore-safety gates, both create orphan-auth failures (silent 401 instead of "maintenance", orphaned Postgres connections, token realm confusion, credential sync races during graceful shutdown).
- **Test infrastructure decoupled from implementation:** 13 regression test files can scaffold immediately (zero product code changes), serving as acceptance gates for each issue.
- **Recommended roadmap:** Phase 2a (scaffold tests) → Phase 2b (implement #40) → Phase 2c (#69 and #56 parallel after #40 merges).
- **Created `.squad/qa-brief-phase-2.md`** with full gate specifications: 5 restore gates, 7 per-tenant role gates, 7 OIDC gates. Also flagged 4 highest-risk user-facing failures if #69 starts first.
- **Created `.squad/decisions/inbox/chunk-phase-2-qa-gate.md`** recording execution-order decision and approval checklist.

### Issue #55 QA Gate (2026-04-22)
- Graceful shutdown choreography is complete: API + control-plane both have SIGTERM handlers that mark readiness as unready immediately, then drain in-flight requests for 30s, then close HTTP server, then close database pool.
- Postgres connection pool has tunable defaults via env vars (`NOTES_DB_POOL_MIN`, `NOTES_DB_POOL_MAX`, idle/connection/statement timeouts) and explicit `pool.end()` is awaited on close.
- Kubernetes manifests have correct probes: liveness `/healthz` (always 200), readiness `/ready` (503 during shutdown or DB fail), 30s termination grace period.
- **Five high-risk gaps exist but are currently manageable:** (1) readiness drain race window during rolling update—requires proof that old/new pods don't overlap on same Postgres; (2) pool drain under load—requires test that 20 concurrent queries complete or timeout gracefully; (3) connection timeout resilience—env vars exist, needs load test; (4) SPA fallback safety—guards exist in code, needs regression test to prove admin endpoints don't leak; (5) schema backward compatibility—not this gate, but document in future phases.
- Created comprehensive QA brief at `.squad/qa-brief-issue-55.md` with 4 high-priority test cases, 4 failure drills (node drain, pod crash, Postgres unavailable, PVC contention), and conditional blocker: #55 ships only when all 6 tests pass + failure drills are documented.
- **Likely blocker for Data:** Statement timeout (30s default) may fail backup/restore operations that take >30s; confirm in code review whether long operations have their own timeout or must be implemented.
- **Architecture smell:** Current design puts readiness failure directly into the shutdown path (immediate 503 response). For future Phases 2+, consider explicit `POST /internal/drain` endpoint for explicit maintenance mode separate from automatic shutdown—this would let operators trigger drain without killing the pod.

- Initial squad setup complete.
- `apps/api/src/note-store.ts` owns SQLite bootstrap for the local DB at `apps/api/data/dnd-notes.sqlite`, so backward-compatible schema changes need in-place startup upgrades instead of relying on `CREATE TABLE IF NOT EXISTS`.
- Regression coverage for legacy SQLite compatibility now lives in `apps/api/test/app.test.ts`, where a pre-attribution `notes` table is created and reopened through `createNoteStore()` to confirm legacy notes still load with null attribution.
- Share-link reveal QA passed across `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/api/test/app.test.ts`, and `apps/web/src/App.test.tsx`; root validation remains `npm run lint && npm run test && npm run build`.
- Regression coverage now explicitly checks that owner share-link list responses stay metadata-only, the owner-only reveal endpoint returns `{ token, url }`, and legacy hash-only links surface the regenerate-by-revoking guidance instead of silently failing.
- User-facing limitation to remember: only share links created after plaintext token storage can be revealed again; older links must be revoked and recreated.
- Issue #20 QA hotspot: note attribution is resolved by joining live `campaign_memberships` rows, so guest-upgrade work must keep the same membership row/id and avoid silently rewriting `display_name` or `role` unless retroactive history-label changes are explicitly intended; review `apps/api/src/note-store.ts` and extend `apps/api/test/app.test.ts` around claim coverage.
- Issue #20 reviewer trap: authenticated campaign access is still owner-only in `apps/api/src/app.ts` and `apps/api/src/note-store.ts`, so linking a guest membership to a real account is incomplete unless the claimed user can actually load the campaign and keep future note edits attributed to that same membership.
- Same-browser claim coverage should exercise guest-token proof and cleanup across `apps/web/src/SharedCampaignRoute.tsx`, `apps/web/src/api.ts`, and `apps/web/src/App.test.tsx`, including clearing or invalidating the stored guest token after a successful link.
- Issue #20 review result: the claim path in `apps/api/src/note-store.ts` currently keeps `campaign_memberships.guest_token_id` after linking `user_id`, and `getGuestMembershipByToken()` still accepts that token, so the old guest token remains a valid anonymous backdoor after claim.
- Current regression coverage in `apps/api/test/app.test.ts` and `apps/web/src/App.test.tsx` proves the membership ID/history stay stable, but it also bakes in the wrong post-claim behavior by continuing to use the pre-claim guest token successfully; root `npm run lint && npm run test && npm run build` still passes with that gap.
- Re-review for issue #20: guest-token rotation is now fixed and covered, but a successfully claimed account still cannot use authenticated campaign routes because `apps/api/src/note-store.ts` only treats `role = 'owner'` memberships as accessible. Repro after claim: `GET /api/campaigns` returns zero campaigns, `GET /api/campaigns/:campaignId` returns 403, and `GET /api/overview` returns `No owned campaigns are available.` despite the membership being linked to the account.
- Final gate for issue #20 passed: `apps/api/src/app.ts` now routes authenticated campaign/overview/note access through linked memberships while keeping owner-only management endpoints owner-gated, `apps/api/src/note-store.ts` rotates the claimed guest token so the stale token no longer authenticates shared workspace requests, and regression coverage in `apps/api/test/app.test.ts` plus `apps/web/src/App.test.tsx` now proves claimed collaborators can reopen the linked campaign, keep workspace selection persisted, and preserve original guest-membership attribution; `npm run lint && npm run test && npm run build` all passed in the review worktree.
- Issue #27 review trap: `apps/api/src/app.ts` declares `/api/notes/:noteId` before `/api/notes/sessions`, so `GET /api/notes/sessions` is shadowed as note ID `"sessions"` and always 404s before the new handler runs.
- Session-name route safety for issue #27: Express already decodes `:sessionId`, so the extra `decodeURIComponent()` in `apps/api/src/app.ts` turns valid names like `50% done` into a 500 `URIError`; review path-param features against literal `%` coverage.
- Session browsing regression gap: the new `/api/notes/sessions/:sessionId` endpoint is owner-scoped through `resolveOwnedCampaign()` even though authenticated note access elsewhere now uses linked-membership scoping, and `apps/api/test/app.test.ts` adds no coverage for the new session endpoints at all.
- Issue #23 backend review: `apps/api/src/app.ts` and `apps/api/src/note-store.ts` gate membership consolidation to owner access and scope both memberships to the campaign before rewriting note attribution IDs, and the SQL update preserves note bodies/timestamps by touching only attribution columns. The current regression coverage in `apps/api/test/app.test.ts` only exercises happy-path consolidation plus role-mismatch confirmation, so owner-only and cross-campaign rejection paths still need explicit tests before this slice is safe to approve.
- Issue #23 re-review passed: `apps/api/test/app.test.ts` now adds the missing regression gates by proving a claimed non-owner still gets `403` on both preview and apply for `/api/campaigns/:campaignId/memberships/consolidations`, while foreign-campaign membership IDs return the campaign-scoped `404` errors. Full repo validation (`npm run lint && npm run test && npm run build`) stayed green, so the attribution-only consolidation slice is now ship-safe.
- Issue #27 approval gate: the backend session-browsing slice is ship-safe only when `apps/api/src/app.ts` keeps `/api/notes/sessions*` ahead of `/api/notes/:noteId`, consumes `request.params.sessionId` without manual decoding, and reuses `resolveAccessibleCampaign()` so claimed collaborators match authenticated note access; `apps/api/test/app.test.ts` now covers both percent-encoded names and claimed-collaborator access, and root `npm run lint && npm run test && npm run build` passed on the approved revision.
- Session-browser state in `apps/web/src/App.tsx` must stay out of the auth bootstrap callback dependency chain; when `loadWorkspace()` depends on `noteBrowseMode`, clicking `All notes`, `Browse by session`, or `New note` re-runs the workspace bootstrap, flashes the full-screen loader, and can overwrite unsaved draft/create-note state.
- Issue #58 QA review (2026-04-18): NoteStore Postgres adapter with SQLite fallback has six high-risk parity gaps — transaction semantics under failure, connection pooling resilience, schema idempotence, ACID isolation level mismatch, query result type coercion, and graceful shutdown. Identified 🟡 conditional blocker: isolation level and pool configuration must be clarified before implementation to prevent orphaned references and cascade failures under load. Created comprehensive QA brief at `.squad/qa-brief-issue-58.md` with 7 critical test cases and 5 decision points for Data to confirm.
- Manual root test triage on 2026-04-20 did not reproduce a failure: from `/home/appuser/workspace/dnd-notes`, `npm test` exits 0 on Node `v22.21.1`/npm `10.9.4`, and the root script fans out cleanly to `apps/web` (`vitest run`), `apps/api` (`node --import tsx --test test/*.test.ts`), and `apps/control-plane` with all three workspace test commands returning exit 0.
- Epic #42 Phase 0 review gate: repo evidence is strong enough to approve when `Dockerfile`, `README.md`, `RUNTIME.md`, `apps/api/src/note-store*.ts`, `apps/control-plane/src/provisioning.ts`, `platform/control-plane/**`, and `scripts/k3d/**` all line up with green validation (`npm run lint && npm run test && npm run build && npm run platform:validate`) plus recent green GitHub Actions runs for `ci.yml`, `k3d-smoke.yml`, and `deployment-artifacts.yml`.
- The remaining false-green trap for Phase 0 is smoke depth, not missing wiring: `scripts/k3d/smoke.sh` proves live tenant provisioning and `/ready` against in-cluster Postgres wiring, but it still does not create/read a real note against that provisioned tenant, so future platform gates should call that out explicitly.
📌 Team update (2026-04-20T13:31:33Z): npm-test-diagnosis complete — Chunk confirmed no code-level test failures; Brand fixed missing root npm install; all workspace tests now pass — Chunk, Brand
- **Legacy Schema Compatibility:** `apps/api/src/note-store.ts` owns SQLite bootstrap; backward-compatible schema changes need in-place startup upgrades not `CREATE TABLE IF NOT EXISTS` alone. Regression coverage lives in `apps/api/test/app.test.ts`.

- **Share-Link QA Coverage:** Root validation is `npm run lint && npm run test && npm run build`. Reveal endpoint returns `{ token, url }`, list responses stay metadata-only. Legacy hash-only links need regeneration guidance.

- **User-Facing Limitation:** Only share links created after plaintext token storage can be revealed; older links must be revoked and recreated.

- **Issue #20 QA Hotspots:** (1) Note attribution resolves via live `campaign_memberships` joins; guest-upgrade must keep same membership row/id. (2) Authenticated access still owner-only unless explicitly claimed. (3) Guest token stays valid backdoor after claim unless rotated. Root validation: `npm run lint && npm run test && npm run build` (all pass).

- **Issue #27 QA Traps:** (1) Route shadowing: Express matches `/api/notes/:noteId` before `/api/notes/sessions`, so `GET /api/notes/sessions` is shadowed. (2) URI decoding: Extra `decodeURIComponent()` breaks valid names like `50% done`. (3) Scoping mismatch: new session endpoints use `resolveOwnedCampaign()` while note access uses linked-membership scoping.

- **Issue #23 QA Gates:** Membership consolidation is owner-scoped and campaign-scoped. Attribution-only consolidation is correct and safe when `npm run lint && npm run test && npm run build` pass.

- **Session-Browser State Regression:** State machine must isolate auth bootstrap from load-workspace callbacks. Clicking `All notes`, `Browse by session`, or `New note` re-runs bootstrap if state is in dependency chain, flashing loader and overwriting draft state.

- **Issue #58 Postgres Adapter — High-Risk Gaps:** (1) Transaction semantics under failure; (2) connection pooling resilience; (3) schema idempotence; (4) ACID isolation level mismatch (Postgres DEFAULT vs. SQLite SERIALIZABLE); (5) query result type coercion; (6) graceful shutdown. Conditional blocker: isolation level and pool defaults must be decided before implementation. Comprehensive QA brief at `.squad/qa-brief-issue-58.md`.

- **Issue #43 Phase 0 QA Review — 5 Critical Checkers:** (1) Manifest/runtime mismatch — full K8s manifests for tenant provisioning missing. (2) Workflow drift — k3d-smoke validates only readiness, not actual CRUD. (3) Postgres env wiring — DATABASE_URL not explicitly tested end-to-end. (4) SPA fallback safety — no regression test for missing routes or XHR. (5) Same-origin default enforcement — no validation that ALLOWED_ORIGINS doesn't accidentally split origins.

- **npm Test Infrastructure Issue (2026-04-20):** Confirmed no code-level test failures; Brand fixed root `npm install`; all workspace tests now pass cleanly (`npm test` exit 0).

- **Phase 0 Validation Evidence:** Green when Dockerfile, RUNTIME.md, note-store adapters, control-plane provisioning, platform scripts, and GitHub Actions all align with passing validation (`npm run lint && npm run test && npm run build && npm run platform:validate`).

- **False-Green Trap:** k3d-smoke proves tenant provisioning + /ready probes but does NOT create/read actual notes, so smoke depth is shallow. Future gates should call this out explicitly.

- **PR #77 JSON payload gate (2026-04-22):** the cheapest high-signal regression for `scripts/k3d/smoke.sh` is to execute `build_tenant_create_payload()` directly and `JSON.parse` its output in `apps/control-plane/test/k3d-smoke-payload.test.ts`; that catches bad escaping before a full k3d boot. After the script change lands, the follow-up manual proof is still `npm run k3d:smoke`, because only the live lane confirms the control-plane accepts the tenant-create payload end to end.

📌 Team update (2026-04-22T15:44:09Z): PR #77 JSON payload follow-up complete. Brand replaced manual tenant-create payload construction with Node JSON.stringify in scripts/k3d/smoke.sh; Chunk added regression coverage in apps/control-plane/test/k3d-smoke-payload.test.ts validating emitted JSON before live smoke run; all gates green (lint/test/build/platform:validate). Two decisions merged to squad/decisions.md. Session log: `.squad/log/2026-04-22T15:44:09Z-pr77-json-fix.md`. — Scribe

---
- **PR #77 review-fix QA (2026-04-22):** `apps/api/src/note-store.ts` must throw the typed `OwnerKeycloakLinkConflictError` and `apps/api/src/route-support.ts` must map that structured conflict to HTTP 409 without reading `Error.message`; `apps/api/test/keycloak-runtime-auth.test.ts` now locks both the real linked-email conflict path and a route-layer regression that would fail if message matching comes back.
- **Web Keycloak no-op trap:** `apps/web/src/App.tsx` still renders the Keycloak sign-in shell even after a bootstrap failure because `/api/auth/config` can succeed before client init fails, so the safe UX is an explicit actionable error when `keycloakClientRef.current` is missing instead of optional-chaining `login()`. Regression coverage lives in `apps/web/src/App.keycloak-auth.test.tsx`.
- **Shell lane for PR #77:** `scripts/k3d/smoke.sh` Bash-compatibility remains a manual gate; the highest-signal check is to invoke the smoke entrypoint with macOS `/usr/bin/bash` (or another Bash 3.2 shell) and confirm it no longer dies on `inherit_errexit` before the live k3d flow starts.
- **PR #77 JSON payload gate (2026-04-22):** the cheapest high-signal regression for `scripts/k3d/smoke.sh` is to execute `build_tenant_create_payload()` directly and `JSON.parse` its output in `apps/control-plane/test/k3d-smoke-payload.test.ts`; that catches bad escaping before a full k3d boot. After the script change lands, the follow-up manual proof is still `npm run k3d:smoke`, because only the live lane confirms the control-plane accepts the tenant-create payload end to end.

📌 Team update (2026-04-22T15:19:20Z): PR #77 review follow-up orchestration complete. Four agents (Brand, Data, Stef, Chunk) addressed three Copilot review comments on squad/76-complete-runtime-keycloak-auth-integration. Brand guarded `inherit_errexit` for Bash 3.2 compat (manual gate); Data typed Keycloak conflict handling (API regression); Stef surfaced missing-client UX (web regression); Chunk verified all gates green (lint/test/build/platform:validate passed). Four decisions merged to squad/decisions.md. Session log: `.squad/log/2026-04-22T15:19:20Z-pr77-review-followup.md`. Orchestration logs per agent in `.squad/orchestration-log/`. — Scribe

### Issue #68 QA lane prep (2026-04-22)
- The highest-signal first slice for the operator portal is an auth-gated, read-heavy shell on top of the existing control-plane contract: `GET /internal/fleet/status` for fleet state plus tenant reads for drill-in. Avoid shipping portal-local write paths before the UI can show clear side-effect copy and post-action transition evidence.
- Added control-plane regressions in `apps/control-plane/test/keycloak-auth.test.ts` so the future portal's primary read surface (`/internal/fleet/status`) and a representative write route (`/internal/tenants/:tenantId/provision`) both stay locked behind admin/workforce Keycloak roles.
- Extended `apps/control-plane/test/app.test.ts` so fleet status, provision, and deprovision coverage now preserve `latestTransition.triggeredBy` and `reason`, giving the portal a stable audit trail for operator side-effect clarity.
- Reuse `apps/web/src/SiteAdminPanel.tsx` and `apps/web/src/App.site-admin.test.tsx` as the local precedent for destructive-action warning copy and confirmation-driven UX.

---

## Issue #68 First Operator Portal QA Gate (2026-04-22T16:51:23Z)

Established QA gate for #68 operator portal first slice:
- Defined auth-gated, read-heavy control surface acceptance criteria
- Added tests for operator auth on fleet reads and representative write routes
- Validated audit trail visibility for write operations (`triggeredBy`, `reason` fields)
- Extended regressions for fleet status and provision/deprovision side effects
- Confirmed all lint, test, build gates pass

**Key decision locked:** Chunk/issue68-qa.md (Scribe merged to decisions.md)

**Gate pattern:** Any write action must (1) call existing control-plane endpoint, (2) surface side effect clearly, (3) show audit trail afterward.

**Status:** QA gate established and validated. Ready for merge.

### Issue #68 Rolling-Update QA Pass (2026-04-22T17:30:00Z)
- `apps/operator-portal/src/TenantUpgradeDialog.tsx` keeps the rolling-update path honest by requiring a different target version, a non-empty operator reason, and typed target-version confirmation before it reuses `POST /internal/tenants/:tenantId/provision`.
- `apps/operator-portal/src/OperatorPortal.tsx` only exposes `Roll to new version` for tenants in `ready`, and `apps/operator-portal/src/OperatorPortal.actions.test.tsx` now locks that ready-only visibility alongside the successful rollout/audit-refresh path.
- Focused regression placement still matches the frontend testing pattern: `apps/operator-portal/src/App.test.tsx` stays smoke-sized while lifecycle behavior lives in `apps/operator-portal/src/OperatorPortal.actions.test.tsx`.
- Verified portal gate with `cd apps/operator-portal && npm test && npm run lint && npm run build` — all green.
- Highest remaining risk: unsupported target versions, concurrent upgrade attempts, or control-plane-side rollout failures will surface only whatever error text the backend returns, so deeper failure-mode confidence still depends on control-plane coverage.

### PR #78 review-fix batch QA (2026-04-22T18:00Z follow-up)
- The safe review scope for this batch is tiny: confirm the two ignored runtime artifacts under `.squad/log/` and `.squad/orchestration-log/` are only present as deletions, confirm no new additions/modifications under ignored runtime paths remain in the diff, and verify the README wording against existing portal behavior instead of re-reviewing the full feature.
- `apps/operator-portal/README.md` is now accurate because the live portal already supports tenant creation + provisioning (`apps/operator-portal/src/ProvisionTenantPanel.tsx`), tenant deprovision (`apps/operator-portal/src/TenantDeprovisionDialog.tsx`), and ready-only rolling updates (`apps/operator-portal/src/TenantUpgradeDialog.tsx`, gated in `apps/operator-portal/src/OperatorPortal.tsx`).
- The highest-signal targeted regression for that README claim is `cd apps/operator-portal && npm test -- src/OperatorPortal.actions.test.tsx`; it proves provision, deprovision, ready-only rollout visibility, successful roll-forward, and rollout failure guidance without rerunning the whole repo.
