# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Chunk initialized as Tester for the initial project squad.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.

📌 Team update (2026-04-12T13:32:51Z): Validated regression coverage for SQLite startup fix—confirmed legacy-schema bootstrap path now covered in tests; full test/build/lint pass — decided by Data, Chunk

📌 Team update (2026-04-12T14:38:40Z): Campaign share links stay as reusable single links with owner-only on-demand reveal; listings stay metadata-only and legacy hash-only links must be revoked/recreated to become revealable again — decided by FFMikha (via Copilot), Mikey, Data, Stef, Chunk

📌 Team update (2026-04-12T17:35:41Z): Issue #27 backend revision approved; frontend UI slice approved; both ready to merge; session browsing thin slice complete (two-step flow, numeric sort, no redesign) — decided by Chunk (reviewer), Stef (implementer)

## Learnings

- Initial squad setup complete.
- `apps/api/src/note-store.ts` owns SQLite bootstrap for the local DB at `apps/api/data/dnd-notes.sqlite`, so backward-compatible schema changes need in-place startup upgrades instead of relying on `CREATE TABLE IF NOT EXISTS`.
- Regression coverage for legacy SQLite compatibility now lives in `apps/api/test/app.test.ts`, where a pre-attribution `notes` table is created and reopened through `createNoteStore()` to confirm legacy notes still load with null attribution.
- Share-link reveal QA passed across `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/api/test/app.test.ts`, and `apps/web/src/App.test.tsx`; root validation remains `npm run lint && npm run test && npm run build`.
- Regression coverage now explicitly checks that owner share-link list responses stay metadata-only, the owner-only reveal endpoint returns `{ token, url }`, and legacy hash-only links surface the regenerate-by-revoking guidance instead of silently failing.
- User-facing limitation to remember: only share links created after plaintext token storage can be revealed again; older links must be revoked and recreated.
- Issue #20 QA hotspot: note attribution is resolved by joining live `campaign_memberships` rows, so guest-upgrade work must keep the same membership row/id and avoid silently rewriting `display_name` or `role` unless retroactive history-label changes are explicitly intended; review `apps/api/src/note-store.ts` and extend `apps/api/test/app.test.ts` around claim coverage.
- Issue #20 reviewer trap: authenticated campaign access is still owner-only in `apps/api/src/app.ts` and `apps/api/src/note-store.ts`, so linking a guest membership to a real account is incomplete unless the claimed user can actually load the campaign and keep future note edits attributed to that same membership.
- Same-browser claim coverage should exercise guest-token proof and cleanup across `apps/web/src/SharedCampaignRoute.tsx`, `apps/web/src/api.ts`, and `apps/web/src/App.test.tsx`, including clearing or invalidating the stored guest token after a successful link.
- Issue #20 review result: the claim path in `apps/api/src/note-store.ts` currently keeps `campaign_memberships.guest_token_id` after linking `user_id`, and `getGuestMembershipByToken()` still accepts that token, so the old guest token remains a valid anonymous backdoor after claim.
- Current regression coverage in `apps/api/test/app.test.ts` and `apps/web/src/App.test.tsx` proves the membership ID/history stay stable, but it also bakes in the wrong post-claim behavior by continuing to use the pre-claim guest token successfully; root `npm run lint && npm run test && npm run build` still passes with that gap.
- Re-review for issue #20: guest-token rotation is now fixed and covered, but a successfully claimed account still cannot use authenticated campaign routes because `apps/api/src/note-store.ts` only treats `role = 'owner'` memberships as accessible. Repro after claim: `GET /api/campaigns` returns zero campaigns, `GET /api/campaigns/:campaignId` returns 403, and `GET /api/overview` returns `No owned campaigns are available.` despite the membership being linked to the account.
- Final gate for issue #20 passed: `apps/api/src/app.ts` now routes authenticated campaign/overview/note access through linked memberships while keeping owner-only management endpoints owner-gated, `apps/api/src/note-store.ts` rotates the claimed guest token so the stale token no longer authenticates shared workspace requests, and regression coverage in `apps/api/test/app.test.ts` plus `apps/web/src/App.test.tsx` now proves claimed collaborators can reopen the linked campaign, keep workspace selection persisted, and preserve original guest-membership attribution; `npm run lint && npm run test && npm run build` all passed in the review worktree.
- Issue #27 review trap: `apps/api/src/app.ts` declares `/api/notes/:noteId` before `/api/notes/sessions`, so `GET /api/notes/sessions` is shadowed as note ID `"sessions"` and always 404s before the new handler runs.
- Session-name route safety for issue #27: Express already decodes `:sessionId`, so the extra `decodeURIComponent()` in `apps/api/src/app.ts` turns valid names like `50% done` into a 500 `URIError`; review path-param features against literal `%` coverage.
- Session browsing regression gap: the new `/api/notes/sessions/:sessionId` endpoint is owner-scoped through `resolveOwnedCampaign()` even though authenticated note access elsewhere now uses linked-membership scoping, and `apps/api/test/app.test.ts` adds no coverage for the new session endpoints at all.
- Issue #23 backend review: `apps/api/src/app.ts` and `apps/api/src/note-store.ts` gate membership consolidation to owner access and scope both memberships to the campaign before rewriting note attribution IDs, and the SQL update preserves note bodies/timestamps by touching only attribution columns. The current regression coverage in `apps/api/test/app.test.ts` only exercises happy-path consolidation plus role-mismatch confirmation, so owner-only and cross-campaign rejection paths still need explicit tests before this slice is safe to approve.
- Issue #23 re-review passed: `apps/api/test/app.test.ts` now adds the missing regression gates by proving a claimed non-owner still gets `403` on both preview and apply for `/api/campaigns/:campaignId/memberships/consolidations`, while foreign-campaign membership IDs return the campaign-scoped `404` errors. Full repo validation (`npm run lint && npm run test && npm run build`) stayed green, so the attribution-only consolidation slice is now ship-safe.
- Issue #27 approval gate: the backend session-browsing slice is ship-safe only when `apps/api/src/app.ts` keeps `/api/notes/sessions*` ahead of `/api/notes/:noteId`, consumes `request.params.sessionId` without manual decoding, and reuses `resolveAccessibleCampaign()` so claimed collaborators match authenticated note access; `apps/api/test/app.test.ts` now covers both percent-encoded names and claimed-collaborator access, and root `npm run lint && npm run test && npm run build` passed on the approved revision.
- Session-browser state in `apps/web/src/App.tsx` must stay out of the auth bootstrap callback dependency chain; when `loadWorkspace()` depends on `noteBrowseMode`, clicking `All notes`, `Browse by session`, or `New note` re-runs the workspace bootstrap, flashes the full-screen loader, and can overwrite unsaved draft/create-note state.
- Session drill-in in `apps/web/src/App.tsx` needs stale-response protection (request cancellation or a latest-selection guard) because overlapping `fetchSessionNotes()` calls can paint the wrong note list under the currently selected session heading. Add regression coverage for mode toggles, create-note reset from session mode, and out-of-order session responses in `apps/web/src/App.test.tsx`.
- **Issue #28 strategy drafted:** Tag autocomplete + tag browsing are frontend-only and reuse existing `tags_json` without backend changes. Three critical UX traps: (1) campaign-scope bleed (multi-campaign users seeing cross-campaign tags), (2) issue #27 regression pattern (tag filter state must NOT trigger workspace reload), (3) stale-response race (rapid tag clicks must show latest selection). Count accuracy under concurrency is critical; counts are computed fresh per request (no caching). Multiple-tag filter must use AND logic and always show active filter list. Empty states need CTA copy, not blank panes. Test matrix includes autocomplete suggestions, facet counts, state persistence across note edits, and orthogonality to session browsing. Key files: existing `apps/api/src/note-store.ts` (tag extraction), `apps/web/src/App.tsx` (browse UI + filter state), `apps/web/src/App.test.tsx` (regression coverage). Full acceptance/regression target list written to `.squad/decisions/inbox/chunk-issue-28.md`; awaiting FFMikha's product sign-off on tag normalization, filter logic (AND/OR), autocomplete trigger, facet sort order, empty-state copy, and count staleness window.
- Issue #28 re-review correction: in `apps/web/src/App.tsx`, tag filtering currently narrows `displayedNotes` only; `selectedNote` and the editor draft still follow `selectedNoteId` against the full `notes` array. Any local facet/filter UI must retarget or clear the detail pane when the active record falls out of the filtered result set. Key paths: `filteredNotes`, `displayedNotes`, `handleSelectTagFilter`, and regression coverage in `apps/web/src/App.test.tsx`.
- Issue #25 mobile layout landed as a responsive master/detail pattern: `apps/web/src/App.tsx` keeps the split browse+editor workspace at `theme.breakpoints.up('lg')`, but below that it swaps to a single-pane `browse`/`editor` toggle so phones stop carrying a permanently fixed split layout. Regression coverage in `apps/web/src/App.test.tsx` now uses `setViewportWidth()` to prove three gates: desktop still shows list + editor together, narrow screens can open/edit/save an existing note without losing the list, and tapping `New note` on narrow screens jumps straight into the editor with the save path still available. Root validation stayed `npm run lint && npm run test && npm run build`.

