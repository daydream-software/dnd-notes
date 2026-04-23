# Issue #97 — control-plane registry goes Postgres-only

## Context

Issue #95 superseded the earlier SQLite direction for the control-plane registry. The control-plane now needs one boring persistence contract built on `pg` pools and `CONTROL_PLANE_DATABASE_URL`, while tests still need an in-repo path that does not depend on a live Postgres service.

## Decision

- Treat `apps/control-plane/src/tenant-registry-postgres.ts` as the single live registry implementation.
- Keep `apps/control-plane/src/tenant-registry.ts` as a thin delegator so routes/services keep one registry contract.
- Drop the SQLite control-plane backend and `DATABASE_PATH` startup path for this slice.
- Standardize control-plane tests on a shared `pg-mem` helper (`apps/control-plane/test/tenant-registry-test-helpers.ts`) so app/provisioning/auth suites exercise the Postgres contract without external infrastructure.

## Why

This keeps the runtime contract explicit: one env var, one pool, one backend. It also avoids dragging SQLite migration complexity into a slice whose source of truth is already Postgres.
