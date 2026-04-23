# Mikey — Issue #95 replaces SQLite-per-tenant with per-tenant Postgres

**Decided by:** Mikey (Lead)
**Date:** 2026-04-23

## Decision

Issue #95 supersedes the earlier Phase 1 target in `.squad/decisions.md` that said
"one SQLite file/volume per customer instance" (`.squad/decisions.md:306`).

The new hosted steady-state model is:

- one Postgres database per tenant in the shared platform Postgres server;
- one least-privilege Postgres runtime role per tenant;
- no tenant PVC in the normal hosted app pod shape;
- overlapping rolling updates (`maxSurge: 1`, `maxUnavailable: 0`) once the
  tenant runtime no longer depends on single-writer SQLite handoff.

SQLite remains only as a local-development fallback and as the snapshot/interchange
format already used by admin backup and restore workflows until the broader
cutover work lands.

## Why

- A tenant PVC plus SQLite single-writer semantics turns ordinary updates into a
  drain-first replacement, which blocks the zero-downtime goal.
- Postgres is already present in the k3d stack and tenant provisioning already
  knows how to create per-tenant databases and runtime credentials.
- Moving both tenant runtime data and the control-plane registry off SQLite
  removes the main HA and rollout blocker before more refactors pile on top.

## Impact

- Provisioning should treat per-tenant Postgres as the normal path and PVC-backed
  SQLite as legacy/transitional behavior, not the target platform shape.
- Backup/restore work should pivot to `pg_dump` / `pg_restore` per tenant
  database while keeping the SQLite-compatible snapshot bridge until the
  operational cutover is complete.
- Rollout docs should distinguish the current drain-first PVC-backed contract
  from the new target overlapping rollout contract.
- Follow-on implementation slices under #95 should land before restarting the
  postponed #87 technical-debt work that would otherwise refactor around the old
  persistence model.
