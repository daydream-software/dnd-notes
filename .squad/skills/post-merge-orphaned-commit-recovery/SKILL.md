---
name: "post-merge-orphaned-commit-recovery"
description: "Recover a local-only post-merge branch commit onto main without rewriting merged history."
domain: "git-workflow"
confidence: "high"
source: "earned"
---

## Context
Use this when a PR is already merged, but the source branch still has a local-only
follow-up commit containing durable project state that never reached `main`.

## Patterns
- Verify the PR is merged and identify the exact local-only commit.
- Fast-forward local `main` to `origin/main` before any recovery work.
- Check whether the missing commit's content is already present on `main`; skip
  recovery if it is.
- Recover with `git cherry-pick <sha>` on `main` so the fix is auditable and
  non-destructive.
- Push `main` only if the cherry-pick created a real recovery commit.
- Leave the merged branch and unrelated worktrees untouched.

## Examples
- PR #77 recovery: cherry-pick orphaned local commit `bbbcba8` onto `main` as
  `e8b6b9b`.
- PR #81 recovery: cherry-pick local-only docs commit `9cccb60` from
  `squad/79-k3d-full-stack-smoke-live-override` onto `main` as `40c71f0`.

## Anti-Patterns
- Rebasing or force-pushing a merged PR branch to replay the missing commit.
- Resetting `main` or rewriting unrelated local branches/worktrees.
- Pushing `main` before confirming the commit content is actually absent.
