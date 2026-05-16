# Brand — Platform Dev

## Core Context (Summarized 2026-04-26T15:45:50Z)

Brand is the Platform Dev responsible for infrastructure, Kubernetes orchestration, deployment artifacts, and platform-layer integrations. Maintains the k3d local dev environment, control-plane manifests, Docker builds, and platform-layer contract documentation (RUNTIME.md).

**Key Pattern:** Infrastructure-first approach — lock platform topology and deployment contracts before application code churn.

**Historical Work (2026-04-11 to 2026-04-22):**
- Executed Issue #28 handoff and branch cleanup; conducted deployment config audit; recommended same-origin reverse proxy
- Co-authored Issue #42 platform direction: managed K8s, scale-to-zero with PVC retention, shared ingress/cert-manager
- Led backup/restore strategy (two-layer: managed PITR + per-tenant pg_dump) with Data co-authorship
- Consolidated Phase 0–1 decisions, published QA brief, diagnosed npm test infrastructure
- Produced Dockerfile multi-stage build, RUNTIME.md environment contract, platform K8s manifests (postgres.yaml, k3d bootstrap)

**Recent Skills Documented:**
- `filesystem-safe-path-components`: Deterministic MD5-hash-based path suffixes for case-insensitive filesystems (macOS HFS+, Windows NTFS)
- `postgres-null-parameter-casts`: Explicit casting for nullable Postgres placeholders across branching logic
- `smoke-harness-failure-artifacts`: Preserved workdir capture and filtered error output for CI-only failures
- `control-plane-unknown-error-strings`: Trim and collapse whitespace-only strings to `Unknown error`
- `local-override-vs-pod-network-auth`: Override scripts treat pod-scoped URLs (*.svc) separately from host-side fallbacks
- `post-merge-orphan-recovery`: Fast-forward main, cherry-pick missing commits for post-merge docs

## Recent Updates

📌 **Team update (2026-04-26T21:37:02Z):** PR #120 review fixes completed and approved — Brand fixed status.sh HTTP probe, read_state() clearing, read_state_field() non-blocking behavior, and updated PR description. Chunk performed final reviewer pass and approved. Commit: 18101a1. Ready for merge and CI bookkeeping. — Brand, Chunk






📌 Team update (2026-04-27T16:12:05Z): PR #120 final review resolution complete. Brand addressed last two open Copilot review threads: removed unused `STATE_DIR` from scripts/k3d/status.sh, updated scripts/k3d/down.sh help text for accurate teardown behavior description. Patch committed and pushed (7d2d7fc). Mikey gated the patch, confirmed on PR head, posted targeted replies closing both threads. No open review threads remain. Two decisions merged: brand-final-review-fixes.md, mikey-final-review-gate.md. Session log: `.squad/log/2026-04-27T16:12:05Z-pr120-review-closure.md`. — Scribe

📌 Team update (2026-05-09): PR #169 CI smoke unblocked + CodeRabbit review addressed — Brand wired CAROOT in CI workflow (mkcert install step, `$RUNNER_TEMP/mkcert-ca`, `TRUST_STORES=""`), added `validate_ingress_ports` to bootstrap.sh rejecting non-80/443 at both env-var and live Docker port-mapping level. 5 CodeRabbit threads resolved. Commit: 4ddecf6. Decisions logged: k3d port constraint + CI CAROOT wiring. Session log: `.squad/sessions/2026-05-09-pr169-ci-smoke-coderabbit-fixes.md`. — Scribe

📌 Team update (2026-05-09): PR #169 follow-up — NODE_EXTRA_CA_CERTS gap in smoke.sh — After 4ddecf6, CI smoke passed validate_caroot but got HTTP 401 on POST /internal/tenants (Node process trusting mkcert CA). One-line fix in smoke.sh control-plane env block (commit 4262aa8, same pattern as *-override.sh scripts). CI smoke green: run 25601345615, pass at 6m26s. — Scribe

## Learnings

- **PR #120 k3d Review Fixes (2026-04-27):** In `scripts/k3d/status.sh`, parse `.k3d-state/state.json` once in Node and emit a NUL-delimited payload plus a success sentinel before assigning any `state_*` shell vars; that keeps the documented “all empty on failure” contract true even when the parser dies mid-stream. In `scripts/k3d/down.sh`, namespace teardown for `--keep-cluster` should use `kubectl delete namespace ... --wait=false --timeout=30s` so stuck finalizers do not hang the helper forever. Regression anchor: `apps/control-plane/test/k3d-persistent-lane.test.ts`. User preference: do not use `claude-opus-4.7` without asking first.

- **PR #120 Validate Triage:** When a PR shows multiple checks named `validate`, use the workflow name before assuming they cover the same gate. On PR #120, CI `validate` failed deterministically on `apps/control-plane/test/k3d-persistent-lane.test.ts` (`no-useless-escape` on the new `tokenSnippets` fixture) while Deployment Artifacts `validate` passed on the same SHA, so the fix was to remove the unnecessary JavaScript quote escapes rather than treating the red check as transient.

