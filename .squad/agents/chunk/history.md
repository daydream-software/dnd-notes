# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Chunk initialized as Tester for the initial project squad.


## Core Context

*History summarized on 2026-04-18T22:58:15.109090 — old entries moved to archive. Keeping last 10 team updates and all learnings.*


## Recent Updates (Last 10)

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
📌 Team update (2026-04-12T13:32:51Z): Validated regression coverage for SQLite startup fix—confirmed legacy-schema bootstrap path now covered in tests; full test/build/lint pass — decided by Data, Chunk
📌 Team update (2026-04-12T14:38:40Z): Campaign share links stay as reusable single links with owner-only on-demand reveal; listings stay metadata-only and legacy hash-only links must be revoked/recreated to become revealable again — decided by FFMikha (via Copilot), Mikey, Data, Stef, Chunk
📌 Team update (2026-04-12T17:35:41Z): Issue #27 backend revision approved; frontend UI slice approved; both ready to merge; session browsing thin slice complete (two-step flow, numeric sort, no redesign) — decided by Chunk (reviewer), Stef (implementer)

## Learnings

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
📌 Team update (2026-04-20T13:31:33Z): npm-test-diagnosis complete — Chunk confirmed no code-level test failures; Brand fixed missing root npm install; all workspace tests now pass — Chunk, Brand

*227 older learning items archived.*


📌 Team update (2026-04-19T22:50:29Z): Issue #58 decisions locked by Mikey. QA gate conditional blocker resolved. Ready for Data implementation phase with 7 done signals + concurrency test cases. Re-review against checklist at merge time. — Scribe

## Issue #43 QA Review (2026-04-21)

**Scope:** Deployment artifacts for Kubernetes + Postgres per-tenant, same-origin default. Brand implementing platform slice in parallel.

**Current State:**
- Dockerfile: Multi-stage build (base → deps → build → runtime); serves web + API on 3000; uses appuser non-root; SQLite fallback at `/app/data`.
- RUNTIME.md: Comprehensive environment contract; `/ready` and `/healthz` probes documented; graceful shutdown at SIGTERM; `SERVE_WEB=true` enables same-origin.
- CI (ci.yml): Lint → test → build pipeline; consolidated test reporting; `npm run lint && npm test && npm run build`.
- k3d smoke (k3d-smoke.yml): Pinned k3s v1.35.3; builds tenant image; validates provisioning + readiness.
- k3d bootstrap/build scripts: Cluster setup, ingress-nginx, platform Postgres (postgres:17.9), Keycloak seeding.
- postgres.yaml: Platform Postgres with `pg_isready` readiness probe; Secret (dev-only creds); PVC 5Gi.
- Same-origin enforcement: `SERVE_WEB=true` default in container; `PUBLIC_WEB_URL` controls share-link generation; no CORS splitting unless intentional.
- Postgres adapter: Issue #58 Postgres bridge complete (NoteStore adapter with SQLite fallback).

**Highest-Risk Gaps (5 critical checkers):**
1. **Manifest/Runtime Mismatch** — Worktree artifacts don't include full Kubernetes manifests for tenant provisioning (Deployment, Service, ConfigMap, Secret, PVC patterns).
2. **Workflow Drift** — k3d-smoke.yml checks only readiness; does not validate actual note create/read/update/delete against Postgres or shared-link flows.
3. **Postgres Env Wiring** — RUNTIME.md documents pool config but no explicit test that `DATABASE_URL` is correctly threaded through control-plane provisioning and tenant environment.
4. **SPA Fallback Safety** — `apps/api/src/app.ts` has SPA fallback but no explicit regression test that `GET /assets/missing.js`, `POST /missing-route`, or cross-origin XHR don't return index.html.
5. **Same-Origin Default Enforcement** — Dockerfile + RUNTIME.md assume `SERVE_WEB=true` for production, but no validation that `ALLOWED_ORIGINS` defaults don't accidentally split origins in same-origin deployments.

**Conditional Blocker:**
> **Before Brand approval:** Manifest slices must prove:
> - Tenant Deployment/Service/ConfigMap/Secret templates exist and match control-plane provisioning contract.
> - Full end-to-end smoke includes authenticated note workflow (create + read) against Postgres.
> - `DATABASE_URL` injection verified in pod environment and working via health check.

**Learnings:**
- Worktree contains the platform k3d loop (bootstrap + smoke) but **not** the tenant Deployment/Service/ConfigMap/Secret manifests that control-plane will apply.
- Same-origin pattern is locked in; CORS allowlists only relevant for intentional split-origin layouts (explicitly deferred).
- SPA fallback logic exists in code but no edge-case regression coverage yet.
- All 47 tests pass locally and in CI; no code-level test failures found.


**Key Files for Brand Implementation:**
- `apps/control-plane/src/provisioning.ts` — TenantInfrastructureManager applies Namespace, ConfigMap, Secret, PVC, Service, Deployment; calls `applyTenantResources()`.
- `Dockerfile` — Multi-stage build complete; SERVE_WEB=true default; port 3000; SQLite fallback `/app/data`; non-root appuser.
- `RUNTIME.md` — Comprehensive env contract; `/ready` + `/readyz` probes; graceful shutdown on SIGTERM; Postgres pool defaults.
- `platform/k3d/postgres.yaml` — Platform Postgres template (read-only; not customizable by Brand).
- `scripts/k3d/bootstrap.sh` + `build-tenant-image.sh` — Cluster setup, image build/import (read-only; finalized).
- `.github/workflows/k3d-smoke.yml` — Smoke lane; Brand enhances with full note workflow (create/read/update against Postgres).

