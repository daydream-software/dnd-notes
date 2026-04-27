# 2026-04-27: PR #120 latest review fixes

**Decided by:** Brand (Platform Dev)  
**Date:** 2026-04-27

## Decision

1. Bash helpers that export multiple values from `.k3d-state/state.json` must stage the full parsed payload before assigning any shell variables.
2. `k3d:down --keep-cluster` namespace deletion should be non-blocking, using `kubectl delete namespace ... --wait=false --timeout=30s`.

## Why

- Independent per-field parser calls can leave shell state half-populated if the parser fails after the first successful read.
- Namespace deletion can stall indefinitely on stuck finalizers, which is unacceptable for a teardown helper that should reset local state quickly.

## Impact

- `scripts/k3d/status.sh` now parses the state file once, emits a NUL-delimited payload plus a success sentinel, and only then hydrates `state_*` variables.
- `scripts/k3d/down.sh` no longer waits forever when `--keep-cluster` hits a namespace that is stuck terminating.
- `apps/control-plane/test/k3d-persistent-lane.test.ts` locks the strict reset contract with a partial-parser regression.
