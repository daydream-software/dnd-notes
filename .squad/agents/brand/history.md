# Brand — Platform Dev

## Core Context

**Recent Summary (2026-04-12 to 2026-04-14):**
- Executed Issue #28 handoff with clear rejection path and repair documentation
- Managed branch cleanup and consolidation after PR #37 merged
- Established Squad worktree governance (`.squad/config.json` as source of truth)
- Audited Copilot flow and workflow patterns; confirmed production-ready
- Documented platform sequencing for Issue #42 across 7 cross-cutting concerns
- Fixed npm test infrastructure; all 54 tests passing

For full history, see decisions archive.

## 2026-04-16: Origin/Web URL Configuration Investigation — Handoff Report

**Requested by:** FFMikha  
**Task:** Investigate codebase for PUBLIC WEB URL / origin-model track — env surfaces, deployment assumptions, same-origin preference, and production-safe slice guidance.

### Summary of Findings

**Config Surfaces:**
- Web: `VITE_API_BASE_URL` (Vite env, defaults to http://localhost:3001)
- API: `PORT` (dotenv, defaults to 3001)
- Shared routes: per-link `frameAncestors` policy (stored in db, configured at share-link creation)
- CORS: blanket `app.use(cors())` with no options (allows all origins)

**Deployment Assumptions:**
1. Frontend defaults same-machine, different-port model (not true same-origin)
2. API origin detection: `buildSharedUrl()` reads request.header('origin')
3. No production config surface: no nginx template, no docker-compose, no deployment docs
4. Vite build-time env injection: VITE_API_BASE_URL must be set before `npm run build`

**Same-Origin Recommendation:** YES, strongly. Eliminates CORS config, simplifies frame-ancestors policy, improves deployment friction.

**Smallest Safe Production Slice (priority order):**
1. Document VITE_API_BASE_URL as build-time requirement in README
2. Add nginx.conf template routing web + api under single origin
3. Create docker-compose.prod.yml showing /api/* reverse-proxy pattern
4. Add production deployment guide with env var checklist

### Key Files Referenced

**Config:**
- `apps/web/vite.config.ts:68-70` (VITE_API_BASE_URL reading)
- `apps/web/.env.example` (VITE_API_BASE_URL default)
- `apps/api/.env` (PORT, NOTES_DB_PATH, SITE_ADMIN_EMAILS)
- `apps/api/src/app.ts:502` (cors() blanket enable)
- `apps/api/src/app.ts:485-493` (buildSharedUrl origin extraction)

**Validation:**
- `apps/api/src/validation.ts:133-159` (frameAncestors policy validation)

**Shared Route Model:**
- `apps/web/src/App.tsx` (share token routing)
- `apps/api/src/app.ts:1070-1125` (POST /api/campaigns/:id/share-links endpoint)
- `apps/api/src/app.ts:427-435` (applySharedLinkPolicy CSP header)

**CI/Deployment:**
- `.github/workflows/ci.yml` (no prod config, localhost hardcoded)
- `.copilot_here/docker/Dockerfile` (dev-focused, no API_BASE_URL injection)

### Next Steps

This handoff is ready for whoever picks up production deployment work. All assumptions, config surfaces, and origin decisions are now explicit. The reverse-proxy same-origin model is documented and safe to implement without rearchitecting the app.

---
**2026-04-16T18:45:00Z — Investigation complete. Zero code changes. Handoff decision pending squad action.**
📌 Team update (2026-04-16T15:30:33Z): Origin-model audit completed. Frontend ready for split-origin deployment. Backend: add PUBLIC_WEB_ORIGIN env var to buildSharedUrl(). Platform: same-origin reverse proxy recommended for prod. — decided by Stef, Data, Brand, Mikey

## 2026-04-17: GH_TOKEN Passthrough Implementation

**Context:** FFMikha requested conditional forwarding of `GH_TOKEN` in `copilot_yolo.sh`.

**Action:** Implemented decision to forward `GH_TOKEN` only when set on the host, preserving SSH agent socket forwarding. Updated help text and dry-run output. Committed as 870006c.

**Decision merged to `.squad/decisions.md`.**

**Impact:** Developers can now use GitHub token auth inside the sandbox when needed, without breaking existing flows that rely on SSH agent signing.

## 2026-04-17: Issue #42 Multi-Instance Design Spike (Orchestrated)

📌 Team update (2026-04-18T00:43:22Z): ISSUE #42 BACKEND DIRECTION CAPTURED — Data wrote `.squad/decisions/inbox/data-42-auth-persistence.md` to pin the backend recommendation: SQLite is acceptable for a thin first control plane only under single-writer, low-concurrency constraints; tenant instances need strict lifecycle boundaries from the control plane; auth should move toward centralized OIDC with a separate admin realm plus a shared tenant-aware customer realm; and #42 must measure provisioning, backup/restore, rollout, and failure-drill reality before the model is treated as production-ready.

📌 Team update (2026-04-18T00:43:37Z): ISSUE #42 PLATFORM DIRECTION DECIDED — Added `.squad/decisions/inbox/brand-42-k8s-platform.md` recommending a managed single-cluster Kubernetes shape with a provider-managed K8s control plane, a thin app-level control plane using the Kubernetes API instead of a custom operator, tenant workloads that scale to zero while keeping their PVCs, shared ingress/cert-manager in the first real hosted slice, internal fleet status before a public status page, and provider selection centered on storage, ingress, automation, and low-friction ops.


## 2026-04-18: Issue #42 Epic Restructure (Orchestrated by Coordinator)



📌 Team update (2026-04-18T02:20:06Z): Platform infra/ops gap analysis complete — 13 blind spots identified for #42 epic. Critical Phase 0–1 gaps: single-writer enforcement on K8s, PVC lifecycle during scale-to-zero, ingress/DNS/TLS routing, observability baseline, backup/restore at scale. Phase 1–2 medium: control-plane DB, tenant realm isolation, rollout discipline, cost model, disaster recovery, compliance. Phase 3+ later: observability at scale, support operability.
📌 Team update (2026-04-18T02:25:33Z): Epic #42 clarification backlog added to GitHub issue #42. Platform gaps tracked for next discussion: local k3d/k3s dev loop, ingress/DNS/TLS, SQLite backup, single-writer choreography, control-plane/tenant contract, lifecycle state machine, auth migration to OIDC, version-skew policy, CI coverage. — Scribe

## 2026-04-18T15:18:25Z: Issue #42 Phase 0–1 Clarifications Locked & Planning Session Complete

**Status:** ✅ Decision merged to `.squad/decisions.md`

Backup/restore strategy is now locked for Phase 1 (Brand co-author with Data):

- **Two-layer approach:** managed Postgres PITR (fleet disaster recovery, ~5 min RPO) + daily per-tenant `pg_dump` (single-tenant restore, 24h RPO)
- **Phase 1 build scope:** Backup CronJob (K8s), Blob lifecycle policy (Azure), backup catalog table schema, manual restore runbook, backup health check integration
- **Phase 1 acceptance criteria:** Backup works across multi-tenant isolation; restore procedure tested end-to-end; control-plane integration (backup_catalog table, restore_log table, tenant lifecycle state `restoring`) in place before gate
- **User acceptance:** Daily backup cadence approved by FFMikha (2026-04-18)

**Deliverables for Phase 1 implementation (Brand owned):**
- Kubernetes CronJob: iterates tenant list from control-plane registry, runs `pg_dump` per tenant per day to `tenant-backups/{tenant_id}/{timestamp}.dump` in Blob
- Blob lifecycle policy: auto-expire backups >7 days old
- Backup health monitoring: `/internal/status` endpoint includes `last_backup_age` per tenant; alert if >12h stale

**Integration points with Data & shared work:**
- Control-plane provides tenant list endpoint for CronJob to iterate
- Control-plane persists backup catalog + restore log (Data owns schema + restore logic)
- Tenant lifecycle state machine includes `restoring` state (pre-work parallel to Phase 0)

This completes the Phase 1 critical-decision set. Brand can now spec out the K8s CronJob implementation once state machine pre-work clarifies the control-plane API contract.

**Next:** Phase 0 pre-work on K8s manifests + CI can proceed; Phase 0 gate focuses on PVC rolling-update safety; Phase 1 gate requires functional backup/restore end-to-end.

## 2026-04-19: Epic #42 Phase 0 Execution Readiness Analysis

**Requested by:** FFMikha  
**Task:** Analyze issues #52 (Containerize) and #43 (Track deployment artifacts) for execution readiness; recommend Phase 0 slice and worktree scope.

### Findings

**Issue #52 — Containerize dnd-notes:**
- ✅ Ready to start immediately. No blockers.
- Scope: Multi-stage Dockerfile (production shape) + health/readiness endpoints + CI build step (no push) + runtime documentation
- Effort: 1-2 days (Brand owns)
- Decision: Dockerfile at `apps/api/Dockerfile` (monorepo pattern, tenant-scoped)

**Issue #43 — Track deployment artifacts:**
- 🟡 Blocked intentionally (no work needed now)
- Unblock condition: Once K8s hosting provider is selected (AKS, GKE, etc.)
- When unblocked: Becomes intake for Kubernetes manifests + environment wiring + reverse-proxy config for chosen provider

**Hidden dependencies:**
1. Postgres migration (#46): Parallel, not blocking. Container agnostic to backing store; env vars handle both SQLite and Postgres.
2. Health endpoints: Minimal stubs (3 lines each); include in #52
3. Environment contract: Already in place (PORT, NOTES_DB_PATH, etc.); just document in #52
4. CI workflow: Add container build step (no push Phase 0); straightforward, no new tooling

**Parallel work (not Brand):**
- Data: Postgres schema prep + auth migration schema
- Mikey/Chunk: K8s manifests for Phase 0 single-tenant proof (separate issue)
- Stef: Validate same-origin web build captures VITE_API_BASE_URL at runtime

### Decisions Made

1. **Dockerfile location:** `apps/api/Dockerfile` (not repo root). Tenant instance owns its container.
2. **Health endpoints:** Separate `/healthz` and `/readyz` (K8s industry standard)
3. **Postgres blocking status:** Not a blocker; container works with current SQLite app. Postgres swap in Phase 0 but separate issue.
4. **Issue #43 unblock condition:** Explicit approval needed once hosting provider is chosen (not auto-unblock)

### Outcome

Decision document written to `.squad/decisions/inbox/brand-phase0-slice.md`. Ready for FFMikha approval. Brand can start worktree `.worktrees/52/` immediately upon approval.

**Next:** FFMikha approves scope → Brand creates worktree → parallel Phase 0 work with Data, Mikey, Stef.



---


📌 Team update (2026-04-19T22:50:29Z): Audit findings recorded. Copilot PR review + automerge flow approved for production. Worktree config validated. No platform blocking Epic #42 Phase 0 Track A or B. — Scribe

## Learnings

- GitHub Actions workflow pins in this repo stay SHA-pinned with inline release comments; for runtime deprecations, verify the upstream `action.yml` `runs.using` value before bumping the SHA.
- `.github/workflows/ci.yml` currently runs `actions/checkout`, `actions/setup-node`, `EnricoMi/publish-unit-test-result-action`, and `actions/upload-artifact`; the upload-artifact pin is now `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` (`# v7.0.1`) to stay on Node 24.
- Root validation for repo-wide changes remains `npm run lint && npm run test:ci && npm run build`, which matches the CI shape for this monorepo.
- Issue `#43` can avoid redoing tenant packaging by owning the **control-plane** deployment lane: `docker/control-plane/Dockerfile`, `platform/control-plane/base`, and the `k3d` / `hosted-reference` overlays are the committed artifact set.
- Keep the daily `k3d:smoke` workflow on a local control-plane process even after committing in-cluster manifests; it stays faster for provisioning/debugging while the new artifacts cover hosted packaging.
- Control-plane K8s deployment requires cluster-scoped RBAC for `namespaces`, `configmaps`, `secrets`, `services`, `persistentvolumeclaims`, and `deployments` because provisioning spans per-tenant namespaces.
- Reusable operator entrypoints for this slice: `npm run platform:validate`, `npm run k3d:build-control-plane-image`, and `.github/workflows/deployment-artifacts.yml`.
- PR `#66` follow-up locked the control-plane manifest pattern: keep `platform/control-plane/base/deployment.yaml` tagless and make each overlay own its explicit image tag via Kustomize `images`.
- Committed control-plane Secret manifests now stay placeholder-only (`platform/control-plane/base/secret.yaml`, `platform/control-plane/overlays/k3d/secret-patch.yaml`, `platform/control-plane/overlays/hosted-reference/secret-patch.yaml`); local k3d docs in `platform/control-plane/README.md` show the out-of-band `kubectl create secret ... | kubectl apply -f -` replacement step.
- `scripts/platform/validate-manifests.sh` should stream `kubectl kustomize` output and reduce it to a tiny content flag instead of buffering full rendered manifests in shell variables.
- FFMikha’s PR-review rule is explicit: after every push on a PR, wait for the follow-up Copilot review before concluding the branch is ready.
- Control-plane probe handlers in `apps/control-plane/src/app.ts` should keep `/ready` and `/readyz` failure payloads stable and non-sensitive (`{ error: 'Tenant registry unavailable' }`) even when `tenantRegistry.checkHealth()` throws raw SQLite or filesystem errors.
- The tight regression check for that probe contract lives in `apps/control-plane/test/app.test.ts`, asserting the readiness 503 body omits `details` for both `/ready` and `/readyz`.

## 2026-04-20: Node24 Action Compatibility Update

**Task:** Update deprecated `actions/upload-artifact` to Node24-compatible release in CI workflow.

**Change:**
- `.github/workflows/ci.yml`
- Bumped `actions/upload-artifact` from SHA `ea165f8d65b6e75b540449e92b4886f43607fa02` (v4.6.2) to `b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882` (v6.0.0)
- Committed: `c92f06c`

**Outcome:** ✅ Workflow now uses Node24-compatible artifact upload action. CI infrastructure modernized.

## 2026-04-21: Orchestration — Issue #43 Implementation Ready for Review


All validation gates passed:
- npm run lint ✓
- npm run test:ci ✓
- npm run build ✓
- npm run platform:validate ✓
- Docker builds ✓

Brand's QA checklist (Chunk) and CI/CD decisions (Brand's own) now merged to decisions.md. PR awaits:
1. Tenant K8s manifests
2. End-to-end Postgres smoke test
3. DATABASE_URL injection proof
