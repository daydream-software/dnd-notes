---
name: "github-pr-gatekeeper-trace-notes"
description: "Record a concise, idempotent PR conversation note before an automation gate merges a pull request."
domain: "github-actions, ci, automation"
confidence: "high"
source: "earned"
tools:
  - name: "view"
    description: "Inspect the gatekeeper workflow and any existing PR-comment markers or merge logic."
    when: "Before editing GitHub Actions automerge or close/merge automation."
  - name: "rg"
    description: "Find other gatekeeper references, trace formats, or mirrored workflow copies."
    when: "When keeping workflow behavior coherent across the repo."
---

## Context
If an automation merges or closes a PR without leaving evidence on the PR itself, debugging later depends on external logs that are easy to lose. A small trace note gives post-mortem context exactly where reviewers and maintainers look first.

## Patterns
1. Post the note only after all gates pass and immediately before the merge/close API call.
2. Use a visible prefix that is easy to grep later, plus a hidden marker keyed to the head SHA for idempotency.
3. Include the minimum evidence set: head SHA, CI status on that SHA, reviewer status on that SHA, unresolved-thread count/status, and trigger/run context.
4. Pass the evaluated head SHA into the merge API call when available so the recorded note matches the merged revision.
5. Keep the note short enough for skim-reading in the PR timeline.

## Examples
- Visible prefix: `[copilot-gatekeeper] merge-trace`
- Hidden marker: `<!-- copilot-gatekeeper-merge-trace:<head-sha> -->`
- Trigger context: ``workflow_run:CI#123456 attempt 2 -> gate #7890123/1``

## Anti-Patterns
- Posting a new comment every time the workflow re-checks the same SHA.
- Logging only "merge succeeded" without the observed state that justified it.
- Writing the note after merge, when the PR may already be closed and harder to correlate with the evaluation state.
