---
name: "env-override-contract-testing"
description: "Test that CLI scripts report their effective runtime configuration, not just persisted state, when env overrides are active."
domain: "testing"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Execute scripts with env overrides and capture JSON/text output."
    when: "A script accepts env-override config and emits structured status or diagnostic output."
---

## Context
Use this when a shell script accepts environment variable overrides (like `K3D_CLUSTER_NAME`) that change its runtime behavior, and the script also reports status or config via `--json` or similar output modes. The output contract must reflect what the script actually does, not just what's persisted on disk.

## Pattern
When a script supports env-override config:
1. **Behavior and output must align:** If the script uses the override for its operations, it MUST report that override in its output
2. **Test the override contract:** Write a test that sets an env override different from persisted state, then verifies the output reports the override
3. **Distinguish persisted vs effective:** Scripts should determine the effective config (override > persisted > default) early and use it consistently for both operations and reporting
4. **Inject the real config source:** If the script hardcodes where it reads persisted state (for example `${ROOT}/.k3d-state/state.json`), the test must populate that real path or exercise an extracted helper; setting an unused env var for an alternate path creates false-green coverage.

## Examples
- `scripts/k3d/status.sh` uses `CLUSTER_NAME` (derived from `K3D_CLUSTER_NAME` > state.json > default) for both live cluster checks AND JSON output
- Test in `apps/control-plane/test/k3d-persistent-lane.test.ts` writes `state.json` with `clusterName: "dnd-notes"`, sets `K3D_CLUSTER_NAME=custom-cluster`, runs `status.sh --json`, and verifies JSON reports `"clusterName": "custom-cluster"`
- This prevents operator confusion when running `K3D_CLUSTER_NAME=foo script` and seeing output referencing a different cluster

## Anti-Patterns
- Reporting persisted config while operating on override config (split behavior)
- Using `${state_field:-${EFFECTIVE_VAR}}` in output when `${EFFECTIVE_VAR}` is what's actually being used for operations
- Testing only the happy path without env override scenarios
- Assuming env overrides are "advanced usage" that doesn't need test coverage
- Writing fixtures to a temporary file path that the script never reads, then assuming the override-vs-persisted contract is covered
- Setting an env var like `STATE_FILE=/tmp/test-state.json` when the script hardcodes its state file location and never respects that variable (false-green: test passes on both broken and fixed code)

## When to Apply
- Scripts that accept `--cluster`, `--namespace`, or similar flags/env vars
- Status/diagnostic commands with machine-readable output (`--json`, `--yaml`)
- Any script where operators might temporarily override config for debugging or multi-env workflows

## Test Implementation Strategy
When the script hardcodes a config source path (e.g., `STATE_FILE="${ROOT}/.k3d-state/state.json"`):
1. **Populate the real path** — write your test fixture to the actual location the script will read
2. **Back up existing state** — save and restore any pre-existing state file to avoid test pollution
3. **Clean up in finally** — restore the original state or remove the test fixture even if assertions fail
4. **Never fake the config source** — setting an env var the script doesn't respect creates false-green coverage
