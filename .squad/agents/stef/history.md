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

### Origin Architecture (2026-04-13)

- **API origin handling is already parameterized.** Single source of truth is `VITE_API_BASE_URL` in `apps/web/src/api.ts:31-32`; all 50+ API calls use this base. Falls back to `http://localhost:3001` in dev.
- **Token strategy is safe for split origins.** Auth tokens live in localStorage and are sent explicitly via `Authorization: Bearer {token}` headers—no cookies, no `credentials: 'include'`, so no same-origin leakage risk.
- **No hardcoded origins anywhere in React code.** No `window.location`, `location.origin`, or same-origin checks in component code, state management, or routing logic.
- **Shared routes already param-driven.** The `createFrameAncestorsPlugin` in `apps/web/vite.config.ts:11-65` makes API calls from the dev server middleware using the same `apiBaseUrl` pattern, then sets CSP headers dynamically.
- **Frontend is ready for split-origin deployment.** No code changes needed. Backend must configure CORS headers; deployment must set `VITE_API_BASE_URL` to the split API origin during build.
- **Client-side routing has no origin deps.** Share routes are parsed from pathname (`getShareTokenFromPath`) and navigation is explicit (`window.location.assign`), so no assumptions about URL scheme or host.

### Initial squad setup complete.
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

📌 Team update (2026-04-13T15:58:35Z): Issue #24 campaign note search UI approved for merge after handling web test infrastructure blocker; Stef's original implementation was sound, rejection was due to pre-existing vitest hang (Data confirmed via parent commit comparison); Data created regression test coverage (CampaignSearch.test.tsx, 333 lines, 6 tests), Chunk approved despite test infrastructure hang — decided by Data (investigation), Chunk (re-review)

## 2026-04-13T16:07:01Z
📌 Team update: Issue #30 third revision completed by Mikey (Lead) with frontend defensive coding fix. Issue now approved and ready to merge. Stef's initial frontend implementation (pass 1) was foundation for solution.

📌 Team update (2026-04-13T18:14:27Z): UX feedback review completed—phased notes UX roadmap approved (compact header + editor + inline references), Lexical editor recommended over TipTap for markdown-native alignment, backend data model strategy for qualified references finalized — decided by Mikey (Product), Stef (Frontend), Data (Backend)

## 2026-04-13: Phase 2 Frontend Inspection & Recommendation

### Current State Assessment

**Markdown Sanitization (excerpts):**
- ✅ Mature: `excerpt()` → `markdownToPlainText()` already strips all markdown syntax (headings, lists, emphasis, code, links, blockquotes)
- ✅ Safe: HTML tags stripped via `/<[^>]+>/g`; escaped chars unescaped; whitespace collapsed
- ✅ UX: Falls back to friendly "No details yet" message for empty notes
- No API changes needed; pure client-side, reusable in note rows/activity/backlinks

**Editor (formatted + raw markdown):**
- 🔴 Unimplemented: Plain `<textarea>` with stacked preview
- 🔴 Friction: Preview always visible; no toggle; forces vertical scrolling
- 🟡 Recommendation: Phased approach (2a, 2b, 2c)
  - 2a (1–2d): Add mode toggle, hide preview by default → immediate UX win
  - 2b (4–5d): Lexical editor with markdown import/export → markdown-native editor behind existing API
  - 2c (2–3d): Inline reference nodes (`![[id|label]]`) + reference picker → first-class inline references
- Lexical chosen over TipTap because:
  - Backend already stores markdown; `react-markdown` renders it
  - Lexical keeps markdown canonical (no format conversion)
  - Custom node system cleanly supports inline references without inventing a second document format
  - Raw-markdown mode easy to build (toggle `contentEditable`)

