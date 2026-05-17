---
name: bash-version-compat
description: "Use when writing or editing contributor Bash scripts to keep them compatible with macOS's preinstalled Bash 3.2."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a repo script intentionally depends on Bash, but contributors may still run it with older Bash versions like macOS's default 3.2. The goal is to keep strict behavior on newer shells without making common local entrypoints fail before real work starts.

## Patterns

- Keep `#!/usr/bin/env bash` when the script genuinely uses Bash features.
- Treat Bash 4.4+ options such as `shopt -s inherit_errexit` as optional hardening, not universal assumptions.
- Guard version-specific setup with explicit `BASH_VERSINFO` checks so the compatibility rule is obvious in code review.
- Prefer targeted guards over broad `|| true` fallbacks when newer shells should still fail loudly for real errors.
- When a Bash helper needs the last positional argument, prefer `${!#}` or a dedicated variable over negative-offset `${*: -1}` so the script still runs on Bash 3.2.
- Validate both parseability (`bash -n`) and a lightweight startup path (for example `bash script.sh --help`) after making portability changes.
- Avoid Bash 4.0+ array slicing like `${array[@]:offset:length}` or `${*: -1}` (last argument); instead use Bash 3.2-safe indirect expansion `${!#}` for "last positional parameter index", guarded by `if (( $# > 0 ))` to prevent unset-variable errors.

## Examples

- `scripts/k3d/smoke.sh` enables `inherit_errexit` only when `BASH_VERSINFO` indicates Bash 4.4+.
- `scripts/k3d/smoke.sh` (PR #108, commit 611dbf6) uses `${!#}` pattern with guard `if (( $# > 0 ))` to safely capture the last positional argument (request URL) for logging, replacing the Bash 4.0+ bashism `${*: -1}`.
- A local bootstrap or validation script can keep `set -Eeuo pipefail` across supported Bash versions while only gating the newer `shopt` behavior.

## Anti-Patterns

- Unconditionally enabling a `shopt` flag that older Bash versions do not recognize.
- "Fixing" compatibility by downgrading a Bash script to POSIX `sh` while it still uses Bash arrays, `[[ ... ]]`, or `/dev/tcp`.
- Silently swallowing all shell setup failures with blanket `|| true` around multiple options.
