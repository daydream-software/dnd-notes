---
name: "mergeability-blocker-repair"
description: "Clear a dirty PR safely without widening the slice or retriggering stale review churn."
domain: "platform"
confidence: "high"
source: "earned"
---

## Context

Use this when a GitHub PR is blocked by `mergeable_state: dirty` after `main` moved underneath an already-reviewed branch.

## Pattern

1. Treat mergeability/autoclose blockers the same as review blockers: inspect them immediately instead of waiting for a human merge attempt to fail.
2. Prefer merging current `origin/main` into the PR branch over rebasing when the branch already has review history you want to preserve.
3. After the merge, diff `origin/main...HEAD` and confirm the branch still only contains the intended issue slice.
4. Do not resurrect ignored or already-merged `.squad/decisions/inbox/*` artifacts just because older review comments mentioned them.
5. Re-run the existing validation lane before pushing.
6. Only request a fresh Copilot review when the conflict resolution materially changes the PR diff; a clean base-sync merge usually should not.

## Example

- `git fetch origin main && git merge --no-ff origin/main`
- `git diff --name-status origin/main...HEAD`
- `npm run lint && npm run build && npm run test --workspace apps/api --`

## Anti-Patterns

- Rebasing a reviewed branch just to clear `dirty` and discarding review context
- Reintroducing stale `.squad/decisions/inbox/*` churn to satisfy outdated comments
- Skipping validation because the merge looked clean
- Spamming `/copilot-review` after every no-op base sync
