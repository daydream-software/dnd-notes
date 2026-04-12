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

## 2026-04-12: Issue #27 Review Outcome

📌 Team update (2026-04-12T16:45:23Z): Issue #27 implementation rejected by Chunk for route shadowing, percent-decode double-decode, auth scope regression (blocks claimed collaborators), and missing regression coverage. Concept approved; revision ownership → Data. Follow-on UI work → Stef (if needed).
