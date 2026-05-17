---
name: pg-mem-postgres-registry-tests
description: "Use when writing Node Postgres service tests; inject pg-mem through the real registry contract for fast tests without losing fidelity."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a Node service has moved to `pg` pools but the workspace test suite should still run without a live Postgres server.

## Pattern

- Build one shared test helper that creates `pg-mem`, exposes its `Pool`, and passes that pool into the real registry/service constructor.
- Keep the app/service contract async and unchanged; only the test setup swaps the pool.
- Let route, auth, and provisioning tests all reuse the same helper so they exercise the Postgres path instead of reviving an old SQLite-only fixture.

## Example

- `apps/control-plane/test/tenant-registry-test-helpers.ts` creates the `pg-mem` pool.
- `apps/control-plane/test/app.test.ts`, `keycloak-auth.test.ts`, `provisioning.test.ts`, and `tenant-registry.test.ts` all consume that helper instead of constructing an in-memory SQLite registry.
