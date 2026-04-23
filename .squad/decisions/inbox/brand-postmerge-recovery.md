# Brand — Post-Merge Recovery Pattern

**Decided by:** Brand (Platform Dev)
**Date:** 2026-04-23

## Decision

If a PR is already merged but the source branch still carries a local-only
follow-up commit with durable squad state (for example decisions, agent history,
or other tracked coordination artifacts), recover it from `main` with a
non-destructive cherry-pick after fast-forwarding `main` to `origin/main`.

## Why

- Squash-merged PRs leave source-branch commits outside `main` even when most of
  their content already landed.
- Replaying just the missing commit on `main` preserves auditability and avoids
  rewriting merged branch history.
- This keeps unrelated branches and worktrees untouched during recovery.

## Impact

- Recovery flow becomes: verify the commit is still missing → `git pull --ff-only`
  on `main` → `git cherry-pick <sha>` → push `main` only if a new recovery
  commit was created.
- Post-merge docs/decision cleanup stays recoverable without force-pushes or
  branch surgery.
- Current example: recovered PR #81 follow-up commit `9cccb60` from
  `squad/79-k3d-full-stack-smoke-live-override` onto `main`.
