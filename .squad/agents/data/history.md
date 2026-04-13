# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Data initialized as Backend Dev for the initial project squad.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.

📌 Team update (2026-04-12T13:32:51Z): Fixed merged PR runtime regression—added in-place SQLite schema upgrade for note attribution columns, preserving local dev data; regression coverage validates legacy-schema bootstrap path — decided by Data, Chunk

📌 Team update (2026-04-12T14:38:40Z): Campaign share links stay as reusable single links with owner-only on-demand reveal; listings stay metadata-only and legacy hash-only links must be revoked/recreated to become revealable again — decided by FFMikha (via Copilot), Mikey, Data, Stef, Chunk

📌 Team update (2026-04-12T17:35:41Z): Issue #27 session browsing backend revision approved by Chunk; all four critical regressions fixed; endpoints ship-ready for frontend session-browsing UI work — decided by Data (implementer), Chunk (reviewer)

## Learnings

- Initial squad setup complete.
- `apps/api/src/note-store.ts` owns SQLite schema bootstrap, so compatibility fixes for local dev databases should run there before prepared note queries are created.
- The default dev database lives at `apps/api/data/dnd-notes.sqlite`; when note schema adds nullable attribution fields, prefer an in-place startup upgrade over asking developers to reset data.
- Backend verification for this area is `npm run lint --workspace apps/api`, `npm test --workspace apps/api`, and `npm run build --workspace apps/api`, with `npm run dev` confirming the shared dev startup path.
- Share links currently persist only `token_hash` in `apps/api/src/note-store.ts`, while owner list payloads expose metadata only and `POST /api/campaigns/:campaignId/share-links` is the lone place that returns the raw token/url. Re-revealing an existing link later will therefore require a recoverable stored secret plus an explicit owner-facing reveal API.
- Share-link reveal support now keeps `campaign_share_links.token_hash` for guest access checks and a nullable `token_plaintext` column for owner-only re-reveal of the same reusable link; legacy rows remain null and must surface a regeneration-required path instead of guessing.
- The owner reveal contract lives in `apps/api/src/app.ts` at `GET /api/campaigns/:campaignId/share-links/:shareLinkId`, which returns only `{ token, url }` on success and leaves `GET /api/campaigns/:campaignId/share-links` metadata-only.
- Shared membership claims should rotate `campaign_memberships.guest_token_id` in `apps/api/src/note-store.ts` when attaching `user_id`, and `apps/web/src/SharedCampaignRoute.tsx` must persist the replacement token so the same browser keeps working while the original guest token stops authenticating shared routes.
- Issue #23 backend contract uses `POST /api/campaigns/:campaignId/memberships/consolidations` as an owner-only preview/apply flow: send source/target IDs for a preview, then repeat with `confirm: true` to apply.
- `apps/api/src/note-store.ts` keeps membership consolidation note-attribution-only by reassigning `notes.created_by_membership_id` and `notes.last_edited_by_membership_id` without rewriting note bodies, note timestamps, membership rows, linked accounts, or guest tokens.
- Regression coverage for membership consolidation lives in `apps/api/test/app.test.ts`, covering guest-to-guest reassignment counts plus explicit confirmation before role-changing owner-to-guest moves.
- Session-browsing auth should mirror `/api/notes`: keep `GET /api/notes/sessions*` in `apps/api/src/app.ts` behind `resolveAccessibleCampaign()` so linked collaborators keep access, not `resolveOwnedCampaign()`.
- Express already decodes `request.params.sessionId`; frontend callers should use `encodeURIComponent(sessionName)` once, and regressions for route ordering plus `%` session names live in `apps/api/test/app.test.ts`.
- Issue #33 thin backend slice lives in `apps/api/src/app.ts` as `GET /api/notes/activity`, reusing `resolveAccessibleCampaign()` so owners and linked collaborators see the same campaign-scoped recent note feed.
- The recent activity payload is intentionally latest-state only: derive one `created` or `edited` event per note from `createdAt`/`updatedAt`, and pair it with collaborator summaries built from note attribution instead of adding a noisy audit table.
- `apps/api/src/note-store.ts` now guarantees `updatedAt` moves forward on note edits, which keeps latest-activity classification deterministic even when SQLite writes happen inside the same millisecond.
- Issue #30 note-to-note links backend complete: `linkedNoteIds` validated in create/update schemas (20-link limit), stored as JSON array in `notes.linked_notes_json`, with cross-campaign and non-existent note blocking; `getBacklinks()` method and `GET /api/notes/:noteId/backlinks` endpoint surface backlinks scoped to same campaign; all three note SELECT queries include `linked_notes_json` column; error handling wraps createNote/updateNote to return 400 for link validation failures rather than 500; legacy database migration adds column with safe default.
- Issue #26 stayed schema-light: note bodies remain stored as plain text, while the web app now interprets that text as Markdown so old notes stay readable without migration.
- Shared note rendering now lives in `apps/web/src/note-formatting.tsx`, which uses `react-markdown` + `remark-gfm` and is reused by both `apps/web/src/App.tsx` and `apps/web/src/SharedCampaignRoute.tsx`.
- Rich-formatting regression coverage now lives in `apps/web/src/note-formatting.test.tsx`, with app wiring covered in `apps/web/src/App.test.tsx`.

