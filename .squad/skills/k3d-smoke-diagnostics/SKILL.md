---
name: "k3d-smoke-diagnostics"
description: "Preserve full smoke workdir logs in CI artifacts when the live k3d lane fails."
domain: "platform"
confidence: "high"
source: "earned"
---

## Context
Use this for contributor-facing smoke scripts that redirect long-running service logs into a local work directory and later upload `reports/*` artifacts in CI.

## Pattern
1. Keep the immediate stderr summary small but useful by grepping likely error lines before printing a raw tail.
2. On failure, copy the preserved work directory into the artifact tree that the workflow already uploads.
3. Prefer this over printing enormous log blobs directly to Actions output, which can still hide the real exception once tails are truncated.

## Examples
- `scripts/k3d/smoke.sh`
- `.github/workflows/k3d-smoke.yml`
