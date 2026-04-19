---
name: "docs-pr-scope-hygiene"
description: "Keep docs-focused pull requests limited to real documentation changes and strip session-planning residue before merge."
domain: "code-review"
confidence: "high"
source: "earned"
---

## Context
Use this when reviewing or preparing documentation-heavy PRs, especially Copilot-authored slices that may carry along execution artifacts. The goal is to keep repo history readable and avoid merging files that only exist to manage one session.

## Patterns
- In a docs PR, expect the diff to stay centered on product docs or intentionally tracked squad records.
- Treat repo-root planning files like `plan.md` as suspect unless the repo already uses them as durable, reviewed artifacts.
- If a planning artifact duplicates information already captured in tracked squad history, remove it from the PR and keep the durable record in the existing append-only file.
- When tracked squad history conflicts with a later locked decision, update that history entry to point at `.squad/decisions.md` (or mark it superseded) instead of leaving inbox-path drift in the PR.
- Prefer one blocking review note on scope hygiene over many minor comments when the main change itself is sound.
- On re-review, once the accidental scope is removed, avoid replacing that blocker with fresh style-only nits; approve if the remaining docs change is coherent and the only non-product file is a tracked squad history record.

## Examples
- PR #51: README runbook update is valid; new repo-root `plan.md` is session residue and should be dropped.
- `.squad/agents/copilot/history.md` can remain when it records durable team context for future sessions.
- PR #59 cleanup: after merging `main`, let stale comments on files that fall out of the diff age out, and only edit the remaining tracked history entry so it matches the locked contract in `.squad/decisions.md`.
- PR #51 re-review: after `plan.md` was removed, the README rehearsal checklist plus tracked squad history file was clean enough to approve.

## Anti-Patterns
- Merging a session checklist just because it was generated during the work.
- Expanding a docs PR with reviewer-irrelevant process files at the repo root.
- Requesting style-only copy edits when the real risk is accidental scope creep.
