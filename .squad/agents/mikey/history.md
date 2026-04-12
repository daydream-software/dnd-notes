# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Mikey initialized as Lead for the initial project squad.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
📌 Team update (2026-04-11T19:27:38Z): GitHub Actions in all workflows pinned to commit SHAs; decision merged to team decisions log — Brand
📌 Team update (2026-04-12T14:38:40Z): Campaign share links stay as reusable single links with owner-only on-demand reveal; listings stay metadata-only and legacy hash-only links must be revoked/recreated to become revealable again — decided by FFMikha (via Copilot), Mikey, Data, Stef, Chunk

## Learnings

- Initial squad setup complete.
- **Workflow Review (2026-04-11):** Audited all 4 squad workflows for action-pinning compliance. Found 100% non-compliance (4/4 files use major-version refs instead of SHAs). Key risk: squad-heartbeat.yml is synced across 4 locations; pin must happen at template source, then sync. Documented team rule and action requirements for Brand in decision inbox. See `.squad/decisions/inbox/mikey-workflow-review.md`.
- **PR #21 Review (2026-04-12):** Reviewed membership-based note attribution feature (Copilot-authored). Verdict: **APPROVE with minor notes**. Architecture is sound — uses `campaign_memberships` as the stable actor reference, LEFT JOINs for inline attribution, nullable FKs for backward compat. API types mirrored correctly between `apps/api/src/types.ts` and `apps/web/src/types.ts`. All 11 API tests + 5 web tests pass. TypeScript compiles clean. One minor observation: `package-lock.json` includes an unrelated removal of the `yaml` package — harmless but worth noting. The `resetNotes` path correctly nulls out attribution, preserving legacy-note behavior.
- **Issue #27 — Session-Based Note Browsing v1 (2026-04-12):** Approved and implemented thinnest-slice architecture. **Backend:** Two NoteStore methods (`listSessionNames`, `getSessionNotes`) + two SQL queries on existing `session_name` field. **API:** Two owner-auth endpoints (`GET /api/notes/sessions`, `GET /api/notes/sessions/:sessionId`) returning session lists with counts + filtered notes. **Types:** SessionSummary + SessionsResponse added to both apps/api and apps/web. All 14 API tests + 7 web tests pass. No schema changes; backward compatible. Frontend can wire UI independently. Decision doc: `.squad/decisions/inbox/mikey-issue-27.md`. Commits: `217dc33`, `aa5e598`.
- **Issue #32 Review (2026-04-12):** Approved Stef's frontend template slice. The shape stays intentionally thin: `apps/web/src/templates.ts` keeps built-in note/campaign scaffolds client-side, `apps/web/src/App.tsx` only exposes the campaign starter picker during campaign creation, and starter notes are seeded by reusing `createCampaign()` plus follow-on `createNote()` calls rather than inventing a template backend contract. The note-template picker only appears in create-note mode, blank remains the default, and seeded notes stay normal editable notes, so the slice meets acceptance without spilling into the active #22 owner-settings surface. Validation passed with `npm run lint && npm run test && npm run build`.
- **PR #35 Review (2026-04-12):** Rejected quick-capture PR pending a backend contract fix. `apps/api/src/validation.ts` now defaults `body` to `''` and `status` to `'draft'`, but `validateNoteInput()` is reused by the owner and shared PUT handlers in `apps/api/src/app.ts`, so omitted fields on update would silently clear note bodies or reset status instead of failing validation. Quick capture itself is a good thin slice; the safe shape is separate create-vs-update validation or route-level defaults only on POST. Verified both `main` and PR head with `npm run lint && npm run test && npm run build`; this is a semantic regression, not a red build.

## 2026-04-12: Issue #27 Backend Complete

📌 Session browsing v1 delivered and ready for frontend wiring. Backend provides:
- `GET /api/notes/sessions?campaignId=...` → `{ sessions: SessionSummary[] }`
- `GET /api/notes/sessions/:sessionId?campaignId=...` → `{ notes: Note[] }`
- Frontend team can now implement UI independently with clear API contract

## 2026-04-12: PR #21 Review Complete

📌 Team update (2026-04-12T13:13:36Z): PR #21 note attribution feature approved and merged to decisions.md — decision available to all agents.

## 2026-04-12: Share Link Reveal Assessment

- **Share token storage:** `campaign_share_links.token_hash` is a SHA-256 hash — tokens are NOT recoverable from the DB. This is the "show-once" pattern.
- **UI state:** `lastCreatedShareUrl` in `App.tsx` is ephemeral React state; lost on any navigation or refresh. No persistent URL display exists.
- **Listing endpoint:** `GET /api/campaigns/:campaignId/share-links` returns metadata only (label, access level, frame ancestors, dates). No token or URL.
- **Key file paths:** Schema in `apps/api/src/note-store.ts:342-353`, share link creation at `:1040-1081`, token hashing at `:181-187`, UI share card at `apps/web/src/App.tsx:1246-1287`.
- **Architecture decision:** Recommended storing tokens reversibly (plaintext or encrypted) alongside existing hash. Same link, no second mechanism. Two-slice plan: backend token storage + retrieval endpoint, then frontend blur/reveal UX. The consolidated outcome now lives in `.squad/decisions.md`.

## 2026-04-12: Issue #27 Backend Complete + #32 Approved + #23 Approved

📌 Team update (2026-04-12T21:22:46Z): Issue #27 backend revision completed and approved by Chunk. Data fixed all four regressions (route shadowing, double-decode, auth scope, contracts). Ship-safe. Stef to start session-browsing UI on SessionsResponse. Issue #32 (campaign templates) approved by Mikey, no blockers. Issue #23 (membership consolidation) re-approved by Chunk after Stef's regression coverage closed safety gaps. All three decisions finalized in `.squad/decisions.md` — reviewed by Chunk, Mikey

## 2026-04-12: Next Work Lane Routing — Issue #28 (Tag Facets) Recommended

**Decision:** Recommend #28 (tag facets + counts) as the next highest-value, safest lane after current PRs (#35 quick capture, #36 session browsing) land.

**Rationale:**
- **Zero file collision:** In-flight PRs modify `App.tsx` and `apps/api/src/app.ts` heavily. #28 focuses on tag infrastructure (backend count query) + isolated tag browsing UI (no route changes, sidebar component only).
- **Unblocks #24 (search):** Tag-count query is the hardest infrastructure piece for search filters. #28 lands it independently; #24 can consume it immediately.
- **No blockers created:** #28 doesn't depend on #36 resolution; can land in parallel. #26 (formatting) and #30 (note links) remain unblocked.

**Hold explicitly:**
- #24 (search): Needs #28 tag infrastructure + #36 session browsing stable (App.tsx collision risk)
- #25 (mobile): Needs #36 merged first (App.tsx note-browsing frame conflict)
- #29 (graph-tag spike): Deferred per product roadmap (tag facets mature first)

**Thin slice for #28:**
- Backend: `NoteStore.listTagsWithCounts(campaignId)` + `GET /api/campaigns/:campaignId/tags` endpoint (~50 lines + tests)
- Frontend: `TagsPanel.tsx` component in App sidebar, read-only, clickable for filtering (filtering UX deferred to #24) (~100 lines)
- No schema changes, backward compatible, query-only backend

**Next step after #28:** Route #24 (search) as the critical path to unlock #25 (mobile layout). The three form a dependency chain: #28 (tag infrastructure) → #24 (text search + filters) → #25 (mobile layout confident note browsing is query-ready).

**Files:** Decision written to `.squad/decisions/inbox/mikey-next-lane.md`. GitHub comment added to issue #28 with thin-slice recommendation.
