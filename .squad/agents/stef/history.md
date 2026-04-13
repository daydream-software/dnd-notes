# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Stef initialized as Frontend Dev for the initial project squad.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.

📌 Team update (2026-04-12T14:38:40Z): Campaign share links stay as reusable single links with owner-only on-demand reveal; listings stay metadata-only and legacy hash-only links must be revoked/recreated to become revealable again — decided by FFMikha (via Copilot), Mikey, Data, Stef, Chunk

📌 Team update (2026-04-12T17:35:41Z): Issue #27 session browsing backend fixes approved; frontend UI slice approved for ship; thin two-step flow (Browse by session → Select session → Browse notes) ready to merge — decided by Chunk (reviewer), Stef (implementer)

## Learnings

- Initial squad setup complete.
- Owner share links now stay metadata-only in the list UI until a card-level reveal action fetches that specific reusable URL, then the card handles blur/show/copy locally in `apps/web/src/App.tsx`.
- Frontend share-link reveal wiring lives in `apps/web/src/api.ts`, `apps/web/src/types.ts`, and `apps/web/src/App.test.tsx`; legacy reveal failures should be surfaced inline on the card with a recreate suggestion.
- Claimed guest memberships must unlock the authenticated workspace through any linked campaign membership, while owner-only settings stay gated; the cross-cut lives in `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, and `apps/web/src/App.tsx`.
- After linking from the shared route, persist `dnd-notes:selected-campaign-id` so the next main-app bootstrap lands on the claimed campaign instead of dropping people back into the default one (`apps/web/src/SharedCampaignRoute.tsx`).
- Built-in starter templates live client-side in `apps/web/src/templates.ts`, so frontend can seed reusable campaign scaffolds and note drafts without waiting on a backend template API.
- Campaign template UI stays in create mode only inside `apps/web/src/App.tsx`, which keeps issue #32 off the owner campaign-settings surface while still seeding starter notes after `createCampaign()`.
- Note templates stay optional in create-note mode and simply replace the local draft with editable plain-text scaffolding for NPC, faction, session, or location notes.
- Membership consolidation regression coverage lives in `apps/api/test/app.test.ts`; keep the route owner-only for linked guest accounts and reject source/target membership IDs that come from another campaign with campaign-scoped 404s.
- Issue #27 session browsing stays inside the existing list/detail shell in `apps/web/src/App.tsx`: add an `All notes` / `Browse by session` toggle, a session list view, and a session-notes view instead of a broader layout rewrite.
- Session list data comes from the session endpoints in `apps/web/src/api.ts`; keep counts and detail loading separate so the flat note list still works unchanged when users stay in normal browsing mode.
- Starting a new note should reset back to the flat note list so session browsing does not interfere with the active note-creation surface; regression coverage for the browse mode lives in `apps/web/src/App.test.tsx`.
- **Issue #29 spike (graph-style tags):** Current tags are simple comma-separated strings stored as JSON in SQLite, rendered as Material UI Chips, with zero discovery/browsing UI. Graph relationships only unlock value once search and tag browsing exist (v1–v2 roadmap item). Premature implementation without discovery mechanisms creates unused complexity. Defer to v3+ after search foundations ship; start with auto-inferred relationships from tag co-occurrence, not manual curation. See `.squad/decisions/inbox/stef-issue-29.md` for full analysis.
- Issue #28 tag discovery can stay fully client-side in `apps/web/src/App.tsx`: derive tag facets and counts from the loaded campaign notes, then filter the existing note list locally instead of adding a new API contract.
- Tag entry now works best as a free-solo Material UI `Autocomplete` backed by loaded note tags, with blur/Enter committing comma-separated input so quick capture stays fast.
- Frontend regression coverage for the tag slice lives in `apps/web/src/App.test.tsx`, and the README should mention tag facets/autocomplete as an existing campaign-browsing capability.
- Keep issue #28 tag filtering in local `App.tsx` state (`selectedTagFilter`) so switching between notes, sessions, and activity does not reload the workspace or clobber in-progress drafts.
- The tag browser should self-heal off the already loaded campaign notes: derive `tagFacets` from `notes`, reuse them for editor autocomplete, and auto-clear the active filter if the selected tag disappears after a save/delete.
- Starting a brand-new note should clear any active tag facet in `apps/web/src/App.tsx`, so the compose flow does not inherit a browse-only filter and make the fresh note feel invisible after save; keep the regression in `apps/web/src/App.test.tsx`.
- Issue #25 mobile note layout keeps browse controls in the left-side workspace but switches phones/tablets to an explicit single-pane `browse`/`editor` flow in `apps/web/src/App.tsx`; selecting a note or starting a new one should open the editor while desktop keeps the split layout.
- Mobile note-layout regression coverage lives in `apps/web/src/App.test.tsx` with a `matchMedia` mock: default tests stay desktop-first, while narrow-screen tests should prove the notes list hides during editing and saved note changes are still visible when returning to browse.

## 2026-04-12: Issue #27 Backend Fixed, #32 & #23 Approved

📌 Team update (2026-04-12T16:45:23Z): Issue #27 session-browsing v1 implementation rejected by Chunk (route shadowing, percent-decode crash, auth regression, missing regression tests). Concept approved; Data assigned backend fixes. You are assigned UI follow-on work for #27 after backend fixes land. Issue #32 (campaign templates) implementation completed and under Chunk review for acceptance criteria.

📌 Team update (2026-04-12T21:22:46Z): Issue #27 backend revision approved and ship-safe. Data fixed all four regressions. You can now start thin session-browsing UI slice on the SessionsResponse contract. Issue #32 (campaign templates) approved by Mikey; no blockers. Issue #23 membership consolidation revision approved by Chunk; your regression coverage closed all safety gaps and is ship-ready. All three finalized in `.squad/decisions.md` — decided by Data, Chunk, Mikey

📌 Team update (2026-04-12T21:44:58Z): CORRECTION — Issue #27 frontend UI REJECTED by Chunk after re-review. Four critical state-management regressions identified: (1) `noteBrowseMode` dependency triggers workspace reload on mode toggle, clobbering editor state, (2) create-note drafts lost when workspace reloads from session mode, (3) stale-response race on session switch (heading mismatches list/detail), (4) missing regression coverage. Re-approval bar: remove `noteBrowseMode` from bootstrap dependency, add cancellation guard to session loading, add tests for mode-toggle behavior, create-note reset, and out-of-order session responses. You are locked out of this revision cycle; @copilot is new owner for issue #27 UI — decided by Chunk (reviewer)

📌 Team update (2026-04-13T00:04:28Z): Issue #27 UI APPROVED & MERGED by Chunk (2026-04-12T23:19:25Z). All four regression criteria retired by @copilot's revision: browse-mode state isolated from `loadWorkspace` dependency, draft preservation tested and verified, stale-response race eliminated by synchronous `useMemo` design, comprehensive regression test coverage added. PR #36 now merged on main (`9d0966b`). **Issue #33 (Recent Activity UI) now unblocked for your implementation** — assignment pending product decisions on shared-workspace activity and collaborator filter privacy. Thin slice v1 scope: read-only activity feed (notes sorted by `updatedAt`), collaborator filter sidebar (click to filter/clear), distinguish 'created' vs 'edited' actions, empty state. Non-blocking product decisions can be finalized during dev. Backend contract (`GET /api/notes/activity`) is stable. Regression test plan documented (RT1–RT5 gates in issue #33 decision). Expected delivery: 2–3 days post-PR-#36 merge. Files to modify: `App.tsx` (activity tab + filter state), `api.ts` (fetchActivity function), `types.ts` (activity response types), `App.test.tsx` (regression coverage). See `.squad/orchestration-log/2026-04-13T00:04:28Z-issue-33-ui-handoff.md` for full assignment context — decided by FFMikha (product), Chunk (reviewer), Scribe (session logger)

📌 Team update (2026-04-13T07:52:28Z): LOCKOUT — Issue #28 tag facets branch rejected by Chunk (tester) due to critical list/detail mismatch blocker. When active tag filter is applied, left pane list narrows locally via `filteredNotes`, but editor still pulls from full `notes` array. Form can edit a note that no longer appears in filtered list. @copilot assigned for revision. You are locked out of this cycle. Orchestration and decision details in `.squad/log/` and `.squad/decisions.md` — decided by Chunk (reviewer), coordinator routed to copilot

## 2026-04-13: Issue #30 Note Links and Backlinks

- Added linkedNoteIds: string[] field to Note type in both backend and frontend
- Backend stores linked notes as JSON array in SQLite linked_notes_json column
- Migration adds column with default '[]' and safe parsing fallback for existing data
- Validation ensures linked notes exist and are in same campaign on create/update
- Frontend link editor uses Material UI Autocomplete to select notes from campaign
- Backlinks computed client-side: notes.filter(n => n.linkedNoteIds.includes(currentNoteId))
- Display shows both "Linked notes" (outgoing) and "Referenced by" (incoming/backlinks)
- Links shown as clickable cards below editor, hidden during note creation
- All existing tests pass without modification
- Key files: apps/api/src/note-store.ts, apps/web/src/App.tsx, both types.ts


## 2026-04-13: Issue #24 Campaign Note Search

Added client-side search functionality for campaign notes in apps/web/src/App.tsx:
- Search input with Material UI v9 slotProps for start/end adornments
- Search filters notes by title, body, tags, session name, and collaborator display names
- Search combines with existing tag filters using AND logic
- Search state clears when starting new notes to avoid confusion
- Heading and description dynamically update to show active search and result counts
- No backend API changes needed - fully client-side implementation
- All existing tests pass (26 tests)

Key patterns:
- Keep search close to filter logic in filteredNotes useMemo
- Use case-insensitive substring matching for user-friendly search
- Clear search along with other filters when entering create mode
- Use slotProps.input for TextField adornments in MUI v9
