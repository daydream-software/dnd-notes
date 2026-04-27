# Mikey — PR #120 latest review gate

## Decision

Reject the current PR #120 code patch for the two newly opened review threads; do not reply/resolve those threads yet.

## Why

1. `scripts/k3d/down.sh` still deletes namespaces in `--keep-cluster` mode with the default blocking wait semantics, so a stuck namespace finalizer can hang the teardown helper indefinitely.
2. `scripts/k3d/status.sh` still reads each `state_*` field with separate `node -e` invocations, so the documented `read_state()` contract ("all variables are set to empty strings" on failure) is not strictly true if parsing fails mid-stream or the file changes while being read.
3. The focused validation commands are green, but the tests currently prove syntax and several regressions around quoting/context handling — they do not invalidate these two precise review concerns.

## Minimum acceptable fix

1. Add `--wait=false` or an explicit bounded timeout to both namespace-deletion paths in `scripts/k3d/down.sh --keep-cluster`.
2. Change `scripts/k3d/status.sh read_state()` to parse all persisted fields from one snapshot and assign only after success, or reset the shell variables again on every failure path before returning non-zero.
3. Add focused regression coverage for the exact contracts above before asking for re-review.

## Owner

Brand should keep the revision: this is still a narrow platform-shell follow-up, not an architecture handoff.
