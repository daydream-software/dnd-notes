---
name: override-safe-state-cleanup
description: "Use when cleaning up overrideable state files; never recursively delete caller-controlled parent directories."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a local shell script accepts a file-path override like
`K3D_STATE_FILE`, `CACHE_FILE`, or `LOCK_FILE`, but also wants to clean up its
state on exit or teardown.

## Patterns

- Treat the file path as the cleanup target; do not infer authority to delete the
  whole parent directory from an overrideable filename.
- Use `rm -f "${STATE_FILE}"` (or equivalent) for the actual state cleanup.
- If the default repo-owned parent directory should disappear when empty, exact-match
  it first (for example `[[ "${STATE_DIR}" == "${ROOT}/.k3d-state" ]]`) and then
  use `rmdir` so non-empty directories survive.
- Add regressions for both cases: a custom override outside the default directory
  must keep its parent intact, while the default empty directory may be removed.

## Examples

- `scripts/k3d/down.sh`
- `apps/control-plane/test/k3d-persistent-lane.test.ts`
