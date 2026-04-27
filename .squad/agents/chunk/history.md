# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context (Summarized 2026-04-26T15:45:50Z)

Chunk is the QA/Tester for the squad, responsible for regression coverage, gate validation, and identifying high-risk parity gaps. Primary domains: acceptance validation, test infrastructure design, CI wiring, cross-agent testing coordination.

**Key Pattern:** Find parity gaps early (SQLite ↔ Postgres), gate on measurable regression coverage, propagate learnings to future issues.

**Historical Work (2026-04-11 to 2026-04-22, archived):**
- Initialized QA role; validated SQLite regression, approved share-link/session-browsing slices
- Caught guest-token backdoor and state-machine isolation gaps, identified route shadowing + decoding traps
- Led Phase 0 QA (5 critical deployment-artifact checkers)
- Resolved npm test infrastructure gaps

**Recent QA Validations (2026-04-22 to 2026-04-25):**
- Issue #68: Rolling-update lifecycle action (ready-only guardrail, audit visibility, operator confirmation flow)
- Issue #78: Auth cleanup + CI-safe polling (token normalization, localStorage clearance, state resets)
- Issue #97: Control-plane Postgres migration (acceptance bar, test coverage requirements)
- Epic #87: Comprehensive test audit (code consolidation PASS; 2 CI gaps identified: keycloak-jwt, portal-utils tests not wired)

**Key Learnings:**
- Keycloak token storage must normalize strings, reject malformed blobs, clear localStorage immediately
- Session state clearance should be comprehensive: tokens, fleet/loading state, errors, lifecycle dialogs
- CI polling assertions need modest explicit timeout budgets to avoid scheduler jitter
- Epic completion should distinguish "code complete" from "quality tooling wired"

📌 Issue #68 rolling-update lifecycle action QA review (2026-04-22T17:31:44Z): Chunk approved rolling-update slice. Verified ready-only guardrail, audit visibility, operator-facing confirmation flow. Added focused regression lock in OperatorPortal.actions.test.tsx. Portal validation passing (lint/test/build). Ready for merge. Orchestration log at `.squad/orchestration-log/2026-04-22T17:31:44Z-chunk.md`. Session log at `.squad/log/2026-04-22T17:31:44Z-issue68-lifecycle-review.md`. — Chunk (QA/Tester)



## Learnings

### PR #120 k3d persistent lane review bar (2026-04-26)
- `scripts/k3d/down.sh` and `scripts/k3d/status.sh` should treat `K3D_CLUSTER_NAME` as highest priority, then fall back to `.k3d-state/state.json` `clusterName`, then `dnd-notes`; reviewer proof must check the live `k3d`/`kubectl` target and the emitted status payload, not just one branch.
- `scripts/k3d/down.sh` should require `kubectl` only for `--keep-cluster`; full teardown must still work with just `k3d`, while `--keep-cluster` proves `kubectl config use-context` and namespace/deployment deletes against the resolved cluster.
- `apps/control-plane/test/k3d-persistent-lane.test.ts` already dropped login-shell semantics (`spawnSync('bash', ['-c', ...])`), but this review round still needs focused regression coverage for cluster-name precedence and `kubectl` gating because those behaviors are not locked yet.
- Reviewer trap: `scripts/k3d/status.sh` can probe the env-override cluster while still emitting the persisted `state_clusterName` in `--json`; acceptance for “env override wins” must include the reported `clusterName`, not only the context switch.
- Key paths for this slice: `scripts/k3d/down.sh`, `scripts/k3d/status.sh`, `apps/control-plane/test/k3d-persistent-lane.test.ts`.
- Final verdict nuance: the runtime fix in `scripts/k3d/status.sh` now aligns behavior/output for `K3D_CLUSTER_NAME`, but the added regression test is false-green because it sets an env `STATE_FILE` that `status.sh` never reads; unless the repo-root `.k3d-state/state.json` is populated, the test passes even on the old broken output path.
- Review proof for this lane should simulate both precedence branches with the real consumed state location (or extract cluster resolution into a sourceable helper) so coverage locks: persisted default when no override is set, env override in both live context switch and JSON, and prior `down.sh` gating behavior.

