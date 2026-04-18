### Epic #42 Execution Priority — Wave 1 Decision
**Decided by:** Mikey (Lead)
**Date:** 2026-04-19
**Type:** Execution sequencing

## Decision

**Wave 1 (start now, parallel on worktrees):**

| Issue | Owner | Worktree branch | Rationale |
|-------|-------|-----------------|-----------|
| **#52** Containerize dnd-notes | Brand | `squad/52-containerize` | Critical path root. Dockerfile + k3d proof. Zero dependencies. |
| **#53** Control-plane skeleton | Data | `squad/53-control-plane-skeleton` | Independent of #52. New `apps/control-plane` service. CP skeleton + tenant registry schema with 7-state lifecycle model. |

**Wave 2 (wait — blocked on Wave 1):**

| Issue | Blocked on | Notes |
|-------|------------|-------|
| **#43** Deployment artifacts | #52 | Scope needs sharpening — see below. |
| **#54** Provision tenant workloads | #52 + #53 | Needs container image and tenant registry. |
| **#55** Rollout choreography | #52 + #53 | Title/scope is **stale** — see below. |

## Stale Items Requiring Action

### 1. `now.md` is misleading
The current focus file references "Track A (Data): NoteStore Postgres adapter (5–7 days)" mapped to #46. But #46 was the structural refactor (split note-store.ts into modules) and is **closed**. The Postgres adapter port (better-sqlite3 → node-postgres async) has **no tracking issue**. A new issue is needed before the Postgres track can start. `now.md` should be updated to reflect Wave 1 as described here.

### 2. #55 title is stale
"Define single-writer rollout rules for SQLite tenant instances on Kubernetes" — but the epic pivoted to Postgres. Single-writer SQLite constraints are no longer the primary concern. Locked decision #8 (version-skew policy) already covers the rollout model. #55 should be retitled to something like "Define tenant rolling-update and database connection-draining choreography" and rescoped for Postgres stateless updates.

### 3. #43 needs scope clarification
#43 body still says "Blocked until hosting/deployment target is selected." Hosting IS decided. The issue is **unblocked**, but its scope overlaps heavily with #52 (which produces the container image, runtime contract, and k3d proof). Recommendation: #43 becomes the **CI pipeline issue** — build container image in GitHub Actions, validate manifests, no auto-push to GHCR per locked decision (Phase 0 CI scope). That gives it a clear, non-overlapping scope and makes it a natural Wave 2 follow-up to #52.

### 4. Missing Postgres adapter issue
The epic Phase 0 plan lists "#46 Migrate note-store backend from SQLite to Postgres" but the actual #46 was only the structural refactor. The async Postgres adapter port needs a new issue assigned to Data, tracked under Phase 0. This is a prerequisite for tenant containers to run against Postgres in production.

## Review Process

All PRs from Wave 1 work must:
1. Request review with `/copilot-review` for automated feedback.
2. Follow existing review gates — Copilot reviews only, implementation stays local in worktrees.
3. Multi-file changes require Lead (Mikey) sign-off before merge.

## Rationale

#52 and #53 are the two load-bearing roots of the entire Phase 0–1 dependency tree. Starting them in parallel on separate worktrees maximizes throughput. Everything else — CI pipeline (#43), provisioning (#54), rollout (#55) — is blocked on one or both of these. No point starting Wave 2 until the container shape and CP skeleton exist.

The Postgres adapter gap is the one risk to flag: the epic says it's Phase 0 work, but there's no open issue for it. If Data starts #53 now, the Postgres adapter issue should be filed in parallel so the track isn't forgotten.
