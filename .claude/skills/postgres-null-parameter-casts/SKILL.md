---
name: postgres-null-parameter-casts
description: "Use when writing Postgres queries with branch logic on nullable placeholders — cast them explicitly."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a nullable bound parameter is reused in Postgres across `SET`, `CASE`, `IS NULL` / `IS NOT NULL`, or comparison branches.

## Pattern

1. If a nullable placeholder appears in branch predicates, cast it explicitly (`CAST($n AS TEXT)`, etc.) everywhere that branch logic uses it.
2. Do not rely on pg-mem or a nearby assignment to infer the type; real Postgres can still raise `could not determine data type of parameter $n`.
3. Add a regression that inspects the generated SQL or otherwise locks the cast in place.

## Examples

- `apps/control-plane/src/tenant-registry-postgres.ts`
- `apps/control-plane/test/tenant-registry.test.ts`
