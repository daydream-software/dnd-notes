---
name: shared-build-runtime-env-normalizers
description: "Use when adding env-variable parsing — keep build-time and runtime normalization in one shared module so config surfaces cannot drift."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a frontend workspace needs the same environment-derived normalization in both its bundler config and browser/runtime config. Duplicating the logic in separate files is cheap at first and expensive once one path gets reviewed or changed independently.

## Patterns

- Extract the normalization helper into a small pure module under the workspace `src/` tree.
- Import that helper from both the bundler config (for example `vite.config.ts`) and the runtime config module.
- Keep the helper string-only and side-effect free so it is safe in both Node and browser-adjacent contexts.
- Add a focused unit test that locks the exact edge cases the two call sites share (for example blank input, root path, and trailing-slash trimming).

## Examples

- `apps/operator-portal/src/base-path.ts`
- `apps/operator-portal/vite.config.ts`
- `apps/operator-portal/src/config.ts`
- `apps/operator-portal/src/base-path.test.ts`

## Anti-Patterns

- Re-declaring the same normalization helper in both build-time and runtime config files.
- Hiding the shared logic in a browser-only module that the bundler config cannot safely import.
- Relying on caller-specific ad hoc tests instead of locking the shared helper behavior directly.