**Brand Implementation Scope:**
1. Create tenant Deployment manifest template (pod spec, `DATABASE_URL` injection, readiness/liveness probes).
2. Create tenant Service manifest (ClusterIP, port 3000, selector).
3. Create tenant ConfigMap (public config like `PUBLIC_WEB_URL`, `SITE_ADMIN_EMAILS`).
4. Create tenant Secret (sensitive env like `DATABASE_URL`).
5. Create tenant PVC template (mount at `/app/data` for SQLite fallback).
6. Enhance k3d smoke lane to create a note, read it back, verify Postgres backend (end-to-end validation).
7. Verify `DATABASE_URL` injection works; readiness probes return 503 when DB is down.

**SPA Fallback Safety — No Action Needed:**
- Guards are present: `request.accepts('html')` + `extname(path) === ''` prevent index.html for XHR/file requests.
- Regression test exists: `core-workflows.test.ts` 'SERVE_WEB fallback only serves HTML navigation requests' validates all edge cases.

Adapter **Postgres No Action Needed:** 
- Issue #58 Postgres bridge complete; NoteStore supports both SQLite and Postgres via `DATABASE_URL`.
- Pool drains cleanly on shutdown.
- Admin backup/restore endpoints work with both backends.

**Decision Context — Already Locked:**
- Same-origin default finalized (Dockerfile + RUNTIME.md enforce `SERVE_WEB=true`).
- Kubernetes version pinned to k3s v1.35.3 (kept consistent between local k3d and CI).
- Postgres 17.9 pinned for platform (development-only; never for production).


## 2026-04-21: Orchestration — Issue #43 QA Checklist Merged

1. Tenant Kubernetes manifests required
2. End-to-end Postgres smoke test required (note create/read path)
3. DATABASE_URL injection verification required

Chunk's decision merged by Scribe as part of orchestration completion. Brand's PR #66 now blocks on these three checklist items.

## 2026-04-21: PR #66 Review Closure — All 7 Comments Addressed

**Status:** ✅ SHIP-SAFE

Brand's PR #66 (feat(platform): add deployment artifacts for #43) received 7 Copilot review comments on 2026-04-21. FFMikha addressed all 7 with commit f9e4966. Chunk verified resolution:

1. **Readiness handler extraction** (`/readyz` + `/ready`) — shared `readinessHandler` function extracted; both routes reuse same logic; 503 error response when tenant registry unavailable confirmed.
2. **Workflow Node.js pinning** — SHA-pinned `actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444` (v5.0.0) added before npm steps; `.nvmrc` pinned to `v22.21.1` (consistent with repo standard).
3. **Deployment image tag reproducibility** — base `deployment.yaml` uses tagless image `ghcr.io/daydream-software/dnd-notes-control-plane`; k3d overlay keeps local `:latest` pin; hosted-reference overlay injects explicit placeholder tag via Kustomize `images` strategy.
4. **Pod security context (PVC write permissions)** — pod-level `securityContext` added with `fsGroup: 10001` and `fsGroupChangePolicy: OnRootMismatch`; non-root appuser can now write SQLite DB to `/app/data` PVC mount without init container.
5. **k3d Secret credentials (security hardening)** — all committed Secret values replaced with placeholders (`replace-with-local-*`); k3d overlay now documents `kubectl create secret ... | kubectl apply -f -` workflow in `platform/control-plane/README.md`.
6. **README health endpoint duplication** — duplicate `/healthz`, `/readyz`, `/ready` bullets removed from `apps/control-plane/README.md`; now single canonical endpoint list.
7. **README Deployment Artifacts section duplication** — duplicate "Deployment Artifacts" section removed from `apps/control-plane/README.md`; now single source of truth.

**Validation Run (worktree squad/43-deployment-artifacts @ f9e4966):**
- ✅ `npm run lint` — all workspaces pass (web, api, control-plane)
- ✅ `npm test` — 52 tests pass, 0 failures (all suites including control-plane app + registry integration tests)
- ✅ `docker build --file docker/control-plane/Dockerfile` — control-plane image builds successfully
- ✅ Worktree clean, no uncommitted changes, branch up-to-date with origin

**Risk Assessment:**
- No unresolved review threads remain (all 7 marked resolved + collapsed in GitHub API)
- Code changes are minimal and surgical — only extracting duplicate logic, adding security context, and hardening secrets
- No regressions: existing test coverage (52 tests including readiness probes, registry schema migration, subdomain reservation) all pass
- Manifest changes follow Kubernetes best practices (tagless base, overlayable image pins, non-root with fsGroup for PVC safety)

**Recommendation:** Ship-safe. All Copilot review feedback is addressed with working code, passing tests, and clean builds. PR #66 is ready to merge once other team gates clear (e.g., Brand's implementation of tenants manifest templates, end-to-end smoke test enhancements — both already tracked in issue #43 QA checklist).