- **Shell JSON State Readers:** For contributor-facing Bash helpers that already require Node, do not capture a whole JSON file into a shell variable and feed it back through `process.argv[1]`. Parse the file directly in Node for each requested field (or in one Node process) so embedded `\\\"` sequences like the `tokenSnippets` in `.k3d-state/state.json` survive unchanged; lock it with a focused shell-level regression in `apps/control-plane/test/k3d-persistent-lane.test.ts`.

- **Backup Artifact Path Components:** When a filesystem-backed backup store derives directory/file names from tenant-controlled IDs, normalize with `NFKC` before sanitizing for readability, but hash the raw ID whenever normalization, sanitization, or case-folding changes the component. That keeps lowercase-safe IDs readable while preventing cross-tenant collisions on case-insensitive or Unicode-normalizing filesystems. Lock it with regressions for both unsafe-character collisions and case-only collisions in `apps/control-plane/test/tenant-backup-runner.test.ts`.

- **Postgres Nullable Parameter Casts:** Real Postgres can reject nullable placeholders used across `SET`, `CASE`, and `IS NULL` / `IS NOT NULL` branches with `could not determine data type of parameter $N` even when pg-mem stays green. In `apps/control-plane/src/tenant-registry-postgres.ts`, cast the nullable placeholder explicitly (for example `CAST($3 AS TEXT)`) everywhere that branch logic inspects `storage_migration_failure_reason`, and keep a regression that asserts the generated SQL includes those casts.

- **Smoke Harness Failure Artifacts:** When `scripts/k3d/smoke.sh` fails, copy the preserved `.k3d-smoke-work/` contents into `reports/k3d-smoke/live-workdir/` and print grep-filtered control-plane error lines before the raw tail. The workflow artifact upload already collects `reports/k3d-smoke`, so this keeps the full `control-plane.log` and request/response scraps available for CI-only failures instead of truncating the real exception behind a huge tail dump.

- **Control-Plane Unknown Error Strings:** `apps/control-plane/src/error-formatting.ts` should trim string throwables before surfacing them in logs or HTTP details, and whitespace-only strings should collapse to `Unknown error` instead of producing blank diagnostics. Keep the regression in `apps/control-plane/test/error-formatting.test.ts` so future error-handling changes cannot reintroduce empty operator messages.

- **Local Override vs Pod-Network Auth Config:** For `scripts/k3d/tenant-api-override.sh`, treat `KEYCLOAK_JWKS_URL` from the tenant runtime ConfigMap as pod-scoped only when it points at `*.svc` / `*.svc.cluster.local`. The host-side `apps/api` override must clear that value and rely on the built-in `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs` fallback instead. Key files: `scripts/k3d/tenant-api-override.sh`, `apps/api/src/index.ts`, `apps/api/src/keycloak-auth.ts`, `platform/k3d/README.md`, `RUNTIME.md`.

- **Post-Merge Orphan Recovery:** If a PR branch has a local-only follow-up docs/decision commit after the PR is already merged, recover it from `main` by fast-forwarding `main`, cherry-picking the missing commit, and pushing only the new recovery commit. Do not rewrite the merged branch or touch unrelated worktrees. Key paths: `.squad/decisions.md`, `.squad/agents/brand/history.md`; current example: recovered `9cccb60` from `squad/79-k3d-full-stack-smoke-live-override` onto `main` as `40c71f0`.

