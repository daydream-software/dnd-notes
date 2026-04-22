---
name: "bash-version-compat"
description: "Guard newer Bash-only options so contributor scripts still start on macOS Bash 3.2."
domain: "tooling"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Run lightweight script startup checks such as syntax validation and --help paths."
    when: "A repo shell script changes and may be invoked under different local Bash versions."
---

## Context
Use this when a repo script intentionally depends on Bash, but contributors may still run it with older Bash versions like macOS's default 3.2. The goal is to keep strict behavior on newer shells without making common local entrypoints fail before real work starts.

## Patterns
- Keep `#!/usr/bin/env bash` when the script genuinely uses Bash features.
- Treat Bash 4.4+ options such as `shopt -s inherit_errexit` as optional hardening, not universal assumptions.
- Guard version-specific setup with explicit `BASH_VERSINFO` checks so the compatibility rule is obvious in code review.
- Prefer targeted guards over broad `|| true` fallbacks when newer shells should still fail loudly for real errors.
- Validate both parseability (`bash -n`) and a lightweight startup path (for example `bash script.sh --help`) after making portability changes.

## Examples
- `scripts/k3d/smoke.sh` enables `inherit_errexit` only when `BASH_VERSINFO` indicates Bash 4.4+.
- A local bootstrap or validation script can keep `set -Eeuo pipefail` across supported Bash versions while only gating the newer `shopt` behavior.

## Anti-Patterns
- Unconditionally enabling a `shopt` flag that older Bash versions do not recognize.
- "Fixing" compatibility by downgrading a Bash script to POSIX `sh` while it still uses Bash arrays, `[[ ... ]]`, or `/dev/tcp`.
- Silently swallowing all shell setup failures with blanket `|| true` around multiple options.
