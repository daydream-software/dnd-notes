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
