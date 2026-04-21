# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Copilot enabled as autonomous coding agent for squad via auto-assignment to squad:copilot issues.

## Recent Updates

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