- **Config Surfaces:** Web: `VITE_API_BASE_URL` (Vite env, defaults to http://localhost:3001). API: `PORT` (dotenv, default 3001). Shared routes: per-link `frameAncestors` policy. CORS: blanket allow (no options).

- **Same-Origin Recommendation:** Eliminates CORS config, simplifies frame-ancestors, improves deployment friction. Recommend strongly for production.

- **Production Deployment Slice:** (1) Document VITE_API_BASE_URL as build-time requirement. (2) nginx.conf routing web + api under single origin. (3) docker-compose.prod.yml with /api/* reverse-proxy. (4) Production deployment guide with env checklist.

- **GH_TOKEN Forwarding:** Forward only when set on host; preserves SSH agent socket forwarding. Developer convenience without breaking existing flows.

- **Kubernetes Platform Shape:** Managed single-cluster K8s with provider-managed control plane. Thin app-level control plane using Kubernetes API (no custom operator). Tenant workloads scale to zero while keeping PVCs. Shared ingress/cert-manager in first real hosted slice. Provider selection prioritizes storage, ingress, automation, low-friction ops.

- **Backup/Restore Strategy (Phase 1):** Two-layer approach: managed Postgres PITR (~5 min RPO for fleet DR) + daily per-tenant pg_dump (24h RPO for single-tenant restore). CronJob iterates tenant list, pg_dump per tenant per day to blob storage. Blob lifecycle auto-expires backups >7 days. Health monitoring: /internal/status includes last_backup_age; alert if >12h stale. Control-plane owns backup catalog + restore log schema; tenant lifecycle includes `restoring` state.

- **Phase 0–1 Critical Gaps:** Single-writer enforcement on K8s; PVC lifecycle during scale-to-zero; ingress/DNS/TLS routing; observability baseline; backup/restore at scale. Control-plane DB persistence; tenant realm isolation; rollout discipline; cost model; disaster recovery; compliance.

- **Phase 2 Platform Requirements:** (1) Keycloak bootstrap present in k3d (scripts/k3d/bootstrap.sh, platform/k3d/keycloak.yaml) but lacks control-plane ↔ Keycloak token validation + realm setup logic. (2) Per-tenant Postgres role strategy critical for #69: currently all tenants share TENANT_DATABASE_RUNTIME_URL; Phase 2b must split to per-tenant role (CREATE ROLE tenant_<id>_<subdomain> WITH PASSWORD, grant CONNECT + USAGE only), update buildTenantInfrastructureBundle to pass per-tenant secret material, remove shared secret reference from tenant Deployment. (3) Control-plane RBAC already includes create/patch/delete on Secrets (clusterrole.yaml lines 15–16); no networking gaps. (4) k3d-smoke validates provisioning + /ready but misses: Keycloak realm/client presence, per-tenant role privilege constraints, environment isolation. (5) CI coverage: lint/test/build complete; add per-tenant role creation + deprovisioning tests to control-plane suite. (6) Secrets strategy: keep K8s Secrets for Phase 2 start (lowest friction); defer Sealed Secrets/Vault to Phase 2+. (7) Rollout dependencies: #69 (per-tenant roles) does NOT depend on #56 (Keycloak); can land in parallel after Phase 2a Keycloak foundational work. (8) Docs: add LOCAL_DEV_KEYCLOAK.md, append "Phase 2 Secrets Management" section to RUNTIME.md, update apps/control-plane/README.md with per-tenant role provisioning design.

- **Issue #43 QA Checkers (5 critical):** (1) Manifest/runtime mismatch — full K8s manifests for tenant provisioning missing. (2) Workflow drift — k3d-smoke validates only readiness, not CRUD. (3) Postgres env wiring — DATABASE_URL not tested end-to-end. (4) SPA fallback safety — no regression tests for missing routes or XHR. (5) Same-origin default enforcement — ALLOWED_ORIGINS doesn't accidentally split origins.

- **npm Test Infrastructure:** Root npm install is prerequisite for workspace test fanning to succeed. CI should explicitly `npm install` at root before running workspace tests.

- **Phase 0 Gate Readiness:** Approves Dockerfile multi-stage, RUNTIME.md env contract, postgres.yaml K8s manifest, platform scripts (k3d bootstrap, smoke validation). No production secrets in manifests. Validation path: lint → test → build → platform:validate → k3d-smoke.

- **Deployment Artifacts Delivered (Phase 0):** Dockerfile (multi-stage: base → deps → build → runtime, non-root appuser, SQLite fallback), RUNTIME.md (env contract, probes, graceful shutdown, same-origin), CI yaml (lint → test → build pipeline), k3d smoke (k3s v1.35.3, tenant image build, provisioning validation), k3d bootstrap scripts, postgres.yaml (5Gi PVC, pg_isready probe, dev-only secrets).

- **False-Green Trap in k3d-smoke:** Validates tenant provisioning + /ready probes but does NOT create/read actual notes. Smoke depth is shallow; future gates should call this out explicitly.

- **Keycloak Runtime Auth Config Strategy (Issue #76):** Adopt sealed-in-manifest approach for k3d Keycloak clients + secrets (checked-in realm JSON with dev-only credentials). Control-plane overlays carry AuthMode enum (local|keycloak) with per-environment ConfigMap/Secret patches. Tenants receive per-pod KEYCLOAK_* env vars injected by control-plane during provisioning (not in base Secret). Backward compat: AUTH_MODE=local continues as default (no breaking changes); old session tokens work until re-login. Guest/share-link flows bypass auth entirely (local+anonymous regardless of mode). Phase 2 can migrate to Keycloak-backed owner-account auto-creation or explicit seeding; Phase 1 assumes pre-seeded owner_accounts with keycloak_sub values.

- **Keycloak Email-Collision Reconciliation:** If a subject-linked Keycloak owner later presents an email already held by another local account, keep the linked account’s persisted email and derived admin flag instead of clobbering the unique column. Regression should prove the bearer-token flow still reaches tenant campaigns while owner-only admin routes stay denied unless the local row itself is privileged.

- **Smoke Script Bash Portability:** `scripts/k3d/smoke.sh` now treats `inherit_errexit` as a Bash 4.4+ enhancement, not a hard requirement. Guard Bash-only safety upgrades with explicit `BASH_VERSINFO` checks so macOS's stock Bash 3.2 can still run contributor-facing smoke/help flows while newer shells keep the stricter behavior.

- **Shell JSON Payloads in Smoke Lanes:** In contributor-facing shell smoke scripts that already require Node, build JSON request bodies with `JSON.stringify(...)` rather than hand-escaped `printf` strings. This keeps curl payloads valid when values change and avoids review churn around shell quoting. Current example: `scripts/k3d/smoke.sh` tenant create payload.

📌 Team update (2026-04-22T15:44:09Z): PR #77 JSON payload follow-up complete. Brand replaced manual tenant-create payload construction with Node JSON.stringify in scripts/k3d/smoke.sh; Chunk added regression coverage in apps/control-plane/test/k3d-smoke-payload.test.ts validating emitted JSON before live smoke run; all gates green (lint/test/build/platform:validate). Two decisions merged to squad/decisions.md. Session log: `.squad/log/2026-04-22T15:44:09Z-pr77-json-fix.md`. — Scribe

- **Epic #87 Platform Validation (2026-04-26):** Completed read-only platform validation of epic #87 criterion 3 (shared keycloak-jwt module) and criterion 6 (Postgres migration framework). **Criterion 3 PASS**: `platform/keycloak-jwt` exists as workspace module, exports `verifyToken` and JWT primitives, consumed by both apps/api and apps/control-plane via workspace dependency wiring, zero jwks-rsa or duplicated JWT verification logic remaining in either app (confirmed via grep). **Criterion 6 PASS**: Postgres migration framework uses umzug 3.8.2 via `packages/postgres-migrations`, both control-plane and tenant API schemas use it with namespaced ledger tables (`schema_migrations_control_plane`, `schema_migrations_tenant_api`), advisory-lock concurrency guards per service, ordered migration files present (control-plane: 3 migrations, tenant-api: 1 baseline), npm scripts `db:migrate` + `db:migrate:prod` present in both apps, k3d-smoke workflow validates provisioning end-to-end but does not explicitly run migrations in CI (migrations run during control-plane boot and tenant provisioning). No blocking gaps identified; both items ready for #87 closure. Validation report delivered to requester.

- **PR Hygiene for Runtime Squad Artifacts:** `.squad/log/` and `.squad/orchestration-log/` are runtime-state paths already ignored in `.gitignore`, so if a branch accidentally tracks one of those files, fix the PR by deleting only the stray log artifacts and leave durable tracked coordination files alone. Current example: PR #78 cleanup removed `.squad/log/2026-04-22T17:38:00Z-issue68-rollout-failure-hardening.md` and `.squad/orchestration-log/2026-04-22T17:38:00Z-data.md` while preserving `.squad/identity/now.md` and inbox directives.

- **CI Duplicate-Check Triage:** `.github/workflows/ci.yml` runs `npm run test:ci`, publishes JUnit via EnricoMi as a separate `Test Results` check, then fails the `validate` job if any suite failed. On PR #78, red `validate` + red `Test Results` mapped to one underlying control-plane test (`apps/control-plane/test/provisioning.test.ts` namespace-deletion wait) rather than two independent failures. When the head commit only touches docs and the prior branch SHA was green, treat this pattern as a flaky/timing-sensitive repo test first, not an Actions outage. Key files: `.github/workflows/ci.yml`, `scripts/run-ci-tests.mjs`, `apps/control-plane/test/provisioning.test.ts`, `apps/control-plane/src/provisioning.ts`.

- **Operator Portal Unexpected POST Mocks:** In `apps/operator-portal/src/OperatorPortal.actions.test.tsx`, any fetch mock branch that records a write request expected not to happen should still return an explicit error `Response` (500 is fine) after pushing the request. That keeps accidental calls diagnosable as HTTP failures instead of letting `fetch()` resolve to `undefined` and crash later with ambiguous property-access errors.

- **CI-Safe Namespace Polling Tests:** For control-plane deletion tests that model repeated namespace reads before a terminal 404, keep the fake countdown/assertions and widen the explicit timeout budget instead of rewriting production polling. The current stable shape is `namespaceReadCountdown = 2`, `readyPollIntervalMs = 1`, and `deleteTimeoutMs = 200` in `apps/control-plane/test/provisioning.test.ts`, which preserves the namespace-termination intent while absorbing CI scheduler variance. Key files: `apps/control-plane/test/provisioning.test.ts`, `apps/control-plane/src/provisioning.ts`.

- **Shared Operator Portal Base-Path Normalization:** Keep `VITE_OPERATOR_API_BASE_PATH` normalization in `apps/operator-portal/src/base-path.ts` and reuse it from both `apps/operator-portal/vite.config.ts` and `apps/operator-portal/src/config.ts`. A focused regression in `apps/operator-portal/src/base-path.test.ts` should lock the blank/root/trailing-slash cases so the dev proxy and runtime config cannot drift.

- **Node-Only Script Type Boundaries:** Keep the root `scripts` TypeScript project Node-scoped (`types: ["node"]`) even when a smoke harness spins up JSDOM. For cross-workspace browser helpers like `scripts/k3d/operator-portal-smoke.ts`, prefer local loose browser-ish types plus a runtime `import()` of the TSX helper instead of widening the root tsconfig to DOM/JSX or pulling another workspace under `rootDir`. Pair that with a direct root `@types/jsdom` devDependency because the script owns the `jsdom` import even if npm hoists the runtime package from `apps/operator-portal`.

- **Override-Safe State Cleanup:** For shell lanes with overrideable state-file paths like `K3D_STATE_FILE`, delete the file itself with `rm -f "${STATE_FILE}"` and only remove the default repo-owned state directory after an exact path check plus `rmdir`. Never `rm -rf "$(dirname "${STATE_FILE}")"` because an override can point at an unrelated parent directory. Key files: `scripts/k3d/down.sh`, `apps/control-plane/test/k3d-persistent-lane.test.ts`.

- **Optional kubectl Context Capture:** In contributor-facing Bash helpers, treat “restore previous kube context” as best-effort setup, not a hard prerequisite. Guard the initial `kubectl config current-context` lookup with `command -v kubectl >/dev/null 2>&1` so missing kubectl does not emit noisy startup errors before the script reaches its real prerequisite checks. Key file: `scripts/k3d/up.sh`.

- **Backup Restore Guardrails:** For `apps/control-plane/src/tenant-backup-runner.ts`, a restore flow that refuses active sessions must check `pg_stat_activity` both before the safety snapshot and immediately before `pg_restore`; the snapshot window otherwise reintroduces a TOCTOU gap. Treat the filesystem artifact store as hostile input too: reject symlinks on every path segment for both stored tenant directories and inbound artifact locations, and make `scripts/k3d/smoke.sh` print non-2xx response bodies so CI failures surface the real control-plane error instead of only a log tail.

- **Optional Tool Guards for k3d Helpers:** In contributor-facing k3d scripts, treat tools used only for diagnostics or best-effort state parsing as optional guards instead of hard prerequisites. `scripts/k3d/status.sh` now skips the `/ready` curl probe when curl is absent, and `scripts/k3d/down.sh` keeps `--keep-cluster` safe by returning an empty state field when Node is missing or the state file is unreadable; lock both behaviors with focused shell-level regressions in `apps/control-plane/test/k3d-persistent-lane.test.ts`.

- **PR #120 Final Review Fixes:** Keep review-follow-up edits on the persistent k3d helpers as thin as possible: remove truly unused shell state like `STATE_DIR` from `scripts/k3d/status.sh`, and make `scripts/k3d/down.sh --help` describe the real cleanup contract (`.k3d-state/state.json` deletion plus best-effort removal of the default `.k3d-state/` directory only when empty). Focused validation path: `bash -n scripts/k3d/status.sh scripts/k3d/down.sh`, `bash scripts/k3d/down.sh --help`, and `npm run test:control-plane -- --test-name-pattern 'k3d '`.
- **Worktree Cleanup Pattern:** Remove stale worktrees aggressively once their issues are closed. Criteria: (1) associated GitHub issue is CLOSED, (2) worktree directory is clean (build artifacts like node_modules don't block deletion), (3) no active development. Use `git worktree remove <path> --force`, then `git branch -D <branch>` to clean up the local branch, then `git worktree prune` to reclaim refs. Audit via `git issue view <number> --json state` for each issue number extracted from worktree names. Removed 18 stale worktrees representing Phase 2 technical debt work (issues #55–#102) in a single batch cleanup. Decision locked in `.squad/decisions/inbox/brand-worktree-cleanup.md`.

## Orphaned Commit Recovery (2026-04-22T16:35:00Z)

Recovered orphaned local commit `bbbcba8` (docs: merge PR #77 JSON payload decisions and session logs) that existed locally but was not pushed before PR #77 merged. Used non-destructive cherry-pick to safely reapply to main without conflicts, then pushed to origin. Recovery complete: new commit on main is `e8b6b9b`, origin/main now in sync.

**Pattern:** After manual post-merge commits (decision consolidation, log merging), always verify the branch is up-to-date before creating commits. Or use a pre-merge pull hook to block local-only commits on main before PR merge lands.

---



- **Issue #68 first slice:** Use a dedicated `apps/operator-portal/` Vite workspace for the operator UI instead of mixing platform controls into the tenant app. Keep browser API traffic same-origin through `/operator-api` (Vite dev proxy locally, reverse proxy in deployment) and keep the first slice read-only on top of `GET /internal/fleet/status`. Key files: `apps/operator-portal/src/OperatorPortal.tsx`, `apps/operator-portal/src/control-plane-api.ts`, `apps/operator-portal/vite.config.ts`, `apps/operator-portal/.env.example`.

---

## Issue #68 First Operator Portal Slice (2026-04-22T16:51:23Z)

Executed first slice of #68 operator portal feature:
- Built dedicated `apps/operator-portal/` Vite workspace for operator UI (not mixed into tenant app)
- Implemented Keycloak-gated operator authentication using existing `dnd-notes-control-plane` client
- Wired read-only fleet dashboard backed by `GET /internal/fleet/status` control-plane contract
- Configured same-origin `/operator-api` transport (Vite dev proxy locally, reverse proxy in deployment)
- Added comprehensive tests for auth flow and fleet status integration
- Documented operator portal architecture and deployment strategy

**Key decision locked:** Brand/issue68-first-slice.md (Scribe merged to decisions.md)

**Status:** Ready for merge. Follow-up slices (provision/deprovision, lifecycle actions) can build on this scaffold.

## PR #78 CI Diagnosis (2026-04-22T18:59:00Z)

Diagnosed two red checks on PR #78 (CI/validate + Test Results) as a single underlying timing-sensitive test failure in new code. The test `waits for namespace termination before finishing tenant deletion` in `apps/control-plane/test/provisioning.test.ts:1600` was **added in commit bc2cd94** (HEAD of PR #78) and times out at 50ms deadline on CI.

**Exact Error:** 
```
Tenant namespace tenant-t-opaque123456 did not terminate within 50ms
  at KubernetesTenantInfrastructureManager.deleteTenantResources (provisioning.ts:792)
```

**Mechanics:** FakeKubernetesClient is seeded with `namespaceReadCountdown = 2`, so reads return success twice then throw 404 on the third attempt. The test deadline is only 50ms with 1ms poll intervals—this assumes 3 reads + 2 sleeps completes in 50ms. On slow CI runners, async overhead causes this to exceed budget and fail.

**Classification:** NEW flaky test (not pre-existing)—introduced by the new namespace termination validation logic added in PR #78. The test validates the correct behavior but is under-resourced for CI variance.

**Fix Path (Priority):** 
1. **Recommended:** Increase test timeout from 50ms to 200ms (line 1614) — explicit, safe, 4x margin, preserves test intent
2. **Alternative:** Increase poll interval from 1ms to 5ms (line 1613) — also valid, reduces iteration count
3. Avoid: Logic rewrites; risks masking real async bugs

The 200ms fix keeps the test validating K8s namespace polling + async termination semantics while eliminating CI timing variance.

## Post-Merge Recovery (2026-04-23T16:19:10Z)

Recovered orphaned commit `9cccb60` (k3d platform final fixes) after PR #81 squash merge. Pattern: fast-forward main, cherry-pick missing commit, push recovery commit only. Recorded in `.squad/decisions.md` as "Brand — Post-Merge Recovery Pattern" for reuse.

**Commit:** `40c71f0` on main (recovery)  
**Decision:** Locked in decisions.md for future post-merge orphan scenarios

## Issue #97 — Control-Plane Postgres Migration (2026-04-23)

**Context:** Control-plane used better-sqlite3 with PVC-backed SQLite file. Goal was to migrate to shared Postgres instance for stateless control-plane.

**Challenge:** Node.js has no synchronous Postgres client, but TenantRegistry was built around synchronous better-sqlite3 calls. Converting to async required updating 40+ call sites.

**Solution:** Refactored TenantRegistry into a Postgres-only async implementation:
- Moved the control-plane registry entrypoint to a thin re-export of `tenant-registry-postgres.ts`
- Made all TenantRegistry methods async
- Updated Express app to use async/await (app already supported it for provisioning)
- Standardized control-plane runtime on `CONTROL_PLANE_DATABASE_URL`

**Platform changes:**
- Removed control-plane PVC (`pvc.yaml`) and volume mounts from Deployment
- Added CONTROL_PLANE_DATABASE_URL to Secret
- Updated k3d bootstrap to create `control_plane` database in platform-postgres
- Updated full-stack smoke to wire Postgres URL

**Validation:** 
- `npm test --workspace apps/control-plane`: 111/111 pass
- `npm run platform:validate`: pass
- k3d smoke/full-stack flows updated to inject the control-plane Postgres URL

**Key learnings:**
- When migrating storage backends in Node, async conversion is often unavoidable
- Express 5 handles async route handlers naturally - just add `await`
- Platform PVC removal requires corresponding config/secret/bootstrap updates
- The control-plane registry should stay Postgres-only once the PVC-backed runtime is retired

**Files changed:**
- `apps/control-plane/src/tenant-registry*.ts` (Postgres registry + thin entrypoint)
- `apps/control-plane/src/app.ts` (added await to 40+ call sites)
- `platform/control-plane/base/*.yaml` (removed PVC, updated config/secret)
- `scripts/k3d/bootstrap.sh` (create control_plane database)
- `scripts/k3d/full-stack-smoke.sh` (wire CONTROL_PLANE_DATABASE_URL)

## Epic #87 Validation — Item 3 Keycloak-JWT (2026-04-25)

Completed read-only validation of keycloak-jwt consolidation (Epic #87 item 3):

- ✅ Keycloak-jwt extracted to `@dnd-notes/keycloak-jwt` shared module
- ✅ Zero duplication: api + control-plane both import from shared module
- ✅ Token verification consolidated (RS256, JWKS rotation, claim validation)
- ⚠️ **CI gap:** 19 tests exist in `platform/keycloak-jwt/test/*.test.ts` but not in `scripts/run-ci-tests.mjs`

Code consolidation PASS. Tests exist but not wired to CI — security-critical module must be regression-locked. Session: `.squad/log/2026-04-25T22:54:46Z-87-validation.md`.

**P1 Follow-up:** Add to scripts/run-ci-tests.mjs: `{ name: 'keycloak-jwt', script: 'test:ci --workspace platform/keycloak-jwt' }`.

- **PR #120 Review Followup Investigation (2026-04-27):** Investigated unresolved PR review comments and smoke workflow failure (run 24970308939). Found all four review feedback items already addressed in current code: (1) `scripts/k3d/up.sh` lines 156-167 implement `ensure_image_imported_into_cluster()` to import images when `--no-rebuild` skips builds, handling both tenant and control-plane images; (2) `scripts/k3d/up.sh` lines 336-339 set directory permissions to 0o700 and file permissions to 0o600 for `.k3d-state/state.json` to prevent credential exposure; (3) `apps/control-plane/test/k3d-persistent-lane.test.ts` fully refactored to use process-ID-scoped temp directories, never touching real state files; (4) All regression coverage in place. Smoke failure analysis: Run 24970035224 (commit e5d146f) passed, run 24970308939 (commit 86fc630) failed, but 86fc630 only changed `up.sh`, `down.sh`, `status.sh`, and test files—none of which are used by `smoke.sh` (which calls `bootstrap.sh` and `build-tenant-image.sh` directly). Errors (docker socket closed, postgres connection terminated, tenant timeout) indicate transient CI infrastructure issue, not code regression. Posted comprehensive review comment explaining fixes and recommending smoke rerun to confirm transience.

---

## PR #120 k3d Smoke Timeout Fix (2026-04-27)

**Issue:** Smoke test failing in GitHub Actions (job 73216625906, run 25002615780) with "Tenant workload dnd-notes did not become ready within 240000ms" error. All other checks (validate x2, request-review, evaluate-and-merge) passed.

**Root Cause:** The default `TENANT_READY_TIMEOUT_MS` of 240 seconds (4 minutes) was insufficient for tenant deployment to become ready in the GitHub Actions CI environment. CI runners have limited resources, and the k3d cluster + tenant provisioning legitimately takes longer than in local dev environments.

**Timeline from logs:**
- 15:08:47 - Tenant image ready in k3d
- 15:12:54 - HTTP 500 response from control-plane provision endpoint (≈4 min 7 sec later)
- Error: "Failed to provision tenant resources" / "Tenant workload dnd-notes did not become ready within 240000ms"

**Fix:** Added `TENANT_READY_TIMEOUT_MS: '480000'` (8 minutes) to `.github/workflows/k3d-smoke.yml` job environment variables (commit fa3412d). This doubles the timeout to accommodate CI resource constraints while keeping it bounded.

**Key Learnings:**
- k3d/k8s deployments in CI environments consistently take longer than local dev due to resource limits
- The control-plane `apps/control-plane/src/provisioning.ts` uses configurable `TENANT_READY_TIMEOUT_MS` (default 240s) to poll tenant deployment readiness
- Smoke script `scripts/k3d/smoke.sh` line 340 passes this env var to control-plane, making it tunable per environment
- CI-specific timeouts should be set in workflow env vars, not code defaults
- This is not a transient infra failure - it's a legitimate timing constraint that requires adjustment

**Files Changed:**
- `.github/workflows/k3d-smoke.yml` - Added TENANT_READY_TIMEOUT_MS: '480000' to job env

**Validation:** Fix committed and pushed. Smoke workflow will rerun on new commit to verify timeout is sufficient.

---

- **PR #120 Smoke Triage & Review Resolution (2026-04-27T15:23:12Z):** Diagnosed k3d smoke timeout in CI runners (4+ min provisioning on shared resources vs 2 min local). Extended `TENANT_READY_TIMEOUT_MS` from 240000ms to 480000ms in `.github/workflows/ci.yml`, establishing environment-specific timeout pattern (keep app defaults local-friendly, override in workflow). Addressed five new review comments: delete-safety guards in `down.sh` (3 sites), kubectl guard in `up.sh`, namespace config substitution. Landed commit 6cd1545. All 202 tests pass. Orchestration log: `.squad/orchestration-log/2026-04-27T15:23:12Z-brand.md`. Session log: `.squad/log/2026-04-27T15:23:12Z-pr120-smoke-triage.md`. PR ready for merge. — Brand (Agent)

- **Kube-Context-Safe k3d Helpers:** Read-only or scoped cleanup helpers should target `kubectl --context "k3d-${CLUSTER_NAME}"` instead of `kubectl config use-context`. `scripts/k3d/status.sh` and `scripts/k3d/down.sh` now follow that rule so they do not leave the developer pointed at k3d after a status/teardown check; keep the guard locked with source-level assertions in `apps/control-plane/test/k3d-persistent-lane.test.ts`.

- **Token Snippet Assembly Before JSON Write:** When `scripts/k3d/up.sh` persists reusable shell snippets into `.k3d-state/state.json`, build the full snippet string first (`build_token_snippet`) and pass it into the JSON writer as plain argv instead of hand-assembling nested shell quoting inside `node -e`. The focused fake-`curl` regression in `apps/control-plane/test/k3d-persistent-lane.test.ts` proves single/double quotes survive intact.

- **PR #120 Review Thread Resolution (2026-04-27T17:10:21Z):** Orchestrated completion of 4 review threads on README wording, kubectl context guards, and tokenSnippets quoting. Commit b73017f validated and passed focused tests. Orchestration log: `.squad/orchestration-log/20260427-171021-brand.md`. Session log: `.squad/log/20260427-171021-pr120-b73017f-review-closure.md`. — Brand (Agent)


### PR #120 Review Fixes (2026-04-26T22:10:00Z)

Addressed 5 Copilot reviewer comments on persistent k3d deployment lane:

**Key pattern: deferred cluster name resolution**
- Scripts now prefer persisted `clusterName` from `.k3d-state/state.json` unless `K3D_CLUSTER_NAME` explicitly overrides
- `down.sh`: moved cluster name resolution after arg parsing, reads state with `read_state_field()`
- `status.sh`: inline node snippet reads `clusterName` from state before any cluster probes
- `cluster_exists()` now takes cluster name as parameter instead of using global
- **Rationale:** State file is source of truth for what was provisioned; env override still wins if user explicitly sets it

**Lazy tool requirements**
- `down.sh` now requires `kubectl` only for `--keep-cluster` path (soft teardown)
- Full cluster deletion (`k3d cluster delete`) doesn't need kubectl
- Follows existing pattern in `up.sh` of checking tools only when needed

**Test hygiene: non-login shell**
- `k3d-persistent-lane.test.ts`: changed `spawnSync('bash', ['-lc', ...])` to `['-c', ...]`
- Login shell (`-l`) loads profile/bashrc which is unnecessary and slower for inline script snippets
- Non-login shell sufficient when script is self-contained (no dot-sourcing external profile)

**Dead code removal**
- Removed unused `json_get()` helper from `down.sh` (replaced by simpler `read_state_field()` which handles errors gracefully)

**Files touched:** `scripts/k3d/down.sh`, `scripts/k3d/status.sh`, `apps/control-plane/test/k3d-persistent-lane.test.ts`  
**Commit:** f461fe8

---

See **Recent Skills Documented** above for detailed patterns. Key themes:
- Filesystem path normalization and collision prevention (backup naming)
- Database backend migration patterns (async conversion, PVC removal)
- Error handling and platform diagnostics (smoke test artifacts, error string formatting)
- Local dev override isolation (KEYCLOAK_JWKS_URL pod vs host scoping)
- Post-merge recovery procedures for documentation/decision commits

## PR #120 Final Approval (2026-04-26T22:06:15Z)

📌 Team update: PR #120 revision 3 approved by Chunk. Initial false-green regression proof gap resolved by Mikey. Lockout correctly applied after rejection on first author (new bug discovered). Handoff sequence: Brand → Data → Mikey → Chunk completed. All blockers closed. Issue #83 unblocked.

## PR #120 CI Failure & Recovery (2026-04-26T22:36:26Z)

📌 Team update (2026-04-26T22:36:26Z): PR #120 CI failure diagnosed. Root cause: `status.sh` hard-required `k3d`/`kubectl` on runners without these tools. Implemented graceful degradation: return valid JSON with `status:unknown` instead of errors when tools unavailable. Narrow fix scope targets status probes only. Commit: 1a57607. GitHub checks restarted. — Brand, Mikey (triage)

## PR #120 Final Resolution (2026-04-27T00:01:25Z)

📌 Team update (2026-04-27T00:01:25Z): PR #120 final fixes completed. Commit 86fc630 resolved three remaining blockers: image import under `--no-rebuild`, `.k3d-state` owner-only permissions, regression test `K3D_STATE_FILE` isolation. Chunk approved. No hidden regressions. Ready for merge. — Brand, Chunk

## Issue #84 — Portal Containerization (2026-05-04)

- **Vite SPA Containerization**: Designed a single multi-stage Dockerfile that supports building multiple distinct workspaces via `PORTAL_NAME` build arguments. Using `nginx:alpine` and an `/etc/nginx/templates/` reverse proxy config ensures identical base-path routing rules and API proxy logic without requiring complex CORS setups.
- **Runtime SPA Configuration**: Injected runtime variables (`API_BASE_PATH`, Keycloak settings) directly into `/usr/share/nginx/html/env.js` via a custom `/docker-entrypoint.d/40-generate-env.sh` script. This fulfills the `ConfigMap` runtime injection requirement by serving `window.__ENV__` configuration directly to the frontend, preventing image rebuilds for different environments.
- **Keycloak Web Origins**: Replaced wildcards that omitted ports with precise port configurations (`http://*.127.0.0.1.nip.io:8080`) so the `dnd-notes-tenant-app` and `dnd-notes-control-plane` Keycloak clients authorize local k3d portals correctly.

Team update (2026-05-15T15:30:00Z): Node 22 → 24 textual cleanup (#287 → PR #289) — three reference updates (README.md Node.js prerequisite, platform/k3d/README.md version bump, .github/dependabot.yml comment block dropped "runtime stays on Node 22" framing while preserving @kubernetes/client-node@1.x peer-dep rationale). Mikey local APPROVE, CodeRabbit clean. k3d:up rollout symmetry fix (PR #293) — added missing `kubectl rollout restart -n ${tenant_namespace} deployment/dnd-notes` in tenant-reuse path so `npm run k3d:up` on already-up cluster restarts all 4 deployments symmetrically (control-plane, portals, tenant). First commit had `--no-rebuild` guard; follow-up dropped it because `ensure_image_ready` re-imports regardless, creating asymmetry. `k3d:up` is now the official "pick up new code" command. CodeRabbit flagged asymmetry, resolved in follow-up. — decided by coordinator.

