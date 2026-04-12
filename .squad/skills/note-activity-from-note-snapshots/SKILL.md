---
name: "note-activity-from-note-snapshots"
description: "Expose useful recent note activity without adding a full audit log by deriving latest activity from note timestamps and membership attribution"
domain: "api-design, backend, collaboration"
confidence: "high"
source: "earned through issue #33 backend slice"
---

## Context
Use this when the product needs recent-awareness views for collaborative notes, but the backend only persists the current note row plus authorship metadata. The goal is to show what changed recently and who has been active without committing to a noisy append-only audit model.

## Patterns
1. Build one activity entry per note from the latest stored state instead of inventing historical edits you do not persist.
2. Classify the entry as `created` when `createdAt === updatedAt`, otherwise `edited`, and expose both the chosen actor and the original `createdBy` / `lastEditedBy` attribution so callers can explain the change.
3. Reuse the same accessible-campaign guard as sibling note routes so linked collaborators keep access to the activity view.
4. Add an optional membership filter and collaborator summaries from the same activity set so the UI can pivot between campaign-wide activity and one collaborator's recent changes without needing an owner-only membership list endpoint.
5. If the UI depends on `updatedAt !== createdAt` to detect edits, make note updates monotonic across same-millisecond writes.

## Examples
- `apps/api/src/app.ts`: `GET /api/notes/activity` maps `noteStore.listNotes(campaign.id)` into latest-state activity rows and collaborator summaries.
- `apps/api/src/note-store.ts`: `createTimestampAfter()` ensures note edits always move `updatedAt` forward for deterministic activity classification.
- `apps/api/test/app.test.ts`: activity tests cover collaborator summaries, membership filtering, and linked-collaborator access after membership claim.

## Anti-Patterns
- Returning a so-called activity feed that is really just raw notes with no actor or action metadata.
- Adding a per-edit audit log table before the product has proven it needs that noise and storage cost.
- Reusing owner-only membership routes for collaborator-facing activity filters when note attribution already contains enough actor data to summarize active collaborators.
