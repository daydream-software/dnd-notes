# Squad Decisions

## Active Decisions

### 2026-04-12: Product roadmap prioritizes search, filtering, and mobile UX before graph-style tag relationships
**By:** Mikey (Lead), Stef, Data

**What:**
Team consensus on phased product roadmap addresses user requests from FFMikha (Issue #20 product direction):
- **Near-term bets (v1–v2, 4–8 weeks):** Linked-member visual differentiation, temporary claim indicator, collaborator navigation, member consolidation, search infrastructure, mobile note UX, richer editing
- **Long-term vision (v3+):** Graph-style tag relationships deferred until search, filtering, and tag browsing foundations are mature
- Rationale: Graph relationships only maximize user value once discovery and navigation foundations are solid; implementing relationships first creates friction before users can leverage them

**Why:**
Aligns team around sustainable feature velocity. Search and mobile UX unlock immediate user value and foundation for more complex features. Membership consolidation and collaborator navigation cleanup strengthen core data models and UX flows. Graph-style tags become powerful visualization and relationship exploration once users can efficiently search and filter content.

**Status:** ACTIVE — shapes all near-term feature prioritization and scope

**Files affected:**
- `.squad/log/2026-04-12T16:15:00Z-product-direction-review.md` (detailed breakdown)

### 2026-04-12: GitHub issues created for product backlog and roadmap
**By:** Coordinator

**What:**
Coordinator created 12 issues in daydream-software/dnd-notes aligned with product direction consensus:
1. Linked collaborator UX — Visual differentiation for linked vs. unlinked guest memberships in member list
2. Membership consolidation — Owners consolidate note authorship from duplicate members without rewriting history
3. Search infrastructure — Global full-text search across notes and campaigns
4. Mobile layout — Responsive note list/detail layout using screen space efficiently
5. Rich text editing — Friendly formatting (bold, italic, lists, links) with proper rendering
6. Session browsing — Enhanced session navigation and context preservation for collaborators
7. Tag browsing — Flexible tag discovery and filtering UI
8. Graph-tag spike — Research spike for graph-style tag relationships and implementation approach
9. Note links — Cross-note references and backlink discovery
10. Quick capture — Streamlined rapid note entry UI
11. Note templates — Reusable templates for session and note creation
12. Activity views — User activity log and recent change tracking

**Why:**
Captures agreed-upon feature roadmap as tracked issues for sprint planning and assignment. Coordinator mapped each product direction request to specific GitHub issue for transparency and progress tracking.

**Status:** BACKLOG — issues ready for estimation, design, and sprint assignment

### 2026-04-12: @copilot is enabled as a coding agent with auto-assignment
**By:** FFMikha (via Copilot)

**What:**
`@copilot` is part of the squad roster and may automatically pick up issues labeled `squad:copilot`.

**Why:**
This gives the team an autonomous coding lane for small, clearly specified work without blocking the named squad members.

### 2026-04-11: GitHub Actions must be pinned to commit SHAs
**By:** FFMikha (via Copilot), Brand, Mikey

**What:** 
All GitHub Actions references in `.github/workflows/` and `.squad/templates/workflows/` must be pinned to commit SHAs instead of using floating major-version tags (e.g., `@v4`, `@v7`).

**Actions updated:**
- `.github/workflows/sync-squad-labels.yml` — replaced `actions/checkout@v4`, `actions/github-script@v7` with pinned SHAs
- `.github/workflows/squad-triage.yml` — replaced `actions/checkout@v4`, `actions/github-script@v7` with pinned SHAs
- `.github/workflows/squad-heartbeat.yml` — replaced `actions/checkout@v4`, `actions/github-script@v7` (×3) with pinned SHAs
- `.github/workflows/squad-issue-assign.yml` — replaced `actions/checkout@v4`, `actions/github-script@v7` (×2) with pinned SHAs
- `.squad/templates/workflows/*` — updated all template mirrors to match

**Why:** 
Organization security policy prohibits floating action tags. Pinning to immutable commit SHAs ensures reproducibility, prevents uncontrolled action updates, and satisfies org compliance requirements.

**Scope:** All public and internal GitHub Actions in active workflows and templates.

**Implementation notes:**
- Major-version comments retained inline for clarity
- squad-heartbeat.yml maintained across 4 locations — source template updated, synced via `squad upgrade`
- This is a mandatory enforcement rule, not optional

### 2026-04-12: PR #21 Review: Note Authorship Attribution (APPROVED)
**By:** Mikey (Lead)

**What:**
PR #21 introduces membership-based note attribution using `campaign_memberships` as the stable actor identity. The feature adds nullable FK columns (`created_by_membership_id`, `last_edited_by_membership_id`) on the `notes` table to track who created and last edited each note. API shape is `NoteAttribution` (membershipId, displayName, role). Both `createdBy` and `lastEditedBy` fields are nullable to preserve backward compatibility with legacy notes.

**Why:**
Membership provides the correct collaboration boundary — it avoids coupling to auth-layer user IDs and keeps the owner/guest model uniform. Nullable FKs ensure no migration is needed for existing data. LEFT JOINs inline attribution into queries without N+1 lookups.

**Verdict:** APPROVE  
**Status:** Ready to move from draft toward merge. No revisions required.

**Notes:**
- Tests cover owner attribution, guest attribution, and legacy null handling
- TypeScript type definitions in sync across api and web workspaces
- Schema design is backward-compatible and well-tested

### 2026-04-12: Preserve local SQLite data during note attribution + regression coverage (consolidated)
**By:** Data, Chunk

**What:**
When backend schema changes add backward-compatible nullable columns to SQLite tables (e.g., `notes` table for PR #21 attribution), the API should upgrade those columns in place during store initialization before preparing dependent statements. Regression test coverage confirms the legacy-schema bootstrap path by creating a pre-attribution `notes` table, inserting legacy data, reopening through `createNoteStore()`, and verifying legacy notes load with null attribution fields.

**Why:**
- Preserves existing local note data without manual developer resets
- Keeps `npm run dev` working after merges
- Matches the repo's current schema-bootstrap style (tables initialized at app startup)
- Fresh test databases auto-initialized with new schema, so tests missed the legacy-schema path; regression coverage closes this gap
- Smallest test surface that would have caught the startup crash before release

**Implementation:**
- Schema introspection on `notes` table in `createNoteStore()` detects missing attribution columns
- Adds missing columns as nullable if needed
- Regression test in `apps/api/test/app.test.ts` covers the legacy bootstrap path
- Verified: lint, test, build, and `npm run dev` startup all pass

**Files affected:**
- `apps/api/src/note-store.ts`
- `apps/api/test/app.test.ts`
- `README.md`

### 2026-04-12: Campaign share links stay reusable with owner re-reveal (consolidated)
**By:** FFMikha (via Copilot), Mikey (Lead), Data, Stef, Chunk

**What:**
Campaign share links stay as the same reusable link per share-link record; this flow does not introduce per-person links. Owners can intentionally re-reveal a specific link on demand while the normal share-link list remains metadata-only. New links persist the existing `token_hash` plus a nullable plaintext token so `GET /api/campaigns/:campaignId/share-links/:shareLinkId` can return `{ token, url }` for owners, and the campaign settings UI reveals and re-copies that URL per card behind a blur/show affordance. Legacy hash-only links remain valid for guest access but return an explicit `409` regeneration-needed response when an owner tries to reveal them again. The combined backend/frontend worktree was reviewed and approved, with `npm run lint`, `npm run test`, and `npm run build` passing.

**Why:**
The user asked to re-reveal the same reusable share link later, not replace it with per-person links, and to keep reveal behind an intentional UX step. Keeping the main list metadata-only avoids bulk exposure of active secrets, while storing a recoverable token for new rows is the smallest change that supports owner re-reveal without changing guest access semantics. The explicit legacy-link warning documents the migration and security trade-off: older hash-only links cannot be reconstructed and must be revoked/recreated if owners need a revealable URL.

### 2026-04-12: Issue #20 — Link guest memberships to real accounts (APPROVED)
**By:** Brand, Data, Stef, Chunk (Lead Reviewer)

**What:**
Guest memberships can be claimed by real accounts through `POST /api/shared/:shareToken/membership/claim` on the shared route. The claim flow:
- Links the real account to the existing guest membership by setting `campaign_memberships.user_id`
- Rotates the guest token on claim so the old token no longer authenticates shared routes
- Returns the new guest token to the browser for continued shared-route session
- Grants the claimed account read/write access to `/api/campaigns`, `/api/campaigns/:campaignId`, `/api/overview`, and `/api/notes` through the linked membership
- Preserves owner-only restrictions (campaign settings, membership lists, share-link management remain owner-only)
- Stores the claimed campaign as the selected workspace so the signed-in app reopens it after claim
- Keeps note attribution on the original guest membership (createdBy/lastEditedBy stay on that row)

**Why:**
Users need to convert guest campaign participation into persistent account membership without losing history, notes, and collaboration context. Same-browser claiming proves possession of the current guest session, preserves membership-based note attribution, avoids migrating history to a new actor, and keeps the v1 scope tight (no per-person links or cross-device flows). Token rotation prevents anonymous backdoor access post-claim.

**Rejection cycle:**
1. Brand's pass: old guest token still authenticated after claim → rejected
2. Data's revision: guest token rotated, but claimed account could not access campaign → rejected
3. Stef's revision: authenticated access unlocked for claimed memberships, full test coverage → approved

**Verdict:** APPROVE  
**Status:** Ready for merge. All regression coverage passes. Lint, test, build all green.

**Files affected:**
- `apps/api/src/note-store.ts`
- `apps/api/src/app.ts`
- `apps/api/test/app.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/SharedCampaignRoute.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/App.test.tsx`

### 2026-04-12: Issue #27 v1 Architecture APPROVED but Implementation REJECTED
**By:** Mikey (Lead), Chunk (Lead Reviewer)

**What:**
Session-based note browsing v1 slice (thinnest architecture):
- Backend: `listSessionNames()` and `getSessionNotes()` methods on NoteStore
- API: `GET /api/notes/sessions` (list sessions with counts) and `GET /api/notes/sessions/:sessionId` (fetch session notes)
- Types synced across workspaces
- No new schema; reuses existing nullable `session_name` field

**The Verdict: APPROVED for concept, but REJECTED for shipped implementation.**

Chunk identified four critical backend regressions that make endpoints unusable:
1. Route shadowing: `/api/notes/sessions` consumed as `/api/notes/:noteId=sessions` → returns 404 instead of session list
2. Double percent-decode: Session detail param manually decoded with `decodeURIComponent()` after Express already decoded it → crashes on session names containing `%` (e.g., "50% done") with URIError 500
3. Auth regression: Session endpoints use owner-only `resolveOwnedCampaign()` instead of membership-aware auth → blocks claimed collaborators who can access `/api/notes` but fail on `/api/notes/sessions/:sessionId` with 403
4. Missing regression coverage: No API or web tests added for the new endpoints; UI still renders flat note list

**Why:**
The concept of lightweight session discovery without schema migration is sound and aligns with the product roadmap (search and filtering before graph relationships). However, the shipped implementation bypassed established auth patterns and introduced integration regressions that must be fixed before merge.

**Revision Owner:** Data (backend fixes)
**Follow-on UI Work:** Stef (if needed, after backend fixes)

**Status:** REQUIRES REVISION — concept approved, implementation rejected

### 2026-04-12: Issue #23 — Membership Consolidation (Attribution-Only with Preview + Confirm, APPROVED)
**By:** Data, Stef, Chunk (Lead Reviewer)

**What:**
Membership consolidation is strictly attribution-only:
- Backend: `POST /api/campaigns/:campaignId/memberships/consolidations` (owner-only)
- Sending `sourceMembershipId` + `targetMembershipId` without `confirm` returns a **preview** of affected note counts and warnings
- Sending the same payload with `confirm: true` applies the change by moving `notes.created_by_membership_id` and `notes.last_edited_by_membership_id` from source to target
- Consolidation does **NOT:** delete notes, rewrite note bodies, change timestamps, merge memberships, move linked accounts, or rotate guest tokens
- Role-mismatch consolidations (e.g., owner → guest) require explicit `confirmRoleMismatch: true` flag

**Why:**
Preview+confirm pattern provides clear frontend confirmation UI while keeping the backend scope tight. Ownership-cleanup is solved without making unscoped account/session merge decisions. Explicit role-mismatch confirmation blocks accidental historical-role rewrites.

**Review cycle:**
1. Chunk's first pass (2026-04-12): identified missing regression coverage for owner-only and campaign-scope guardrails → rejected
2. Stef's revision: added explicit tests for linked-guest `403` rejection and cross-campaign membership `404` scoping
3. Chunk's re-review (2026-04-12): confirmed regressions now covered, no blockers remain → approved

**Verdict:** APPROVE  
**Status:** Ship-ready. All regression coverage passes. Lint, test, build all green. No remaining blockers.

### 2026-04-12: Issue #27 — Session Browsing Backend (REVISION APPROVED)
**By:** Data (backend fix), Chunk (reviewer), Mikey (approver)

**What:**
Session-based note browsing v1 backend revision fixes four critical regressions from first attempt:
1. **Route shadowing fix:** Moved `/api/notes/sessions*` routes ahead of `/api/notes/:noteId` catch-all in Express
2. **Double-decode fix:** Removed manual `decodeURIComponent()` from session detail (Express already decodes the param)
3. **Auth regression fix:** Switched both session-browsing routes from `resolveOwnedCampaign()` to `resolveAccessibleCampaign()`, granting linked collaborators proper access matching `/api/notes` pattern
4. **Contract alignment:** Confirmed existing `SessionsResponse` and `NotesResponse` contracts in `apps/web/src/types.ts` are reusable

**Frontend handoff:**
- Session detail URLs must use `encodeURIComponent(sessionName)` exactly once
- Endpoints are ship-safe for any authenticated linked collaborator
- No additional scoping or contract changes needed

**Why:**
Original concept (lightweight session discovery, no schema migration) aligns with product roadmap (search and filtering before graph relationships). First shipped implementation had route ordering, double-decode, and auth pattern regressions. Revision fixes all four and maintains the thin-slice architecture.

**Verdict:** APPROVE  
**Status:** Ship-ready. Lint, test, build all pass. Ready for frontend session-browsing UI work.

### 2026-04-12: Issue #32 — Campaign Starter Templates (Client-Side, Creation-Only Scope, APPROVED)
**By:** Stef (implementer), Mikey (reviewer)

**What:**
Campaign starter templates are:
- **Built-in templates, client-side:** Reuse existing `createCampaign()` and `createNote()` calls instead of waiting on a new backend template API contract
- **Campaign-creation scope only:** Template UI limited to campaign creation entry point; templates do not appear in campaign settings (which is Issue #22's domain)
- **Optional scaffolds:** Blank campaign stays the default; every seeded note is a normal editable note after creation

**Why:**
Keeping templates client-side and campaign-creation-scoped avoids touching the campaign-settings surface that Issue #22 is actively using. This slice ships independently and does not block search/filter work.

**Verdict:** APPROVE  
**Status:** Ship-ready. Integration test coverage included. Lint, test, build all pass. No blockers remain. Best-effort campaign-seeding trade-off (if one `createNote()` fails, campaign may have partial starter notes) acceptable because issue wanted thin frontend slice with no new backend contract.

### 2026-04-12: Issue #27 — Session Browsing Backend (REVISION APPROVED)
**By:** Chunk (reviewer)

**What:**
Chunk's review validates that Data's backend fixes resolved all four critical regressions:
1. **Route shadowing fix verified:** `/api/notes/sessions` and `/api/notes/sessions/:sessionId` registered before `/api/notes/:noteId` catch-all
2. **Double-decode fix verified:** Manual `decodeURIComponent()` removed; Express decoding only applied
3. **Auth regression fix verified:** Both session routes switched to `resolveAccessibleCampaign()` for membership-aware access
4. **Contract alignment confirmed:** `SessionsResponse` and `NotesResponse` types synced across workspaces

**Test coverage confirms:**
- Session names with percent-encoding (e.g., `50% done`) correctly handled via Express param decoding
- Claimed collaborators can browse sessions via authenticated membership access
- No shadowing of session endpoints by note-detail catch-all

**Why:**
Validates that the backend slice is production-ready for frontend session UI work to proceed without blocking.

**Verdict:** APPROVE  
**Status:** Ship-ready. Lint, test, build all pass. Frontend session-browsing UI work can proceed.

**Files affected:**
- `apps/api/src/app.ts`
- `apps/api/src/note-store.ts`
- `apps/api/src/types.ts`
- `apps/api/test/app.test.ts`
- `apps/web/src/types.ts`
- `README.md`

### 2026-04-12: Issue #27 — Session Browsing Frontend (APPROVED)
**By:** Stef (implementer)

**What:**
Frontend session browsing UI slice: thin two-step flow integrated into existing note list/detail shell.
- Browse by session opens session list via `/api/notes/sessions`
- Selecting a session swaps left rail into that session's notes via `/api/notes/sessions/:sessionId`
- Reset to "All notes" when creating new note (avoids collision with Issues #22/#31)
- Client-side numeric-aware descending sort for session names

**Why:**
Answers "what happened in this session?" without redesigning the workspace. Thin frontend mode inside existing shell minimizes risk, preserves established editor workflow, and aligns with product roadmap (search/filter before graph relationships).

**Verdict:** APPROVE  
**Status:** Ship-ready. Integration test coverage included. Lint, test, build all pass.

**Files affected:**
- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/App.test.tsx`

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