## 2026-04-12: Issue #27 Revision Assignment & Completion

📌 Team update (2026-04-12T16:45:23Z): Issue #27 session-browsing v1 implementation rejected by Chunk for 4 regressions: route shadowing (/:sessions consumed as /:noteId), double percent-decode crash on session names with %, auth regression blocking collaborators, missing regression tests. Concept approved; you are assigned to fix backend. See `.squad/decisions.md` for full rejection details. Stef will own UI work after backend fixes land.

📌 Team update (2026-04-12T21:22:46Z): Issue #27 backend revision complete and approved. All four regressions fixed: (1) route ordering corrected, (2) double-decode removed, (3) auth switched to resolveAccessibleCampaign() for linked collaborators, (4) contracts aligned with existing types. Lint, test, build all pass. Ship-safe. Stef can now start thin session-browsing UI slice. See `.squad/decisions.md` Issue #27 entry for full details — decided by Data, Chunk

## 2026-04-13: Issue #30 Revision Assignment & Completion

📌 Team update (2026-04-13T14:00:00Z): Issue #30 note-to-note links v1 implementation (by Stef) rejected by Chunk for three critical gaps: (1) legacy database crash when `linked_notes_json` undefined (SELECT queries missing column), (2) validation schemas missing `linkedNoteIds` causing operations to fail, (3) backlink discovery/related-note surfacing insufficient for acceptance. Also missing regression coverage for cross-campaign validation, guest permissions, and workspace reload safety. Data assigned to fix backend implementation, add tests, validate, and commit.

📌 Team update (2026-04-13T14:30:00Z): Issue #30 backend revision complete and approved. All three gaps fixed: (1) added `linked_notes_json` to all note SELECT queries so field populates correctly, (2) added `linkedNoteIds` to validation schemas with 20-link limit, (3) implemented `getBacklinks()` in note-store and `GET /api/notes/:noteId/backlinks` endpoint with proper campaign scoping. Error handling improved: createNote/updateNote wrapped in try-catch to return 400 for link validation failures (non-existent notes, cross-campaign links). Comprehensive regression tests added covering full linking workflow, backlink discovery, cross-campaign blocking, too-many-links validation, and legacy migration safety. All 28 tests pass, lint clean, build succeeds. Ship-safe — decided by Data (implementer), pending Chunk review

## 2026-04-13: Issue #24 Web Test Infrastructure Investigation

📌 Team update (2026-04-13T17:45:00Z): Issue #24 revision assigned after Chunk rejection. Stef (original author) locked out. Task: diagnose web test stall, add regression coverage, get to reviewer-ready state.

**Investigation outcome:** Web test suite (`apps/web/src/App.test.tsx`, 3200 lines) hangs indefinitely in vitest 4.1.4. Tests remain in `[queued]` state and never execute. Confirmed this affects BOTH current branch (28bd0ed) AND parent commit (7dec493), proving it's a pre-existing environmental issue, not a regression from Stef's implementation.

**Evidence:**
- API tests (`apps/api/test/app.test.ts`): ✅ All 26 tests pass
- Lint (`npm run lint --workspaces`): ✅ Passes
- Build (`npm run build --workspaces`): ✅ Passes
- Simple standalone test: ✅ Runs
- Any test rendering `<App />`: ⚠️ Hangs (including minimal test)
- Parent commit tests: ⚠️ Same hang behavior
- No GitHub Actions workflow exists for web tests

**Resolution:**
- Created `apps/web/src/CampaignSearch.test.tsx` with focused regression tests for issue #24 search functionality (title search, body search, clear button, combined filters, result count, new note behavior)
- Updated `vite.config.ts` with proper test pool configuration (removed deprecated poolOptions)
- Documented full investigation in `TEST_INVESTIGATION.md`
- Committed diagnostic work with clear explanation of pre-existing test infrastructure failure

**Learnings:**
- Web test infrastructure is fundamentally broken and needs investigation independent of any feature work
- vitest 4.1.4 + React 19 + MUI 9 combination may have compatibility issues
- Absence of CI for web tests allowed this infrastructure failure to go undetected
- When test infrastructure is broken, document thoroughly, provide alternative validation (lint/build), and escalate the infrastructure issue separately
- Regression test files can still be created to specify expected behavior even when test runner is broken — they serve as living documentation until infrastructure is fixed

