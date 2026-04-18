# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Brand initialized as Platform Dev for the initial project squad.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
📌 Team update (2026-04-11T19:27:38Z): GitHub Actions in all workflows pinned to commit SHAs; decision merged to team decisions log — Brand
📌 Team update (2026-04-17T23:10:03Z): copilot_yolo GitHub CLI integration complete (install `gh`, auth fallback, auth enforcement). Three decisions consolidated to team decisions.md — Brand

## Learnings

- **PR #60 reround cleanup (2026-04-19):** In Copilot rereviews, classify against the branch's *current diff to main*, not the stale first-pass patch set. If a `.squad/decisions/inbox/*` comment points at files the branch no longer changes, resolve it as stale/rebased noise instead of reintroducing inbox artifacts just to appease the thread. For same-origin SPA serving, also gate the `index.html` fallback on HTML-accepting, extensionless navigation requests so missing JS/CSS assets stay honest 404s.
- **PR #60 container follow-ups (2026-04-19):** Keep tenant readiness probes cheap (`NoteStore.checkHealth()` / `SELECT 1`), scope SPA fallbacks to browser navigation (`GET`/`HEAD`) so bad non-API verbs still 404, and let the runtime image rely on root workspace production deps instead of copying workspace-local `node_modules`. Also document the split between app default `PORT=3001` and container default `PORT=3000`, and only claim SIGTERM draining when the entrypoint actually closes the HTTP server first.
- **Issue #42 remaining-four clarifications (2026-04-19):** Platform recommendation written for the 4 remaining #42 clarification points: (1) state machine — 7 states (provisioning, ready, maintenance, upgrading, restoring, failed, deprovisioned); control-plane DB = desired, K8s = observed; lock now. (2) Version-skew — N-only for Phase 0–1, no N-1 commitment; control plane upgrades first; additive-only migrations; no downgrade support. (3) Local Keycloak — Docker Compose + realm JSON import at `infra/keycloak/`; not Helm, not K8s; realm JSON version-controlled. (4) Auth migration — Phase 2 concern; dual auth with grace period; control-plane admin auth independent (API key in Phase 1); share-links survive without Keycloak login. None of these affect Phase 0 execution. See `.squad/decisions/inbox/brand-42-remaining-four.md`.
- **Issue #42 control-plane ↔ tenant contract (2026-04-18):** Platform recommendation written for the thin control-plane / tenant boundary. Core design: Kubernetes state is the coordination layer; control plane writes K8s resources and calls four tenant endpoints (`/internal/status`, `/internal/bootstrap`, `/internal/maintenance`, `/readyz`). Information flows one direction (control plane → tenant, never the reverse). Backups run against Postgres directly via CronJob, not through the app. Restore orchestration uses maintenance mode to drain, then pg_restore under a running pod. Ingress is wildcard DNS + per-tenant Ingress resource — no per-tenant DNS records. Auth on internal endpoints is network-level (NetworkPolicy) for Phase 1. See `.squad/decisions/inbox/brand-42-tenant-contract.md`.
- **Issue #42 platform sequencing (2026-04-18):** Phase boundaries are locked by data-plane discipline (single-writer SQLite enforcement) and control-plane state machine contract, not feature count. Phase 0 proves rolling updates on k3d/AKS; Phase 1 proves data isolation with multiple tenants; Phase 2 operationalizes Keycloak; Phase 3 measures backup/restore/fleet visibility. 7 cross-cutting decisions (registry, secret backend, ingress, Keycloak ops model, k3d parity, version constraint, enforcement mechanism) must be made before Phase 0 coding starts. See `.squad/decisions/inbox/brand-issue-42-platform.md` for full dependency graph and sequencing.
- **Issue #42 backup/restore strategy (2026-04-18):** Two-layer approach recommended for Phase 1 tenant Postgres backup: (1) Azure Flexible Server managed PITR as fleet safety net (~5 min RPO, 15–30 min RTO), (2) scheduled `pg_dump` per tenant to Azure Blob Storage for surgical single-tenant restore (≤6h RPO, 5–15 min RTO). Single-tenant restore uses pointer-swap in control-plane registry — no pod restart, zero cross-tenant blast radius. Phase 1 automation: CronJob + blob lifecycle + backup catalog table + health check. Defer pgBackRest/WAL archiving/automated restore API to Phase 2+. See `.squad/decisions/inbox/brand-42-backup-restore.md`.
- **Web test entrypoints (2026-04-14):** Keep web CI and local commands rooted in `package.json` with explicit workspace paths (`apps/web`), not shorthand names like `web`; this repo's reliable smoke lane is `npm run test:web:focused` and the full workspace suite remains `npm run test:web`.
- **copilot_yolo auth forwarding (2026-04-17):** Keep sandboxed git/commit flow split cleanly: SSH stays brokered via `--mount-rw "$SSH_AUTH_SOCK:/ssh-agent"` plus `SANDBOX_FLAGS="--env SSH_AUTH_SOCK=/ssh-agent"`, while GitHub token auth is opt-in by appending `--env GH_TOKEN` only when the host already exported it.
- **YOLO image tooling (2026-04-17):** Keep sandbox-only binaries in `.copilot_here/docker/Dockerfile`; `scripts/copilot-yolo.sh` already fingerprints that file, so adding Debian's `gh` package triggers the expected image rebuild without changing the wrapper's host-side GH_TOKEN / `gh auth token` auth flow.
- **Worktree Governance (2026-04-13):** Treat `.squad/config.json` as the authoritative worktree path source. When `workTreesFolder` is set, resolve worktrees from repo root; when absent, fall back to sibling-path legacy behavior. This alignment removes ambiguity across governance docs, lifecycle guides, and coordinator templates.
- Treat `.squad/config.json` as the preferred worktree path source of truth: if `workTreesFolder` is set, resolve it from the repo root; if not, document the sibling-path fallback consistently across governance, lifecycle docs, and workflow skills.
- Initial squad setup complete.
- GitHub Actions refs in active `.github/workflows/` files and source `.squad/templates/workflows/` templates need SHA pins for orgs that enforce immutable action references; keep the current major visible with inline comments for maintainability.
- **Squad upgrade workflow audit (2026-04-14):** After `squad upgrade`, treat `.squad/templates/workflows/` as the source of truth for synced squad workflows, then verify `.github/workflows/` only keeps repo-fit automations. For this app, keep `sync-squad-labels`, `squad-triage`, `squad-heartbeat`, `squad-issue-assign`, `squad-label-enforce`, and `web-test`; remove upgrade-added docs/release/preview/insider/test workflows that assume Squad CLI branches, docs, or root `test/*.test.js`.
- Guest account linking now runs through `POST /api/shared/:shareToken/membership/claim`, with the shared-route UI handling register/sign-in plus claim in `apps/web/src/SharedCampaignRoute.tsx`.
- Same-browser guest claims should attach `campaign_memberships.user_id` on the existing guest membership and leave that membership's ID/display name intact so note attribution stays stable across account upgrades.

