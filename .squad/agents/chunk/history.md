# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Chunk is the QA/Tester for the squad, responsible for regression coverage, gate validation, and identifying high-risk parity gaps.

**Historical Milestones (2026-04-11 to 2026-04-20):**
- Initialized as tester on 2026-04-11
- Validated SQLite startup fix regression coverage (2026-04-12)
- Approved campaign share-link reveal slice (2026-04-12)
- Approved Issue #27 session-browsing backend and frontend slices (2026-04-12)
- Contributed to membership consolidation QA gates; identified guest-token post-claim backdoor and helped Data fix it (2026-04-13 to 2026-04-14)
- Session-browser state regression caught: state machine must isolate auth bootstrap from load-workspace callbacks (2026-04-13)
- Identified Issue #27 shadowing bug (sessions route after note ID route) and decoding trap (2026-04-13)
- Led Phase 0 QA review; identified 5 critical deployment-artifact checkers for Brand/Data (2026-04-20)
- Diagnosed and helped resolve npm test infrastructure issue with root install (2026-04-20)
- Published comprehensive QA brief for Issue #58 (Postgres adapter) with 7 critical test cases and isolation/pool/schema decision points (2026-04-18)

**Key Pattern:** Find parity gaps early (SQLite ↔ Postgres), gate on measurable regression coverage, propagate learnings to future issues.

## Recent Updates (Last 5)






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

