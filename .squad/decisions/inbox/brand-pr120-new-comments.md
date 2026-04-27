# Brand — PR #120 review follow-up

## Decision

For overrideable local state paths, teardown helpers may remove the state file directly, but they must not `rm -rf` the parent directory derived from an env override. If we want to keep the default repo-owned `.k3d-state/` tidy, only remove that exact directory with `rmdir` after deleting the file.

## Why

- `K3D_STATE_FILE` is intentionally overrideable for tests and local workflows.
- `rm -rf "$(dirname "$K3D_STATE_FILE")"` turns a harmless override into arbitrary directory deletion risk.
- Deleting the file plus optional exact-path `rmdir` keeps the normal UX without making cleanup dangerous.

## Applied in

- `scripts/k3d/down.sh`
- `apps/control-plane/test/k3d-persistent-lane.test.ts`
