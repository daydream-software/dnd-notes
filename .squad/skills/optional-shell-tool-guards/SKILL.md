---
name: "optional-shell-tool-guards"
description: "Guard advisory shell-tool usage so contributor scripts degrade gracefully on partially provisioned machines."
domain: "tooling"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Validate script syntax and exercise the missing-tool path with a focused shell test."
    when: "A script runs under set -Eeuo pipefail but only uses an external tool for optional diagnostics or state recovery."
---

## Context
Use this when a local helper script genuinely depends on Bash, but one of its
external tools is only needed for best-effort behavior such as status probing,
JSON state reads, or fallback diagnostics. The goal is to keep the primary lane
usable on partially provisioned developer machines without hiding real hard
dependencies.

## Patterns
- Keep hard prerequisite checks only for tools the command cannot proceed without.
- Before calling an optional tool, guard it with `command -v ... >/dev/null 2>&1`.
- On the guarded path, return a neutral value (`""`, `false`, “skipped”) rather
  than aborting the whole script under `set -Eeuo pipefail`.
- Make fallback log messages describe “missing or unreadable” inputs broadly when
  several guarded paths collapse to the same behavior.
- Add a focused regression that runs the real shell helper with the optional tool
  hidden from `PATH`.

## Examples
- `scripts/k3d/status.sh` skips the tenant `/ready` curl probe when curl is not
  installed and surfaces `urlProbeSkipped` in JSON output.
- `scripts/k3d/down.sh` returns an empty `read_state_field` value when Node is
  unavailable, allowing `--keep-cluster` to fall back to scanning `tenant-*`
  namespaces.
- `scripts/k3d/up.sh` captures `previous_kube_context` only when `kubectl` is
  installed, so the script does not print startup noise before its real
  prerequisite checks.
- `apps/control-plane/test/k3d-persistent-lane.test.ts` shells into both helpers
  with a fake empty `PATH` to lock the degraded behavior.

## Anti-Patterns
- Promoting advisory tools to hard prerequisites just to avoid writing a guard.
- Letting a command substitution fail under `set -e` when an empty fallback value
  is sufficient for the caller.
- Logging a fallback as “missing state file” when the real condition might also
  be “corrupt JSON” or “parser unavailable”.
