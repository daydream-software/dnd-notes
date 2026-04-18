# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Brand initialized as Platform Dev for the initial project squad.


## Core Context

*History summarized on 2026-04-18T22:58:15.115540 — old entries moved to archive. Keeping last 10 team updates and all learnings.*


## Recent Updates (Last 10)

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
📌 Team update (2026-04-11T19:27:38Z): GitHub Actions in all workflows pinned to commit SHAs; decision merged to team decisions log — Brand
📌 Team update (2026-04-17T23:10:03Z): copilot_yolo GitHub CLI integration complete (install `gh`, auth fallback, auth enforcement). Three decisions consolidated to team decisions.md — Brand

## Learnings

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

*73 older learning items archived.*