## 2026-04-13: Issue #28 Handoff Visibility — Repair Complete

**Context:**
Reviewed branch state after rejection reroute to inspect for handoff safety.

**Finding:**
Mikey had already committed the implementation artifact with clear rejection reason (list/detail mismatch blocker) and documented routing. No additional artifact commits needed.

**Learning:**
Rejection-path visibility risk: when a reviewer rejects and the team reroutes before push, the next reviser must dig through logs to find the actual blocker. **Mitigation:** Commit rejected artifacts immediately with clear failure message, push before rerouting. Makes rejection discoverable without additional process overhead.

**Platform action taken:**
Documented handoff integrity check in `.squad/decisions/inbox/brand-issue-28-handoff.md`. Next reviser (@copilot) has public artifact + clear blocker message ready for revision cycle.

## 2026-04-13: Branch Cleanup — PR #37 and Issue #28 Consolidation

**Action:** Consolidated local branches after PR #37 merged to origin/main.

**What I found:**
- Remote main (`e5bb1b6`) contained the squashed PR #37 merge with all tag facets functionality shipped
- Local branches `pr-37-review` and `issue/28-tag-facets-autocomplete` contained full development history plus Scribe consolidation commits (PR #37 approvals from Mikey and Chunk)
- The actual code was already on origin/main; branches diverged due to different squash strategies

**What I did:**
1. Pulled latest origin/main to local main
2. Cherry-picked just the Scribe consolidation commit (`f990862`) from pr-37-review to preserve team decision records
3. Deleted both local branches (`pr-37-review` and `issue/28-tag-facets-autocomplete`)
4. Pushed main to origin to keep in sync
5. Remote branch `issue/28-tag-facets-autocomplete` was already deleted by remote prune

**Rationale:**
- Avoided merging full development history into main (which would have added 13 commits of intermediate work)
- Preserved important team metadata (Mikey lead approval, Chunk QA approval) via single cherry-picked commit
- Clean main history: only shipped functionality + team decisions, no development trail noise
- Branches fully deleted locally and remotely to eliminate confusion

**Key insight for future:** When PR is merged via GitHub squash, local feature branches with full history should not be merged back—cherry-pick only the metadata/decision consolidation commits if needed. This keeps main clean while preserving team records.

## 2026-04-13: Squad Worktrees in Dedicated Folder

**Requestor:** FFMikha  
**Task:** Set up squad worktrees under `.worktrees/` folder instead of sibling folders at repo parent

**Implementation:**
1. Updated `.squad/config.json` with `worktrees: true` and `workTreesFolder: ".worktrees"`
2. Added `.worktrees/` to `.gitignore` to keep runtime state out of version control
3. Created `.squad/docs/worktree-setup.md` with comprehensive guide covering:
   - Configuration explanation
   - Folder structure and organization
   - Usage for squad members and manual operations
   - Rationale for the design

**What it delivers:**
- All issue worktrees now organized under `repo-root/.worktrees/{issue-number}`
- Clean workspace — no sibling `dnd-notes-42` folders
- Project-level configuration — no ephemeral shell-only setup
- Example: Issue #42 worktree at `.worktrees/42/` instead of `../dnd-notes-42`

**How it works:**
- Coordinator parses `.squad/config.json` and reads `workTreesFolder: ".worktrees"`
- When creating worktrees, Coordinator uses this path instead of default sibling behavior
- Git itself has no path restrictions, so arbitrary relative or absolute paths work
- `node_modules` symlink from worktree to main repo still works (Unix: `ln -s ../../node_modules`)

**Limitation & follow-up:**
- The `workTreesFolder` key is a team convention. Full automation depends on Coordinator implementation parsing the config and applying it during `Pre-Spawn: Worktree Setup`
- Current squad.agent.md template describes sibling-folder default behavior
- **Next step if needed:** If Coordinator doesn't yet parse `workTreesFolder`, team should test and confirm behavior, then update squad agent template path calculation logic if required
- Documented in `.squad/decisions/inbox/brand-worktree-setup.md` with exact follow-up steps

---

**2026-04-13T13:26:28Z — Scribe Session:** Task completed. Decision merged to `.squad/decisions.md`. Orchestration and session logs created.

## 2026-04-14: Squad Upgrade Cleanup — Orchestration Dispatch

**Requested by:** FFMikha  
**Type:** Background agent spawn

**Work delegated to Brand:**
- Audit `.github/workflows/` post-squad-upgrade for floating-tag refs and repo topology fit
- Restore SHA pinning on kept workflows (sync-squad-labels, squad-triage, squad-heartbeat, squad-issue-assign, squad-label-enforce, web-test)
- Remove upgrade-added workflows that target different repo structure
- Validate with `npm run lint`, `npm run build`, `npm test`

**Decisions created:**
- `brand-fix-upgrade-pinning.md`: Post-upgrade workflow audit strategy documented
- `brand-web-test-infra.md`: Web CI fixed via root workspace scripts + focused smoke lane

**Scribe actions:**
- Orchestration log written: `.squad/orchestration-log/2026-04-14T15-52-31Z-brand-upgrade-cleanup.md`
- Session log written: `.squad/log/2026-04-14T15-52-31Z-upgrade-cleanup.md`
- Decision inbox merged to `.squad/decisions.md`

📌 Team update (2026-04-14T15:52:31Z): Squad upgrade cleanup delegated to Brand; workflows pinning and repo-fit audit underway — Scribe

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

