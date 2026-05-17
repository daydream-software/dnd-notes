---
name: advisory-lock-session-reuse
description: "Use when implementing a serialized backend workflow that holds a Postgres advisory lock — reuse the locked session to avoid pool starvation."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a service takes a Postgres advisory lock and then performs more database work inside the protected callback.

## Pattern

1. Acquire the advisory lock on a checked-out client and pass that client/executor into the callback.
2. Let repository methods accept an optional executor so reads and short transactions can reuse the locked session instead of opening extra pool connections.
3. Prefer bounded `pg_try_advisory_lock` retries with explicit timeout errors over unbounded blocking plus `statement_timeout = 0`.
4. Add regression tests that prove the locked workflow only checks out one pool client and that busy locks fail fast.

## Examples

- `apps/control-plane/src/tenant-registry-postgres.ts`
- `apps/control-plane/src/provisioning.ts`
- `apps/control-plane/test/tenant-registry.test.ts`
- `apps/control-plane/test/provisioning.test.ts`
