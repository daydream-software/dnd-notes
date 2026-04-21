# Orchestration Log Entry

### 2026-04-16T23:43:07Z — PR Automation Design Review

| Field | Value |
|-------|-------|
| **Session requested by** | FFMikha |
| **Session type** | Design review + analysis (Scribe logging) |
| **Review subject** | Copilot PR review + automerge workflow automation design |
| **Files analyzed** | `.github/workflows/copilot-pr-review.yml`, `.github/workflows/copilot-pr-automerge.yml` |
| **Reviewer** | Ralph (Engineering Lead) |

---

## Key Findings

### Issue: Automerge Race Condition

The current automerge workflow (`copilot-pr-automerge.yml`) is triggered **only** on `workflow_run` completion from the CI workflow. This creates a **critical race condition**:

1. **Scenario A (Works)**: CI finishes → automerge checks for Copilot review + resolved threads → merges ✓
2. **Scenario B (Fails)**: CI finishes before Copilot review or review threads are resolved → automerge evaluates "not ready" → **PR never merges without manual intervention or a subsequent CI run** ✗

### Root Cause

- Automerge only re-evaluates when the CI `workflow_run` event fires
- If review state changes *after* CI completes but before automerge runs, the PR state is stale
- Subsequent review submissions or thread state changes do **not** trigger automerge re-evaluation
- The PR remains in a "ready-to-merge-but-not-merging" limbo

---

## Recommendations

### Option 1: Shared Merge-Gate Evaluator (Preferred)

Replace the single-trigger design with a **dedicated merge-gate evaluator** triggered by:
- `workflow_run` (CI completion) — current trigger
- `pull_request_review` with `action: submitted` — Copilot review arrival
- `pull_request` with `action: synchronize` — new commits
- Thread state change events that affect merge readiness (e.g., `pull_request_review_comment` with resolution actions)

This ensures the merge gate re-evaluates whenever any merge-blocking state changes.

### Option 2: Minimal Patch

Add `pull_request_review` trigger at minimum:

```yaml
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
  pull_request_review:
    types: [submitted]
```

This handles the most common case (Copilot review arrives after CI) but doesn't fully address thread state changes.

### Recommendation for Next Session

- Implement **Option 1** if time permits (cleaner, future-proof)
- Implement **Option 2** if quick fix needed (solves 80% of the race condition)
- Document the chosen pattern in `.squad/decisions.md` so future workflow automation follows the shared merge-gate pattern

---

## Notes

- This is a subtle but real issue: the workflows "work" in happy path tests but fail in production when CI and review timing don't align
- Current design assumes review arrives before CI completes, which doesn't always hold
- Ralph's review confirms the analysis; decision on implementation approach is pending
