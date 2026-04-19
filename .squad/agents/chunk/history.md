# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Chunk initialized as Tester for the initial project squad.


## Core Context

*History summarized on 2026-04-18T22:58:15.109090 — old entries moved to archive. Keeping last 10 team updates and all learnings.*


## Recent Updates (Last 10)

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
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
- Issue #58 QA review (2026-04-18): NoteStore Postgres adapter with SQLite fallback has six high-risk parity gaps — transaction semantics under failure, connection pooling resilience, schema idempotence, ACID isolation level mismatch, query result type coercion, and graceful shutdown. Identified 🟡 conditional blocker: isolation level and pool configuration must be clarified before implementation to prevent orphaned references and cascade failures under load. Created comprehensive QA brief at `.squad/qa-brief-issue-58.md` with 7 critical test cases and 5 decision points for Data to confirm.

*227 older learning items archived.*


📌 Team update (2026-04-19T22:50:29Z): Issue #58 decisions locked by Mikey. QA gate conditional blocker resolved. Ready for Data implementation phase with 7 done signals + concurrency test cases. Re-review against checklist at merge time. — Scribe