### PR #78 auth cleanup + CI-safe polling QA review (2026-04-22)
- `apps/operator-portal/src/keycloak-client.ts` should normalize restored Keycloak token blobs by requiring string `accessToken`/`refreshToken`, treating `idToken` as optional, and clearing malformed localStorage immediately so bootstrap falls back to a clean signed-out state.
- `apps/operator-portal/src/keycloak-client.test.ts` is the focused regression layer for malformed token storage; keep app-shell auth tests (`apps/operator-portal/src/App.test.tsx`) focused on visible UX resets like stale error cleanup after `clearSession()`.
- `apps/operator-portal/src/OperatorPortal.tsx` should treat `clearSession()` as a full logged-out reset: clear stored tokens, active fleet/loading state, inline errors/notices, and any open lifecycle-dialog targets so the sign-in shell never inherits stale operator state.
- `apps/control-plane/test/provisioning.test.ts` should keep namespace-termination polling assertions intact while using a modest explicit timeout budget (currently `deleteTimeoutMs: 200` with `readyPollIntervalMs: 1`) so CI scheduler jitter does not become part of the contract.
- Focused validation for this review slice passed from the repo root with `npm run lint:operator-portal && npm run test:operator-portal && npm run build:operator-portal && npm run lint --workspace apps/control-plane && npm run test:control-plane && npm run build --workspace apps/control-plane`.

### PR #78 follow-up QA review (2026-04-22)
- `apps/operator-portal/src/OperatorPortal.actions.test.tsx` should keep recording unexpected create/provision POST payloads, but each unexpected mock branch must return an explicit `500` JSON response so accidental writes fail as actionable HTTP errors instead of `undefined` crashes.
- `.squad/agents/stef/history.md` should keep a single `## Core Context` heading after summarization; duplicate headings are cleanup-only and safe to delete.
- Focused validation for this operator-portal lane is `npm run lint:operator-portal && npm run test:operator-portal && npm run build:operator-portal` from the repo root.

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

### PR #78 operator-portal reviewer-fix pass (2026-04-22T18:56Z)
- `apps/operator-portal/src/ProvisionTenantPanel.tsx` now re-checks `disabledReason` inside `handleConfirm`, mirrors the fresh disable reason inside the open confirmation dialog, and disables the final `Create and provision tenant` button so a review dialog cannot go stale after fleet refresh.
- `apps/operator-portal/src/OperatorPortal.actions.test.tsx` now refreshes fleet state while the provisioning dialog is open and proves the confirm CTA locks before any create/provision requests fire when the provisioning lane flips disabled.
- The same focused action suite now gives rollout failure cases readable Vitest names by passing the scenario label positionally in `it.each(...)`, so CI output shows human labels instead of stringified row objects.
- Verified with `npm run lint --workspace apps/operator-portal && npm run build --workspace apps/operator-portal && npm run test --workspace apps/operator-portal -- src/OperatorPortal.actions.test.tsx`.

### PR #78 base-path utility review (2026-04-22T19:55Z)
- The base-path follow-up is low-risk when `apps/operator-portal/src/base-path.ts` stays a pure string helper and both `apps/operator-portal/src/config.ts` and `apps/operator-portal/vite.config.ts` import it instead of carrying copy-pasted normalization logic.
- `apps/operator-portal/src/base-path.test.ts` is the right regression seam: keep coverage on blank input fallback, `/` passthrough, and whitespace/trailing-slash trimming so runtime and Vite proxy config cannot silently diverge later.
- Reviewer proof for this slice is `npm run lint:operator-portal && npm run test:operator-portal && npm run build:operator-portal`; I also re-ran the full repo `npm run lint && npm test && npm run build` and it stayed green with the shared utility wired in.

### PR #78 initialAdminEmail contract-alignment QA (2026-04-22T20:05Z)
- `apps/control-plane/src/app.ts` and `apps/control-plane/src/tenant-registry.ts` already treat `POST /internal/tenants.initialAdminEmail` as optional, so `apps/operator-portal/src/types.ts` should mirror that optionality instead of forcing a stricter client contract.
- Keep the portal create flow behavior-preserving by typing the request object explicitly in `apps/operator-portal/src/ProvisionTenantPanel.tsx` while still sending the reviewed `initialAdminEmail` value the UI requires today.
- The fetch-mock seams in `apps/operator-portal/src/OperatorPortal.actions.test.tsx` should model the optional request field too and coalesce missing request email values back to `null` on mocked tenant responses, matching the control-plane tenant shape.
- QA proof for this follow-up: baseline + post-fix `npm run lint:operator-portal && npm run test:operator-portal && npm run build:operator-portal`.