- Web regression coverage is healthiest when apps/web/src/App.test.tsx stays a tiny smoke suite (auth shell, happy-path workspace load, saved-session restore) and feature-specific behavior moves into focused files like apps/web/src/CampaignSearch.test.tsx; the previous all-in-one App suite was the unstable surface.
- Campaign search acceptance now needs explicit checks for every supported search axis in apps/web/src/CampaignSearch.test.tsx: title, body, tags, session names, collaborator names, plus reset behavior when clearing search or starting a new note.

## 2026-04-13: Issue #24 Search Acceptance & Regression Prep

**What:** Drafted comprehensive QA strategy for campaign note search (text + tag/session/member filters) and completed preliminary code review of in-progress implementation.

**Key Risks Identified:**
1. **Cross-campaign bleed** (RT4): Multi-campaign users seeing notes from inactive campaigns
2. **Workspace reload loop** (RT1): Search state triggering bootstrap re-run (issue #27/28 pattern)
3. **Stale response race** (RT2): Overlapping requests painting wrong results (issue #27 pattern)
4. **Selected note visibility** (RT3): Active note falling out of filtered results (issue #28 pattern)
5. **Empty state handling** (RT5): Zero results showing blank pane instead of helpful message

**Acceptance Priorities:**
- P0 (blocking): Campaign scoping, collaborator access, no reload loop, mobile render
- P1 (pre-merge): Stale response guard, selected note sync, empty states, special char safety
- P2 (follow-up): Unicode support, 1000+ note performance, URL state persistence

**Open Product Decisions:**
- Empty query behavior (all notes vs zero results)?
- Filter logic (AND vs OR for multiple filters)?
- Case sensitivity for text search and filters?
- State persistence strategy (URL vs localStorage vs ephemeral)?
- Create-note behavior from filtered view (inherit filters or clean)?

**Preliminary Code Review (Stef's In-Progress Work):**
- ✅ Filtering logic added to `apps/web/src/App.tsx` with case-insensitive search across title/body/tags/session/members
- ✅ No workspace reload loop — `searchText` not in bootstrap deps
- ✅ AND logic between tag + search filters works correctly
- ⚠️ Missing search UI component (users can't enter search text)
- ⚠️ Missing test coverage (zero regression tests)
- ⚠️ Missing empty state handling (blank pane when no results)
- ⚠️ No selected note retarget logic (RT3 potential regression)

**Review Gates:**
- Approve: All P0+P1 pass, product decisions answered, regression coverage present, UI complete
- Reject: Cross-campaign bleed, reload loop, race condition, zero tests, collaborator broken
- Lockout: Rejected work requires Data (backend) or Stef (frontend) revision, not original author

**Deliverables:**
- Full QA strategy: `.squad/decisions/inbox/chunk-issue-24-qa.md`
- Preliminary review: `.worktrees/24/PRELIMINARY_REVIEW.md`

**Status:** READY — Awaiting completion (UI component + test coverage), then full validation pass.

**Next:** Re-review when implementation signals completion, run `npm run lint && npm run test && npm run build`, approve or reject with evidence.

📌 Team update (2026-04-13): Chunk completed comprehensive acceptance criteria and regression test matrix for Issue #24 (Campaign Note Search). This is prep-only work defining scope, edge cases, and 7 UX blockers requiring FFMikha approval before implementation. AC1–AC7 acceptance criteria + 30+ regression tests (autocomplete, empty state, special chars, concurrent count accuracy, multi-tag AND logic, state persistence, mode-switch orthogonality, #27 regression). Decision: READY FOR PRODUCT SIGN-OFF. Full spec: `.squad/decisions/inbox/chunk-issue-24-acceptance.md`

## 2026-04-12: Issue #27 & #23 Reviews Complete

📌 Team update (2026-04-12T16:45:23Z): Issue #27 session-browsing v1 concept approved, but implementation REJECTED for 4 regressions: (1) route shadowing: `/api/notes/sessions` shadowed as note ID "sessions", (2) double percent-decode crash on names like "50% done", (3) auth regression: endpoints use owner-only scoping, blocking claimed collaborators, (4) missing regression tests. Data assigned backend fixes. Stef to own follow-on UI work after fixes land. Full rejection details in `.squad/decisions.md`.

📌 Team update (2026-04-12T21:22:46Z): Issue #27 backend revision reviewed and approved. Data's fixes pass all regressions: route shadowing resolved, double-decode removed, auth switched to membership-aware access, contracts confirmed reusable. Lint, test, build green. Ship-safe. Issue #23 re-review also approved: Stef's regression coverage now proves non-owner rejection and cross-campaign scoping; consolidation ready to ship. Both decisions finalized in `.squad/decisions.md` — reviewed by Chunk

📌 Team update (2026-04-12T21:44:58Z): CORRECTION — Issue #27 frontend UI REJECTED after re-review. Stef's implementation has four critical state-management regressions: (1) `noteBrowseMode` dependency causes workspace reload on mode toggle, clobbering editor state, (2) create-note drafts lost when workspace reloads, (3) stale-response race on session switch (heading mismatches list/detail), (4) missing regression coverage for mode toggles, create-note reset, and out-of-order responses. Backend remains approved and ship-safe. Revision owner changed to @copilot; Stef locked out of this cycle. Re-approval bar and rejection details finalized in `.squad/decisions.md` — decided by Chunk (reviewer)

## 2026-04-12: Issue #33 Acceptance & Regression Targets Drafted

- Issue #33 adds recent activity views for collaborative campaigns. Goal: help users see "what changed and who did it" without becoming a noisy audit log.
- Three core user flows: (1) recent notes list sorted by `updated_at`, (2) activity filtered by a single collaborator, (3) activity scoped to a specific campaign with membership-aware auth.
- Critical regression risk from issue #27 pattern: activity endpoints will need to use `resolveAccessibleCampaign()` (membership-aware auth), not `resolveOwnedCampaign()` (owner-only), to avoid blocking claimed collaborators.
- Legacy notes with null `created_by_membership_id` are already bootstrapped in regression tests; activity endpoint must handle them gracefully (fallback name, "Unknown", or exclusion — product decides).
- Consolidation (issue #23) affects activity: query current note state (no frozen history table needed); consolidated notes show target membership as author.
- Scope creep risk: the word "activity" is broad. Must define: no full diffs, no per-field audit, no separate event table. MVP is "recent notes with who created/edited them."
- Draft acceptance & regression targets written to `.squad/decisions/inbox/chunk-issue-33.md` with 7+ test cases, auth/scope warnings, and open questions for FFMikha (collaborator-filter privacy, guest access, pagination).
- Key files: `apps/api/src/note-store.ts` stores `created_by_membership_id`, `last_edited_by_membership_id`, plus snapshotted display names; `apps/api/src/app.ts` has the auth/routing pattern to reuse; `apps/api/test/app.test.ts` has legacy bootstrap template.

## 2026-04-12: Issue #33 Backend Slice Review — APPROVED

- **Verdict:** APPROVED. Data's backend slice for `GET /api/notes/activity` meets all acceptance criteria.
- Auth uses `resolveAccessibleCampaign()` (membership-aware, not owner-only) — avoids the issue #27 regression pattern.
- Route ordering is correct: `/api/notes/activity` (line 1094) is registered before `/api/notes/:noteId` (line 1150), avoiding the shadowing bug from issue #27.
- `buildNoteActivity()` derives one activity entry per note from current state; no separate event table needed. Classification uses `updatedAt !== createdAt` which is reliable because `createTimestampAfter()` guarantees monotonic timestamp advancement.
- `buildActivityCollaborators()` aggregates from the full unfiltered activity list (line 1144), so membership filtering narrows activity entries but keeps the complete collaborator sidebar — correct design.
- Null/legacy actor handled gracefully: `buildActivityCollaborators` skips null actors; membership filter uses optional chaining.
- Foreign-membership rejection tested (line 441-444, returns 404).
- Claimed collaborator access tested (line 694-752, proves post-claim activity access with correct attribution).
- `limit` defaults to 20, caps at 50, rejects invalid values with 400. No explicit `limit` test exists, but the parameter parsing is straightforward and type-safe.
- README updated with full query parameter documentation.
- `npm run lint && npm run test && npm run build` all passed (21/21 tests green).
- Minor coverage gap (non-blocking): no test exercises the `limit` param directly or legacy/null attribution notes in the activity list. These are nice-to-haves for a future pass.
- What remains for UI slice: the response contract (`NoteActivityResponse`) is stable and ready for frontend consumption. UI work needs to handle the collaborator sidebar, membership-filter interactions, and empty-state when a campaign has no notes.

## 2026-04-12T22:43:51Z: Issue #33 Backend Slice Review Complete

📌 Review verdict (Chunk): **APPROVED** — Data's issue #33 backend slice is ship-safe.

- ✅ Auth model correct: uses `resolveAccessibleCampaign()` (membership-aware), linked collaborators have access
- ✅ Route ordering safe: `/api/notes/activity` registered before `/api/notes/:noteId`, avoiding issue #27 shadowing
- ✅ Activity classification reliable: `createTimestampAfter()` guarantees `updatedAt` always moves forward
- ✅ Collaborator summaries correct: derived from full (unfiltered) activity, sidebar stays complete
- ✅ Legacy null attribution handled: null actors skipped in summaries, optional chaining in filter
- ✅ Regression coverage: owner + guest activity, collaborator summaries, membership filter, foreign-membership rejection, claimed-collaborator access all tested
- Minor coverage gaps (non-blocking): no explicit test for `limit` param; legacy/null-attribution notes not tested in response
- Frontend/UI slice can be picked up independently against stable `NoteActivityResponse` contract

## 2026-04-12: Issue #28 Frontend Slice Review — APPROVED

- **Verdict:** APPROVED. Stef's tag facets & autocomplete frontend slice meets all acceptance criteria for a thin first slice.
- Tag facets derived from campaign-scoped `notes` array via `sortTagFacets()` — no cross-campaign scope bleed possible because `notes` state is already campaign-scoped.
- Issue #27 regression pattern (workspace reload on mode toggle) does NOT apply: `selectedTag` is NOT in `loadWorkspace` deps, and the tag panel is only rendered when `noteBrowseMode === 'notes'`, so tag clicks never trigger a mode switch from sessions→notes that would cascade through `loadWorkspace→loadCampaigns→bootstrap`.
- Autocomplete uses MUI `Autocomplete` with `freeSolo` + `multiple` + `filterSelectedOptions`; `commitTagInput` on blur prevents lost partial input; `normalizeTagValues` handles comma splitting and case-insensitive dedup.
- Three clear empty states: no tags ("Tags become quick campaign shelves"), filtered tag with no notes ("No notes use the X tag yet"), and no notes at all.
- Self-healing: `useEffect` at line 766 auto-clears `selectedTag` when the tag disappears from facets (e.g., after editing/deleting the last note with that tag).
- Selected note auto-adjusts when tag filter changes the visible list (lines 771–792), avoiding stale editor state.
- Tag filter cleared on campaign switch (`loadCampaigns` line 660), on "All notes" click, and on session browse click. Survives note saves intentionally.
- Regression test covers tag list rendering, tag click filtering, autocomplete reuse, count update after save. Existing tests adapted for new Autocomplete chip model (tag display values → chip text).
- 3 pre-existing test timeouts (onboarding, second campaign, starter pack) confirmed NOT caused by #28 — same tests fail on the commit before Stef's changes.
- Lint, build both green. New test passes consistently.
- Non-blocking gaps for later: case-sensitive tag matching (facets/filter use exact match; mixed-case legacy data could surface separate entries), `handleStartNote` doesn't clear `selectedTag` (minor UX papercut), no multi-tag AND filter yet (deferred to search foundation work).

## 2026-04-13: PR #36 Conflict-Resolution Re-Review — APPROVED (remains merge-ready)

Review verdict (Chunk): **APPROVED** — The conflict-resolution push on PR #36 does not introduce any real regressions. Zero-fetch session browsing coexists safely with quick capture on current main.

**Verified:**
- All 3 new session browsing web tests pass (session list, draft preservation, empty state)
- Quick capture owner test (11th web test) passes
- All 17 API tests pass (including 3 new session listing endpoints)
- PR merge state: MERGEABLE / CLEAN — no conflict markers
- Core zero-fetch behavior confirmed: sessionSummaries and displayedNotes are client-side useMemo derivations from existing notes array, no extra API call on mode toggle
- Quick capture bar coexists in both App.tsx (owner) and SharedCampaignRoute.tsx (guest)
- Template-related code (starter packs, sortSessionSummaries, fetchSessionNotes) properly removed during conflict resolution — no orphaned imports

**Non-blocking observations:**
- "supports creating a second campaign" test timeout is pre-existing on main (confirmed identical failure)
- "guest join flow" web test fails in full-suite run due to state contamination from the preceding timed-out test; passes in isolation (802ms). On main, intermediate template tests buffered the contamination. Not a code regression — a test-ordering hygiene issue that predates this PR.
- PR body claims "30 tests pass (11 web + 19 API)" — actual counts are 11 web + 17 API = 28. Minor inaccuracy in the PR description, not a code issue.
📌 Team update (2026-04-13T00:04:28Z): Issue #27 UI APPROVED & MERGED (2026-04-12T23:19:25Z). After rebase conflict resolution, re-reviewed @copilot's revision. All four rejection criteria successfully retired: (1) browse-mode state isolated from `loadWorkspace` dependency (zero presence in dependency array), (2) draft preservation verified with regression test (full mode-toggle round-trip), (3) stale-response race eliminated by synchronous `useMemo` filter design (no async session switching), (4) comprehensive regression coverage added (3 new web tests + 3 new API tests, all passing). Also validated: 2 pre-existing test failures on main are unrelated. Ship-safe verdict. PR #36 merged on main (`9d0966b`). **Issue #33 (Recent Activity UI) now queued for implementation.** Regression test plan documented (RT1–RT5 gates require your oversight before issue #33 implementation PR approval). Regression gates: (RT1) activity endpoint does NOT trigger workspace reload, (RT2) collaborator filter does NOT shadow route params, (RT3) stale-response race on rapid filter clicks prevented, (RT4) no stale-timestamp confusion between activity and session browsing, (RT5) empty state does NOT regress in shared workspace. Full acceptance criteria and test matrix documented in issue #33 decision. Your review scope: 3+ new web regression tests (mode toggle isolation, draft survival, empty-state safety) + 1 integration test (claimed-collaborator access to activity endpoint). Test patterns from PR #36 suite provide templates. Expected PR delivery: 2-3 days post-merge. See `.squad/orchestration-log/2026-04-13T00:04:28Z-issue-33-ui-handoff.md` for full regression gate context -- reviewed by Chunk (tester)

## Issue #33 UI Slice Review -- APPROVED

- **Verdict:** APPROVED. Stef's issue #33 UI slice meets all acceptance criteria from the earlier review bar.
- All five regression gates (RT1-RT5) are retired:
  - RT1: activity endpoint does NOT trigger workspace reload -- confirmed via per-endpoint request counting in web test
  - RT2: collaborator filter does NOT shadow route params -- filter state uses refs, not callback deps
  - RT3: stale-response race on rapid filter clicks prevented -- abort controllers + monotonic request IDs in loadActivity and handleSelectSession
  - RT4: no stale-timestamp confusion -- activity and session browsing use independent state channels
  - RT5: empty states intact across all modes (campaign-empty, collaborator-filtered-empty, session-empty)
- Membership-aware auth: session routes use resolveAccessibleCampaign() not resolveOwnedCampaign()
- Created/edited attribution: activity entries show createdBy and lastEditedBy with role labels; "last edited by" is conditionally hidden when creator === editor
- Null/legacy attribution: test proves "Created by Unknown" renders for notes without membership metadata
- No bootstrap coupling: noteBrowseMode, selectedSessionName, selectedActivityMembershipId all use ref patterns, absent from loadWorkspace deps
- Quick capture preserved: resets to notes mode before workspace reload
- Backend changes are legitimate rebase incorporations: session route auth fix (issue #27), consolidation (issue #23), duplicate listSessionNames SQL removed
- Lint, build, test all green: 16 web tests + 24 API tests passed
- Non-blocking: the backend GET /api/notes/activity route handler is not in this changeset. The frontend is coded against the approved contract (types defined, web tests mock the endpoint). Data's approved backend slice needs to land for end-to-end functionality.

## 2026-04-13: Issue #24 Acceptance & Regression Targets Drafted

📌 **Issue #24 — Campaign Note Search with Filters**

- **Charter:** Full-featured search UI with multi-filter (title/body text, tags AND logic, session, collaborator) scoped to one campaign at a time. Must integrate cleanly with quick-capture and session-browsing flows now merged; mobile-safe; preserve access model.
- **Approach:** 12 acceptance criteria (search scope, title/body matching, tag AND logic, session filter, collaborator attribution, mobile UX, access control, quick-capture integration, session-browse integration, activity isolation, empty states, performance). 15 regression targets mapping to critical risk zones (campaign scope isolation RT1, state preservation RT2, stale-response race RT3, tag AND logic RT4, null attribution RT5, session filter null-handling RT6, case/partial-word matching RT7, tag count accuracy RT8, mobile layout RT9, activity isolation RT10, create/edit state preservation RT11, guest search RT12, debounce performance RT13, orthogonality with tag facets RT14, plus 10 open product questions).
- **Test matrix:** 15 end-to-end scenarios covering search-only, multi-filter combos, mode toggles, rapid filter clicks, campaign switches, null attribution, mobile, special chars, activity isolation, debounce, guest access.
- **Key risks:** (1) Campaign-scope bleed (search state doesn't reset on campaign switch), (2) issue #27 regression pattern (search state triggers workspace bootstrap reload), (3) stale responses from concurrent filter clicks, (4) tag facet count staleness under filter changes, (5) null/legacy note attribution crashes.
- **Implementation lanes:** Backend optional (product confirms if client-side only or needs new API endpoint); frontend: search input + filter state in App.tsx, debounce logic, result rendering, integration tests.
- **Files:** `apps/web/src/App.tsx` (search + filter UI, state mgmt), `apps/web/src/App.test.tsx` (RT1–RT14 coverage), `apps/api/src/app.ts` + `apps/api/src/note-store.ts` (optional backend search endpoint).
- **Open questions for FFMikha:** Full-text algorithm (client vs. backend), title+body matching (OR vs. AND), tag normalization rules, null attribution display (Unknown / exclude / separate), collaborator filter scope (created_by only or created_by+last_edited_by), session filter null handling, mobile feature parity, guest search enable/disable, debounce delay, search state persistence (localStorage vs. session-only).
- **Full acceptance & regression target list written to** `.squad/decisions/inbox/chunk-issue-24-acceptance.md` (23.2 KB); awaiting FFMikha's product sign-off on open questions before implementation starts.
- **Status:** PREP ONLY — No code changes. Document ready for product review and squad handoff.

## 2026-04-13: Issue #28 Branch Re-review — REJECTED

- **Verdict:** REJECTED. The branch still proves the happy-path wins (local tag facets/counts, visible single-tag chip, editor autocomplete reuse, and no extra workspace fetches), and root `npm run lint && npm run build && npm run test` are green.
- **Ship blocker:** Applying a tag filter can leave the editor focused on a note that is no longer in the filtered list. `filteredNotes`/`displayedNotes` drive the sidebar, but `selectedNote` still resolves from the full `notes` array and `handleSelectTagFilter()` never reselects a visible note or clears edit state.
- **Why this matters:** the UI can say “Notes tagged clue” while the form still edits or deletes an unrelated note like Harbor watch. That is a live-table correctness bug, not a polish nit.
- **Regression gap:** `apps/web/src/App.test.tsx` covers tag counts, local filtering, autocomplete reuse, and no-fetch mode changes, but it never starts from a non-matching selected note before clicking a tag facet, so the list/detail divergence slipped through.
- **Revision routing:** @copilot should revise this slice. Stef is locked out for this revision cycle.

📌 Team update (2026-04-13T07:52:28Z): Issue #28 review verdict finalized and routed to @copilot. Your rejection stands: list/detail mismatch blocker is ship-critical. Decision merged into squad decisions log. You remain the QA gate for the revision. See orchestration logs in `.squad/orchestration-log/` and full verdict in `.squad/decisions.md` — decided by Chunk (reviewer), coordinator rerouted to copilot

## 2026-04-13: PR #37 QA Review — APPROVED

- **Verdict:** APPROVED. The list/detail desync blocker from issue #28 is retired, and PR #37 is ready to come out of draft / merge.
- `handleSelectTagFilter()` now eagerly reconciles the selected note against the next filtered list, so clicking a tag no longer leaves the editor pointed at a hidden note.
- The `displayedNotes` + `selectedTagFilter` effect gives the fix a second safety net when the visible filtered set changes after edits/deletes.
- Regression proof is materially better now: the new test starts from a non-matching selected note, switches to a single-match tag, then to a multi-match tag, then clears the filter.
- Existing tag tests still cover the neighboring behavior that matters for ship-readiness: local facet derivation, no extra workspace fetches, and clearing the active filter when starting a new note.
- Validation rerun was green: root `npm run lint && npm run build && npm run test`, plus targeted web reruns for the two tag-focused regressions.
- Non-blocking hardening follow-up: add a direct regression for editing/deleting the active filtered note while the tag filter remains on, even though the shared sync helper makes the current implementation look safe.

---

## 2026-04-13: PR #37 Merged & Issue #28 Closed

📌 **Coordinator action:** PR #37 approved by QA, moved out of draft, and merged to `main`. Issue #28 closed.

**PR #37 shipping the following:**
- List/detail sync fix via `syncNoteSelectionToVisibleNotes` and immediate reconciliation in `handleSelectTagFilter()`
- Regression coverage verifying editor re-targets when filter excludes the selected note
- Safety net via `useEffect` reconciliation for post-filter note changes
- Tag facets, filtering, autocomplete reuse all now in production

**Why it's safe:**
- The original failure mode (editor pointing at hidden note after filter) is closed by immediate reconciliation
- Filter switching and clearing tested end-to-end
- Full test/lint/build bar passed
- No backend/schema changes, frontend-only scope preserved

**Unblocks:** Issue #24 (search foundation + advanced filters) can now proceed.

## 2026-04-13: Issue #30 — Note Links & Backlinks Test Strategy Drafted

**Status:** DRAFT — awaiting FFMikha approval + implementation

**What I did:**
- Drafted comprehensive test strategy for note-to-note links and backlinks (issue #30)
- Defined 7 acceptance criteria: link creation, backlink discovery, link display, campaign scoping, attribution/access, link lifecycle, cross-feature integration
- Identified 6 DM table trap scenarios that could break the happy path mid-session
- Technical edge cases: self-links, duplicate links, link format/ordering, bulk operations, empty states
- Performance and concurrency traps: 500+ notes, stale backlink counts, concurrent link creation, delete races
- Integration regression matrix (issue #27 pattern): workspace reload on link creation, draft loss, stale-response race, mode-switch safety, tag filter interaction
- Open questions for FFMikha: link creation UX, display location, backlink label, archive behavior, link ordering policies
- Regression test matrix: 8 backend tests, 12 frontend tests, 5 cross-feature tests
- Ship-gate criteria: 7 AC pass, 12+ regression tests green, full lint/test/build bar, FFMikha UX approval, zero issue #27 pattern regressions

**Key files referenced:**
- apps/api/src/note-store.ts — data model and SQLite schema (will need link table or field)
- apps/api/src/types.ts + apps/web/src/types.ts — API contracts for links
- apps/web/src/App.tsx — link UI and navigation (must NOT trigger workspace reload)
- apps/api/test/app.test.ts + apps/web/src/App.test.tsx — regression coverage

**Decision written:** .squad/decisions/inbox/chunk-note-links-backlinks.md

**Why this matters:**
- Issue #30 is a core relational navigation feature that DMs will rely on mid-session
- The link chain and circular reference traps are real D&D usage patterns (NPCs, quests, factions)
- Issue #27 regression pattern (workspace reload, draft loss, stale-response race) applies here
- Link lifecycle (deletion, archiving) must be rock-solid or DMs lose trust in the data integrity
- Guest access + link permissions need explicit coverage (viewer vs. editor, cross-campaign scoping)

**Next step:** FFMikha to approve UX decisions (link creation flow, backlink label, etc.). Stef (or other implementer) to code with Chunk approval gate on the regression matrix.

**Baseline validated:** npm run lint && npm run test && npm run build all green (21/21 tests passing, 130s runtime).

## 2026-04-13: Issue #30 Implementation REJECTED

**Verdict:** REJECTED — 21 of 42 tests broken, 0 of 7 acceptance criteria fully met

**Critical regressions found:**
1. **Legacy database bootstrap crash:** mapNoteRow() tries to parse undefined linked_notes_json, breaking SQLite upgrade path. Violates backward-compatibility pattern from issue #20. Affects 3 tests.
2. **Validation schema missing linkedNoteIds:** noteCreateSchema and noteUpdateSchema in apps/api/src/validation.ts do not include the new field. All note create/update endpoints return 500. Affects 18 tests.
3. **Backlink discovery not implemented:** AC2 requires "when viewing note B, users can see that note A links to it." Current implementation only stores forward links (linkedNoteIds on note A), no backlink query or UI exists.
4. **Zero regression test coverage:** No tests for cross-campaign link rejection, delete/archive lifecycle, guest permissions, self-links, duplicate links, or workspace reload trap.
5. **Frontend workspace reload risk:** New Autocomplete widget for links updates draft state; must verify it does NOT trigger loadWorkspace() re-run (issue #27 pattern).
6. **No empty state handling:** Backlink UI missing entirely.

**Test results:**
- Before: 21/21 passing
- After: 21 failures (10 web + 11 API)
- Build: passes
- Lint: passes
- Tests: FAILED

**Acceptance criteria status:** 0/7 fully met. AC1 blocked by validation bug, AC2 not implemented, AC4-AC7 untested.

**Blocking fixes required:**
1. Fix mapNoteRow() to handle undefined linked_notes_json (default to [])
2. Add linkedNoteIds to validation schemas in apps/api/src/validation.ts
3. Implement backlink discovery (compute reverse links from linkedNoteIds)
4. Add 6+ regression tests (cross-campaign, guest permissions, lifecycle)
5. Add workspace reload regression test (RT-F1)

**Reviewer lockout:** Stef locked out per charter. Recommend copilot or Data for backend fixes, then Stef can return for backlink UI in follow-on PR.

**Decision written:** .squad/decisions/inbox/chunk-issue-30-rejection.md

**Next step:** Coordinator to assign new agent for blocking fixes. Re-review after all tests green.

- Issue #24 review rejected due to web test infrastructure failure (vitest hangs on first test, pre-existing issue not caused by this commit); search implementation looks correct by code inspection (client-side filtering with proper state management, no reload loops, campaign-scoped), but zero automated coverage violates team quality bar; assigned revision to Data for test infrastructure diagnosis and repair, then add search regression tests.

📌 Team update (2026-04-13T15:58:35Z): Issue #24 campaign note search second review approved for merge despite web test infrastructure hang; first review correctly rejected due to missing test evidence (fair criteria at the time); re-review approved after Data proved test hang is pre-existing (vitest 4.1.4 + React 19 + MUI 9 incompatibility affects parent commit 7dec493); Data provided regression test coverage (CampaignSearch.test.tsx), lint/build/API-tests all pass — decided by Chunk (reviewer), Data (investigator)

## 2026-04-13T16:07:01Z
✅ Issue #30 final gate approved: Validated Mikey's third revision with 49 passing tests, clean build/lint. All four frontend crash points fixed. Backend layer stable. Issue ready to merge. Decisions merged to squad/decisions.md and orchestration logs recorded.

## 2026-04-14: Web Test Infrastructure P1 — Scope & Reviewer Gate Approval

📌 Team update (2026-04-14T15:52:31Z): Web test infrastructure cleanup approved by Mikey (Lead) as a scoped investigation into vitest 4.1.4 hang + fallback path (downgrade or skip App.test.tsx); Brand to lead investigation + CI wiring, Chunk to validate fallback option. Root scripts in `package.json` fix the workspace-path bug in `.github/workflows/web-test.yml`. Decision merged to `.squad/decisions.md`. — Scribe

## 2026-04-16: Issue #44 Advisory Review Session

📌 **Status:** Issue #44 App Shell Refactor completed

Conducted advisory QA review for Stef's `NoteEditorActions.tsx` extraction work. Extracted toolbar is low-risk: stateless button container with prop-based event callbacks. Identified test seams and recommended regression coverage strategy.

- **Validation gates identified:** Button click handlers, icon/label consistency, conditional rendering, accessibility (aria-label, tooltips, keyboard focus)
- **Recommended test file:** `apps/web/src/NoteEditorActions.test.tsx` with focused unit tests for each button's click handler and conditional rendering based on note state
- **Memoization opportunity:** Component is a good candidate for `React.memo()` to prevent re-renders when parent App updates unrelated state
- **Risk assessment:** Zero behavioral changes; extraction preserves all existing behavior and event handling
- **Ready for merge:** Lint/build/test all pass; no regressions detected

## 2026-04-18: Phase 0 Test-Readiness Analysis (Epic #42)

**What:**
Drafted comprehensive test-readiness analysis for Phase 0 of epic #42 (containerization + single-tenant Kubernetes). Analyzed three slices (#52 containerization, #43 artifact tracking, #46 Postgres porting) against platform decisions locked on 2026-04-18 and identified minimal acceptance gates, parallel prep work, and riskiest regressions for Phase 1 transition.

**Key Findings:**

1. **Phase 0 Entry Gates (7 acceptance checks):**
   - Container image reproducibility and K8s-readiness (docker build, `docker run`, health checks)
   - Runtime environment contract documentation (PORT, POSTGRES_URL fallback to SQLite)
   - Health/readiness probe semantics (liveness vs. readiness distinction is load-bearing for K8s lifecycle)
   - Postgres backend + async adapter (node-postgres) swap from SQLite
   - Local SQLite fallback seamless for `npm run dev` (POSTGRES_URL absent)
   - Schema forward-compatibility (preps for Phase 1 auth columns per decision #9: keycloak_sub)

2. **Parallel Prep Tracks (can start before implementation):**
   - T1: Containerized test suite (docker-compose.test.yml, runs full npm test in-container)
   - T2: K8s manifest validation harness (kubeval/kube-score against Kustomize/Helm scaffolds)
   - T3: Health/readiness probe spec + integration tests (readiness guard semantics)
   - R1–R7: Regression scenarios for pod lifecycle, storage isolation, graceful shutdown, connection pool exhaustion, migration idempotence, auth persistence, schema compatibility

3. **Riskiest Phase 1 Blockers (watch early):**
   - Pod identity & storage isolation (PVC label selectors must not cross-leak; security context) — **CRITICAL**
   - Graceful shutdown under load (SIGTERM draining, Postgres connection closure before K8s kill) — **HIGH**
   - Liveness vs. readiness probe semantics (K8s KILL vs. LB REMOVE decision) — **HIGH**
   - Connection pool exhaustion during rolling updates (size tuning, idle cleanup) — **HIGH**
   - Schema migration idempotence & rollback safety (IF NOT EXISTS guards, version tracking) — **HIGH**
   - Auth state persistence across pod restarts (tokens in DB, not memory) — **MEDIUM**
   - Postgres schema changes don't crash app startup (defensive code, pre-migration hooks) — **MEDIUM**

**Why It Matters:**
Phase 1 (#53 control plane, #54 provisioning, #55 rolling updates) depends heavily on Phase 0 assumptions about container health, storage isolation, and graceful shutdown. Early identification of these regressions and parallel test harness prep will accelerate Phase 1 validation and reduce cascading failures during multi-tenant provisioning and rolling-update choreography.

**Decision Impact:**
- FFMikha can prioritize team members for parallel test infrastructure (Brand → K8s manifests, Data → connection pool load testing)
- Implementation teams (#52, #43, #46) know exactly what acceptance gates to target before shipping
- Chunk's QA gates are defined upfront; no surprise quality escalations mid-phase
- Decision document (chunk-phase0-checks.md) lives in .squad/decisions/inbox/ for Scribe to merge into shared decisions.md

**Files Created:**
- `.squad/decisions/inbox/chunk-phase0-checks.md` — 450-line comprehensive test-readiness plan for Phase 0

**Status:** DRAFT — Ready for FFMikha product sign-off and team feedback before implementation starts

## 2026-04-19: Issue #53 Control-Plane Skeleton APPROVED

**Verdict:** ✅ **APPROVE** — PR #59 ready to merge

**Validation results:**
- All 15 tests pass (comprehensive CRUD + state transitions + validation)
- Lint clean across all workspaces
- Build succeeds (TypeScript compilation error-free)
- All acceptance criteria met

**7-State Lifecycle Model Validation:**
 Matches epic #42 locked decisions exactly:
```
provisioning → ready ⇄ maintenance ⇄ upgrading
                ↓          ↓           ↓
              ready    restoring    ready
                ↓          ↓
              failed    failed
                ↓
          deprovisioned
```
- Type-safe state contract in types.ts with TenantState union
- DB constraints enforce valid states
- State transitions properly logged in audit table

**Tenant Registry Model Validation:**
 All required fields present per issue #53 requirements:
- id, slug (DNS-safe validation), ownerId
- desiredState / currentState (explicit desired vs observed pattern)
- version, storageReference, backupMetadata
- createdAt / updatedAt timestamps
- Unique constraints on id and slug
- SQLite-backed per Phase 1 decision

**API Surface Validation:**
 Thin, explicit, ready for orchestration:
- `GET /api/tenants` — list all (working)
- `GET /api/tenants/:id` — detail (working)
- `POST /api/tenants` — create (working, duplicate checks enforced)
- `PATCH /api/tenants/:id/state` — state update + transition logging (working)
- `PATCH /api/tenants/:id/desired-state` — desired state update (working)
- `PATCH /api/tenants/:id/storage` — storage reference (working)
- `PATCH /api/tenants/:id/backup` — backup metadata (working)
- `GET /api/tenants/:id/transitions` — audit history (working)

**Test Coverage Analysis:**
 15 tests cover all critical paths:
- Health check endpoint
- Tenant creation (happy path + duplicate ID/slug rejection + slug validation)
- List tenants (empty + populated states)
- Get tenant (found + 404)
- State transition recording (updates state + creates audit log)
- Desired state updates
- Storage reference updates
- Backup metadata updates
- Transition history retrieval (with 404 for missing tenant)

**Missing Edge Cases (acceptable for skeleton):**
- State transition validation (blocking invalid transitions like `ready` → `deprovisioned` without intermediate states) — deferred to #54/#55 orchestration logic
- Concurrent state update protection — deferred to orchestrator (single-writer assumption)
- Tenant deletion lifecycle — not required for Phase 1

**Follow-Up Readiness:**
 Clean contract ready to drive:
- Issue #54: K8s provisioning (create tenant record → provision resources → update state)
- Issue #55: Rolling update choreography (desired state → orchestrator → current state sync)
- Issue #40: Backup/restore coordination (backup metadata + restoring state)

**Quality Gates:**
 Build: passes
 Lint: clean (apps/web, apps/api, apps/control-plane all pass)
 Tests: 15/15 passing
 Type safety: explicit TenantState contract enforced at DB + API boundaries
 Audit trail: every state change logged with triggeredBy + reason
 Workspace integration: package.json properly wired for monorepo

**Reviewer Notes:**
- This is a thin, explicit skeleton as intended — no premature orchestration logic
- SQLite-backed per Phase 1 decision (Postgres migration deferred until fleet size justifies it)
- State machine defined but transitions not validated (intentional — orchestrator owns transition logic)
- No DELETE endpoint (intentional — deprovisioned state is the soft-delete marker)
- Database path configurable via env var (DATABASE_PATH), defaults to data/control-plane.sqlite
- Graceful shutdown handles DB cleanup (close on SIGINT/SIGTERM)

**Decision Impact:**
This skeleton unblocks Phase 1 work immediately. Brand can start #54 (K8s provisioning), Data can start #55 (rollout choreography). No further control-plane schema changes expected until Phase 2.

**Next Steps:**
1. Merge PR #59
2. Start #54 and #55 in parallel (both consume this registry contract)
3. Add state transition validation to orchestrator (not registry) in #55

**Files Validated:**
- apps/control-plane/src/types.ts (7-state enum, tenant model, audit trail)
- apps/control-plane/src/tenant-registry.ts (SQLite layer, CRUD, transitions)
- apps/control-plane/src/app.ts (Express routes, validation, error handling)
- apps/control-plane/src/index.ts (startup, graceful shutdown)
- apps/control-plane/test/app.test.ts (15 comprehensive tests)
- apps/control-plane/README.md (lifecycle docs, API reference)
- package.json (workspace wiring, control-plane added)

**Root Validation:** `npm run lint --workspaces && npm test --workspace=apps/control-plane && npm run build --workspace=apps/control-plane` — all green

## 2026-04-19: PR #60 Review (Issue #52 - Containerization)

**What:** Reviewed Brand's containerization implementation for Epic #42 Phase 0.

**Verdict:** ✅ APPROVE

**Key Validations:**
- Multi-stage Dockerfile with proper non-root execution (appuser:appuser)
- K8s health probes correctly implemented: `/healthz` (liveness), `/readyz` (readiness with DB check), `/health` (legacy)
- RUNTIME.md is comprehensive (301 lines) covering env contract, K8s lifecycle, Phase 0→1 migration
- Same-origin serving via `SERVE_WEB=true` flag works correctly
- SPA fallback excludes health/API routes (correct middleware ordering)
- SIGTERM graceful shutdown implemented
- DATABASE_URL reserved but not wired (correct for Phase 0)
- No scope drift: no #43 manifests, no CI auto-push, no provider-specific artifacts
- All 60 tests pass, lint clean, single commit with conventional format

**Edge Cases Checked:**
1. Port consistency: Dockerfile PORT=3000, index.ts defaults to 3001 for local dev (correct)
2. Readiness probe failure: Returns 503 on DB error via `noteStore.getAdminOverview()` (correct K8s semantics)
3. Same-origin CORS: Correctly bypassed when no Origin header (mobile apps, container testing)
4. Health route shadowing: Routes registered BEFORE SPA fallback (no conflicts)

**Production-Minded Qualities:**
- Security: Non-root user, read-only code, write-only data volume
- Observability: Health endpoints, SIGTERM handling, future Phase 2+ metrics hooks
- Documentation: RUNTIME.md covers env vars, K8s probes, migration notes, smoke tests
- Epic alignment: Respects all Epic #42 locked decisions (same-origin, no auto-GHCR, DATABASE_URL reserved)

**Learnings:**
- Containerization acceptance criteria: reproducible image + K8s-shaped runtime + documented contract + same-origin validation
- Health probe semantics for K8s: liveness = process alive (simple 200), readiness = ready to serve (DB check, 503 on fail)
- Phase 0 scope discipline: container + health + runtime docs only; defer manifests (#43) and Postgres wiring (#46)
- RUNTIME.md is the authoritative source for tenant container contract; README.md is quickstart only
- Same-origin mode in containers: `SERVE_WEB=true` enables production deployment shape, SPA fallback must exclude health/API routes
- Multi-stage Dockerfile pattern: deps → build-deps → build → runtime (minimize final image size)
- Port defaulting strategy: container sets PORT=3000 (production), index.ts defaults to 3001 (local dev split mode)

**Next Steps:**
- Phase 0 blocker: Issue #46 (Postgres adapter) must land before #43 manifests
- Phase 1 prerequisite: Control-plane skeleton (#53) running in parallel
- Production readiness: CI pipeline rescope (#43) for container build + smoke tests after Phase 0 gate

**Review Quality:**
- No test additions needed (health endpoints are smoke-testable, not unit-testable)
- Commit message quality: conventional format, Co-authored-by trailer, clear scope statement
- PR description quality: Epic alignment, non-scope callouts, testing instructions, follow-up tracking

**Decision:** No new team-wide decisions. This PR implements existing locked decisions from Epic #42.

**Reviewer verdict format reminder:** APPROVE or REJECT with evidence, name different agent for revision on reject, suggest next steps on approve.

---


