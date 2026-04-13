# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Copilot enabled as autonomous coding agent for squad via auto-assignment to squad:copilot issues.

## Recent Updates

📌 Team update (2026-04-12T21:44:58Z): ASSIGNMENT — You are now owner of Issue #27 frontend UI revision. Stef's implementation was rejected by Chunk due to four critical state-management regressions: (1) `noteBrowseMode` dependency causes workspace reload on mode toggle, clobbering editor state, (2) create-note drafts lost when workspace reloads, (3) stale-response race on session switch, (4) missing regression tests. Backend (#27) is approved and ship-safe. Re-approval bar: remove `noteBrowseMode` from bootstrap dependency chain, add cancellation guard to session loading, add tests for mode toggles and create-note reset. Full details in `.squad/decisions.md` — assigned by Chunk (reviewer)

📌 Team update (2026-04-13T00:04:28Z): Issue #27 UI COMPLETED & MERGED. Your revision successfully retired all four rejection criteria: browse-mode state isolated from `loadWorkspace` dependency (synchronous state management), draft preservation tested, stale-response race eliminated by `useMemo` design, comprehensive regression test coverage added (3 web + 3 API tests). PR #36 merged on main (`9d0966b`). **Potential FALLBACK ASSIGNMENT: Issue #33 (Recent Activity UI)** — Primary owner is Stef (frontend); if Stef is unavailable, you're the fallback. Thin slice v1 scope: read-only activity feed UI (notes sorted by `updatedAt`), collaborator filter sidebar, distinguish 'created' vs 'edited' actions with attribution, empty state handling. Backend contract stable (`GET /api/notes/activity`). Regression test plan documented (RT1–RT5 gates). Expected delivery: 2–3 days. Files: `App.tsx` (tab + filter state), `api.ts` (fetchActivity), `types.ts` (activity types), `App.test.tsx` (tests). See `.squad/orchestration-log/2026-04-13T00:04:28Z-issue-33-ui-handoff.md` for full context — decided by FFMikha (product), Chunk (reviewer)

📌 Team update (2026-04-13T07:52:28Z): ASSIGNMENT — Issue #28 Frontend Tag Facets Revision. Stef's implementation pass was rejected by Chunk (tester) due to critical list/detail mismatch blocker: when active tag filter is applied, the left pane list narrows locally via `filteredNotes`, but the editor still pulls from full `notes` array via `selectedNoteId`. This creates a dangerous state where the form can edit a note that no longer appears in the filtered list. Revision scope: reconcile `selectedNoteId`, `isCreating`, `draft` with filtered note list when `handleSelectTagFilter()` runs. Either retarget editor to first matching note OR clear to safe create/empty state. Add regression test proving list/detail sync. Stef is locked out for this cycle. Orchestration logs in `.squad/orchestration-log/`. Full verdict in `.squad/decisions.md` — decided by Chunk (reviewer), rerouted by coordinator
