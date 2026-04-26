## 2026-04-26: Optional tool guards in contributor-facing k3d scripts

**Decided by:** Brand  
**Context:** PR #120 review follow-up for the persistent k3d lane.

### Decision

When a local k3d helper script uses an external tool only for advisory behavior
(for example, a status probe or best-effort state parsing), prefer graceful
degradation over making that tool a hard prerequisite.

### Why

- `k3d:status` should still report cluster/deployment health on machines that do
  not have `curl`, instead of aborting before printing anything useful.
- `k3d:down --keep-cluster` should still fall back to namespace scanning when
  `node` is unavailable or `.k3d-state/state.json` is unreadable.
- Hard requirements should stay reserved for the tools the lane truly cannot run
  without.

### Impact

- Optional checks must be guarded explicitly in shell scripts that run under
  `set -Eeuo pipefail`.
- Regression coverage should exercise the “tool missing” path whenever that
  guard affects teardown/status behavior.