## Issue #97 QA Gate — SQLite → Postgres Control-Plane Registry (Prepared 2026-04-23)

**Stance:** Ready to QA the thin-slice Postgres migration. Current baseline: all 115 control-plane tests pass against SQLite; migration target is Postgres with zero assertion changes in test suite (only database backend swap).

**Acceptance Checklist:**
- ✅ No `better-sqlite3` in `apps/control-plane` source files
- ✅ All 115 tests pass against Postgres without assertion rewrites
- ✅ Constraint error codes (23505, 23503, etc.) map correctly → 409 API responses
- ✅ Schema migrations v1→v5 idempotent on real Postgres
- ✅ Pool graceful shutdown wired into existing close() path
- ✅ `npm run k3d:full-stack-smoke` passes end-to-end
- ✅ PVC removed; migration strategy documented

**High-Risk Parity Gaps Identified:**
1. Schema idempotence: SQLite `CREATE IF NOT EXISTS` → explicit Postgres migrations
2. Transaction semantics: SQLite SERIALIZABLE → Postgres READ COMMITTED (default)
3. Constraint mapping: Postgres error codes (23505 unique, 23503 foreign key, etc.)
4. Graceful shutdown: pool.end() awaited during close
5. Numeric types: SQLite TEXT/INTEGER → Postgres UUID/BIGINT/TIMESTAMP

**Recommended Slice Order:**
1. **Slice 1 (High Risk):** Schema definition + full test adapter. Gate: 115 tests pass.
2. **Slice 2 (High Risk):** Constraint error mapping in app.ts. Gate: 409 responses, no 500s.
3. **Slice 3 (Medium Risk):** Connection pooling + env config. Gate: CONTROL_PLANE_DATABASE_URL wired.
4. **Slice 4 (Low-Medium Risk):** K3d provisioning + smoke integration.
5. **Slice 5 (Low Risk):** PVC removal + docs cleanup.

**Test Infrastructure Decisions Needed (Blocker):**
- Schema migration framework: raw SQL vs. knex vs. other?
- Test Postgres: testcontainers vs. ephemeral instance vs. CI managed?
- Isolation level: explicit SET TRANSACTION or rely on READ COMMITTED default?