**Inline Note References + Discovery:**
- ✅ Phase 1 complete: `linkedNoteIds: string[]` in schema (Issue #30 approved/merged)
- ✅ Backlinks computed client-side: `notes.filter(n => n.linkedNoteIds.includes(currentId))`
- ✅ UI in place: Linked notes + Referenced by cards shown below editor
- 🟡 Gap: References not embedded in markdown body; live in separate field
- Recommendation: Phase 2 embeds references in markdown as `![[noteId|label]]` syntax
  - Phase 2: Editorial syntax only; no schema changes needed
  - Phase 3: Backend extracts structured references for rename safety + graph queries
  - Search naturally discovers inline references via body text (no special query syntax)

### Code Quality Patterns

- `excerpt()` at line 331 is the source of truth for body preview
- `linkedNoteIds` editor at line 3618–3638 uses Material UI Autocomplete (reusable pattern)
- Backlinks section at line 3720+ is clean, shows both directions (outgoing + incoming)
- Reference nodes below editor use clickable cards (low-friction navigation)
- No existing tests for excerpt sanitization; regression coverage needed for Phase 2
- In `apps/web/src/App.tsx`, keep the sticky campaign header in its own desktop flex wrapper so logo alignment changes do not pull the campaign context out of the top-right position; let the wrapper stack naturally on mobile.

### Key Decisions for Phase 2

1. **Markdown is the canonical format.** Don't convert to AST or a second format; Lexical just makes editing it nicer while keeping the wire format unchanged.
2. **Keep the API contract.** `body: string` stays; no schema additions until Phase 3 (structured references).
3. **References in markdown, not metadata.** `![[noteId|label]]` is a semantic markdown extension, not a separate `linkedNoteIds` field (Phase 3 optimizes via extraction).
4. **Mode toggle ships first.** Hide the stacked preview, ship immediately (1–2d), validate the rhythm before Lexical integration.
5. **Client-side backlinks.** Backlinks computed by parsing body for `![[noteId` patterns; stays local until Phase 3 indexing.

### File Locations (Phase 2 touchpoints)

- Editor form: `apps/web/src/App.tsx:3655–3682` (body TextField + preview)
- Editor state: `apps/web/src/App.tsx:91–98` (NoteDraft interface)
- Excerpt function: `apps/web/src/App.tsx:331–343`
- Note list rows: `apps/web/src/App.tsx:3432–3498` (using excerpt)
- Activity feed: `apps/web/src/App.tsx:3244–3309` (using excerpt)
- Linked notes display: `apps/web/src/App.tsx:3720–3790` (cards below editor)
- Markdown sanitization: `apps/web/src/note-formatting.tsx:11–38` (reusable)
- Current package: `apps/web/package.json` (needs `lexical` + `@lexical/markdown` for Phase 2b)

### Regression Coverage Needed

Phase 2 additions should test:
- RT1: Mode toggle preserves draft state (show/hide preview doesn't clobber body)
- RT2: Lexical import/export (load markdown → edit → save → reload → byte-identical)
- RT3: Raw-markdown view matches source (toggle shows unformatted text)
- RT4: Reference picker inserts syntax correctly
- RT5: Backlinks update on save (if note A adds `![[B]]`, B's backlinks panel refreshes)
- RT6: Excerpt sanitizes `![[id|label]]` to plain text (safe in rows/activity)
- RT7: Search finds inline references (typing note title matches both title note + all notes that reference it)

### Integration Points

- **Mikey (Product):** Phased order (2a → 2b → 2c) locks scope; confirm timeline before Phase 2a ships
- **Data (Backend):** Phase 2c has optional backend validation for `![[...]]` syntax; Phase 3 needs `references` schema + extraction logic
- **Chunk (QA):** Regression coverage plan in decision file; test import/export round-trips + backlink staleness
- **Copilot:** May handle Phase 2a (mode toggle) while Stef plans Phase 2b architecture


## 2026-04-13: Phase 2 Frontend — Editor & Inline References Planning

📌 **Orchestration complete:** Stef inspected frontend architecture for Phase 2 implementation (editor modes, inline references, markdown sanitization).

**Outcome:**
- ✅ Markdown sanitization (excerpts): **Ready to ship** — current `excerpt()` + `markdownToPlainText()` are solid; no changes needed
- 🔴 Dual-mode editor: **Requires implementation** (phased: 2a toggle 1–2d, 2b Lexical 4–5d, 2c inline refs 2–3d)
- 🟡 Inline references: **Designer + implementation** — editor syntax embedding + Phase 3 backend extraction

**Key decisions:**
- Keep markdown canonical (no format conversion, Lexical imports/exports markdown)
- Use `![[noteId|label]]` syntax for inline references embedded in body
- Phase 2a: Mode toggle (quick win) → Phase 2b: Lexical editor (markdown-native) → Phase 2c: Custom reference nodes + picker
- No API contract changes Phase 2 (references stay in body until Phase 3 structured extraction)

**Phase 2a ready to start immediately.** Stef or Copilot can begin mode toggle implementation (1–2 days).

📌 Team update (2026-04-14T16:17:28Z): Authenticated workspace header alignment shipped in `apps/web/src/App.tsx`; desktop now keeps the logo left and campaign header right, while mobile stacks the shell header more cleanly without changing the authenticated workspace structure — implemented by Stef

- Authenticated workspace header layout in `apps/web/src/App.tsx` should keep brand and campaign context as separate responsive groups: horizontal split on desktop, clean vertical stack on smaller screens.
- In `apps/web/src/App.tsx`, preserve real sticky behavior by keeping the authenticated campaign card outside the short shell-header row; desktop can still align logo left and campaign context right with a separate wrapper.
- In `apps/web/src/App.tsx`, keep the standalone D&D Notes brand pill desktop-only so the owner workspace mobile header reads as one straight sticky surface while desktop retains the split logo/card composition.
- In `apps/web/src/App.tsx`, extend the owner workspace compact selector-plus-icon sticky header through `md` so phones and narrow desktop panes share the same short header mode before the full desktop header returns.
- Shared campaign route polish in `apps/web/src/SharedCampaignRoute.tsx` should keep the mobile hero compact and let action controls stack before quick-capture content can force horizontal overflow.
- In `apps/web/src/SharedCampaignRoute.tsx`, mobile shared headers can swap the tall action panel for a compact inline action block below `md` to cut hero height without affecting desktop layout.
- When owner and shared routes reuse the same workspace surface, keep every flex pane shell on `minWidth: 0` and avoid intrinsic editor widths so narrow-screen editor mode cannot push the page wider than the viewport.

📌 Team update (2026-04-14T17:15:07Z): Shared-link users now render through the same workspace shell structure as the main app; access/login state controls viewer/editor gating, guest versus linked-collaborator bootstrap, and owner-only controls inside the unified surface — implemented by Stef

📌 Team update (2026-04-14T17:28:20Z): Shared campaign note rows in `apps/web/src/SharedCampaignRoute.tsx` now match the owner workspace compact note-row layout, replacing the older large-card treatment with the same title/excerpt/session-left plus status/updated-right structure — implemented by Stef

📌 Team update (2026-04-14T17:42:26Z): Shared owner/editor mode no longer overflows horizontally on narrow screens after constraining the common workspace pane shells and editor width behavior across the shared and authenticated workspace surfaces — implemented by Stef
📌 Team update (2026-04-16T15:30:33Z): Origin-model audit completed. Frontend ready for split-origin deployment. Backend: add PUBLIC_WEB_ORIGIN env var to buildSharedUrl(). Platform: same-origin reverse proxy recommended for prod. — decided by Stef, Data, Brand, Mikey

## 2026-04-11: First App.tsx Refactor Slice for Issue #44

**Context:** Working in dedicated worktree at `/home/appuser/.copilot/session-state/aba00af1-b083-4cbb-9c94-a20ed4147108/files/worktrees/44-app-shell-refactor` on branch `squad/44-app-shell-refactor`.

**Chosen Seam:** Note editor action toolbar — the save/delete buttons with timestamp display at the bottom of the note editor panel.

**What I Extracted:**
- Created `apps/web/src/NoteEditorActions.tsx` with the full presentation layer for save/delete actions
- Moved the two-stack layout (info text + button group) into a focused component
- Kept `formatTimestamp` helper local to the new component (no shared util file needed yet)
- Props surface: `canEditWorkspace`, `isCreating`, `isSaving`, `isDeleting`, `selectedNoteUpdatedAt`, `onSave`, `onDelete`
- All action handlers and state management remain inside `App.tsx`

**Validation:**
- `npm run lint:web` — passed
- `npm run test:web` — all 32 tests passed (6 test files)
- Line count reduced from 4670 to 4635 lines in `App.tsx`

**Learnings:**
- The note editor toolbar was a clean extraction boundary — pure presentation with minimal coupling
- Passing `selectedNote?.updatedAt` as an optional string instead of the full note object kept the component lightweight
- No Material UI theme or custom styling needed beyond what was already inline
- Tests didn't break because the component behavior stayed identical from the user's perspective

**Recommended Next Slices (in priority order):**
1. **Campaign form UI** — extract the create/edit campaign modal with its form state wiring
2. **Share link management panel** — extract the share link creation, reveal, and revoke UI from the admin/sharing section
3. **Session browse pane** — extract the session list/selection UI from the notes browse mode

**Architecture Insight:**
The key to safe App.tsx refactoring is lifting only the presentation boundary while keeping event handlers and state hooks inside `App.tsx`. This avoids cascading rewrites to prop threading or context wiring. Once enough presentation boundaries are extracted, we can consider lifting state into custom hooks.

**Commit:** `7bf3b6c` — `refactor(web): extract note editor actions toolbar #44`

---

## Issue #44 Session Summary (2026-04-16T21:54:33Z)

📌 **Status:** Completed and ready for merge

Completed the `NoteEditorActions.tsx` extraction as a low-risk, mechanical component extraction. The toolbar now lives in a separate, memoizable component that maintains 100% behavioral parity with the original inline JSX in `App.tsx`.

- **Files changed:** Created `apps/web/src/NoteEditorActions.tsx`, updated `apps/web/src/App.tsx` to import and use the new component
- **Validation:** `npm run lint:web` ✅, `npm run test:web` ✅
- **Regression risk:** Zero—extraction preserves all event handlers, icons, tooltips, and conditional rendering
- **Next opportunity:** Similar extraction pattern applies to campaign form, share-link management, and session browse UI
