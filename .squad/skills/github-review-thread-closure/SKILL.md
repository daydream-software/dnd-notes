---
name: "github-review-thread-closure"
description: "Close thin PR review follow-ups only after the fixing commit is visible on the PR head."
domain: "github, review"
confidence: "high"
source: "earned"
---

## Context

Use this when a PR already has a narrow fix locally or remotely and the remaining work is reviewer hygiene: confirm the fix is actually on the PR head, reply on the specific open threads, and resolve only those threads.

## Pattern

1. Query the PR head SHA first and make sure it matches the fix commit you plan to cite.
2. Enumerate open review threads and filter to the exact thread IDs you intend to close.
3. Reply on each thread with the commit SHA plus the precise file-level change that satisfied the comment.
4. Resolve the thread immediately after the reply so the audit trail stays paired.
5. Re-query thread state afterward and confirm no intended threads remain open.

## Example

- PR #120: verify head `7d2d7fc6e1c9fde51dfa59f5162399e6b64bd173`, reply that `scripts/k3d/status.sh` dropped dead `STATE_DIR`, reply that `scripts/k3d/down.sh --help` now matches `remove_state_artifacts`, then resolve both stale threads.

## Anti-Patterns

- Resolving a thread before the fix commit is on the PR head.
- Posting a generic "fixed" reply without naming the file and behavior change.
- Bulk-resolving all threads when only a narrow subset was in scope.