**Current State:**
- Worktree: fresh, no changes yet (HEAD at post-merge #81)
- `npm test --workspace apps/control-plane` baseline: 115 pass, 0 fail
- All existing regression coverage is SQLite-aware; minimal changes needed after DB swap

**Next Move:**
Waiting for Copilot to implement Slice 1. Will validate test coverage before approving each slice.


**Work Completed (2026-04-23T21:00:00Z):**
- Reviewed issue #97 scope (SQLite → Postgres control-plane registry migration)
- Analyzed current SQLite-based tests: 115 passing, zero failures
- Identified 5 high-risk parity gaps (schema idempotence, transaction semantics, constraint mapping, shutdown, type coercion)
- Created detailed QA brief with acceptance gates, checkpoints, and approval criteria
- Baseline validated: `npm test --workspace apps/control-plane` returns 115 pass / 0 fail
- Committed QA preparation to worktree branch

**Key Testing Strategy:**
- All 115 existing tests must pass without assertion changes
- Only database backend swaps from SQLite to Postgres
- Constraint error mapping: SQLITE_CONSTRAINT_* → Postgres error codes (23505, 23503, etc.)
- Schema migrations v1→v5 must be idempotent on real Postgres
- Graceful shutdown path must remain unchanged

**Recommended Slice Order (for Copilot):**
1. Schema definition + test adapter (highest risk, must get 115 tests passing)
2. Constraint error mapping in app.ts (must return 409, not 500)
3. Connection pooling + env config (CONTROL_PLANE_DATABASE_URL)
4. K3d provisioning + smoke integration
5. PVC removal + docs cleanup

**Next Actions:**
- Waiting for Copilot to implement Slice 1
- Will validate all test gates pass before approving each slice
- Specific gate: `npm test --workspace apps/control-plane` must exit 0 with no assertion rewrites


## Epic #87 Validation — CI & Test Coverage Audit (2026-04-25)

Completed read-only test + CI audit for all 6 items of Epic #87:

### Test Coverage Status

- ✅ **Item 1:** `apps/api/test/control-routes.test.ts:381` — inflight drain validated
- ✅ **Item 2:** `apps/control-plane/test/tenant-backup-runner.test.ts`, `app.test.ts:1862–2430`, `tenant-registry.test.ts` — backup/restore/audit/catalog
- ✅ **Item 3:** `platform/keycloak-jwt/test/*.test.ts` — 19 tests, **NOT in CI**
- ✅ **Item 4:** `packages/portal-utils/src/base-path.test.ts` — 8 tests, **NOT in CI**
- ✅ **Item 5:** `apps/api/src/note-store*.ts` — comprehensive module coverage
- ✅ **Item 6:** `apps/control-plane/test/migrate.test.ts` — versioned ledger with advisory locks

### CI Gap Finding

Two test suites exist but missing from `scripts/run-ci-tests.mjs:13–19`:
1. **keycloak-jwt** (19 tests, security-critical token verification)
2. **portal-utils** (8 tests, shared config logic)

Risk: test drift on shared modules. Both already have test:ci scripts ready.

### Verdict

Code consolidation for all 6 items is complete and functional. Test infrastructure is in place but CI wiring is missing. Marked as P1 follow-up. Session: `.squad/log/2026-04-25T22:54:46Z-87-validation.md`.
## Recent Updates

### PR #120 final QA review (2026-04-26)
- `scripts/k3d/status.sh` is safe to approve only when the tenant `/ready` probe is optional: `probe_tenant_url()` must skip cleanly when `curl` is missing and surface that branch in both text output (`HTTP /ready: skipped`) and JSON output (`tenant.urlProbeSkipped`).
- `scripts/k3d/status.sh` now needs an explicit `reset_state()` before each `read_state()` attempt so stale `state_*` values cannot leak forward after missing/corrupt `.k3d-state/state.json`.
- `scripts/k3d/down.sh` should keep `read_state_field()` best-effort for `--keep-cluster`: when `node` is missing or the state file is unreadable, return empty output and fall back to scanning `tenant-*` namespaces instead of aborting under `set -Eeuo pipefail`.
- High-signal reviewer proof for this lane is `npm run lint --workspace apps/control-plane && npm run test --workspace apps/control-plane && npm run build --workspace apps/control-plane`, because `apps/control-plane/test/k3d-persistent-lane.test.ts` now locks the curl-missing, stale-state, and node-missing regressions directly against the shipped shell functions.

### PR #120 follow-up blocker QA bar (2026-04-26)
- Smoke CI is already green again on `e5d146f`; the remaining review scope is surgical: `scripts/k3d/up.sh` must still import both tenant and control-plane images into the target cluster on `--no-rebuild`, not just skip the Docker builds when host tags exist.
- Because `write_state()` persists plaintext creds + token snippets, approval now requires filesystem-hardening proof too: `.k3d-state/` should end up owner-only (700-ish) and `state.json` owner-readable/writable only (600-ish), with a regression that inspects actual modes after the real write path.
- The current env-override status test still mutates the repo-root `.k3d-state/state.json`; the fix is only safe when tests stop touching that live path while exercising the same contract (for example via a script-supported state-path override or isolated repo fixture). Reviewer proof should include an interrupted-run thought experiment: no developer state corruption, no race with someone running `npm run k3d:status`, same shell entrypoint contract preserved.

---
📌 **Team update (2026-04-26T21:37:02Z):** PR #120 review complete — Brand completed all 4 review fixes (status.sh, read_state, read_state_field, PR description). Performed final reviewer pass and approved PR #120 for merge. Commit: 18101a1. Remaining work: merge and CI bookkeeping. — Chunk

📌 **Team update (2026-04-26T22:06:15Z):** PR #120 revision 3 approved after Mikey's false-green regression proof fix. Test now validates real `.k3d-state/state.json` path. All prior fixes (corrupt state recovery) remain valid. No new regressions. Ready for merge. Lockout-compliant handoff complete: Brand → Data → Mikey → Chunk. — Chunk

📌 **Team update (2026-04-27T00:01:25Z):** PR #120 final approval: Brand pushed 86fc630 fixing image import `--no-rebuild` gate, `.k3d-state` permissions, and regression test isolation via `K3D_STATE_FILE`. All three blockers confirmed resolved. No regressions detected. Smoke failure (e5d146f, separate fix) no longer rejection basis. Review round closed. — Chunk




## Slice 1 QA Work (Issue #82, 2026-04-26)

**Task:** Proactive QA audit for Slice 1 orchestration core (k3d:up/down/status commands).

**Findings:**

1. **Existing Validation Surface (from #42):**
   - `smoke.sh`: 13KB bash script with HTTP health checks, readiness probes, Keycloak token flows, tenant provisioning validation
   - `full-stack-smoke.sh`: 12KB full-stack orchestration test including operator-portal provisioning UI harness
   - `k3d-smoke-payload.test.ts`: Unit tests on shell payload builders (tenant JSON, request helpers)
   - `live-smoke.test.tsx`: Mock-based operator portal provisioning flow tests (6 scenarios including slow provisioning, failures, timeouts)
   - Control-plane test files: provisioning.test.ts, shutdown.test.ts, full-stack-smoke-script.test.ts

2. **Slice 1 Missing Pieces:**
   - No `k3d:up` / `down` / `status` npm scripts (only bootstrap → smoke → full-stack-smoke progression)
   - No persistent state.json artifact (.k3d-state/)
   - No JSON output contract or schema
   - No idempotency contract (re-running bootstrap should be safe)
   - No stale-state recovery (if cluster dies, how do we recover?)

3. **Key Regression Checks (Highest Value):**
   - Tenant provisioning through control-plane API works end-to-end
   - Keycloak JWT validation in control-plane + tenant-api flows
   - Ingress routing to tenant pods via nip.io domain
   - Port-forward paths (postgres, control-plane, keycloak) work correctly
   - Image import into k3d succeeds without stalling
   - Guest token routes (share-link) work without Keycloak auth

4. **Agent-Friendly Patterns Observed:**
   - `K3D_SMOKE_OUTPUT=json` flag on full-stack-smoke.sh (returns provisioning result with namespace/hostname)
   - Environment variable overrides for all tunable parameters (K3D_CLUSTER_NAME, K3D_HTTP_PORT, etc.)
   - Health check helpers in smoke.sh (wait_for_http, wait_for_tcp, wait_for_rollout)
   - Request helper with clear error logging (request_json_to_file includes response body on HTTP errors)

**Deliverables:**

1. ✅ **QA Contract Document** (.squad/decisions/inbox/chunk-issue-82-slice-1-qa.md):
   - 6 core validation scenarios (happy path, idempotency, stale recovery, JSON contract, state atomicity, error handling)
   - Explicit acceptance bar for Slice 1 implementation
   - Must-have tests and regression checks
   - JSON schema for k3d:status --json output
   - Integration points with future Tracks B, C, D

2. ✅ **Validation Script** (scripts/k3d/validate-status-json.js):
   - Standalone Node.js validator for JSON schema compliance
   - Enforces field presence, type checking, and status enum validation
   - Reusable for all k3d:* scripts once --json support is added
   - Exit codes for CI integration

**Learnings for Future Issues:**

- k3d/k3s testing demands both local speed (bootstrap fast) and real orchestration validation (full provisioning flow)
- State management is critical for agent-friendly workflows; JSON contract must be stable and documented before implementation
- HTTP health checks must have configurable timeouts to avoid scheduler jitter (CI vs local variance)
- Shell-based orchestration benefits from extracted helper functions (makes testing easier via test extraction)
- Guest/share-link token flows are orthogonal to control-plane provisioning but must not regress

**Key File Paths:**
- Decision doc: `.squad/decisions/inbox/chunk-issue-82-slice-1-qa.md`
- Validator: `scripts/k3d/validate-status-json.js`
- Existing tests: `apps/control-plane/test/k3d-smoke-payload.test.ts`, `apps/operator-portal/src/live-smoke.test.tsx`
- Bootstrap/smoke scripts: `scripts/k3d/bootstrap.sh`, `smoke.sh`, `full-stack-smoke.sh`

**Recommendations:**

1. **Brand should consult the QA contract before implementation** to understand acceptance bar upfront
2. **Validator script can be called in CI** once k3d:status is implemented (e.g., `npm run k3d:status -- --json | node scripts/k3d/validate-status-json.js`)
3. **Slice 1 should re-run existing smoke/full-stack-smoke tests** as regression gates
4. **Once Slice 1 lands**, Track B (portal containerization) and Track C (overrides) must re-run full suite to ensure no breaks
5. **Consider extracting common shell helpers** (wait_for_http, request_json_to_file, etc.) from smoke.sh into a reusable library for consistency





