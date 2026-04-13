# Squad Decisions

## Active Decisions

### 2026-04-13: Squad Worktrees in Dedicated Folder

**By:** Brand (Platform Dev)  
**Requested by:** FFMikha  
**Status:** IMPLEMENTED

**Problem:**
Default squad worktree behavior creates sibling folders at the repo parent level (e.g., `/path/to/dnd-notes-42`), cluttering the workspace. User requested worktrees under a dedicated folder.

**Solution Implemented:**

1. Updated `.squad/config.json`:
   - `version: 1`
   - `worktrees: true`
   - `workTreesFolder: ".worktrees"`

2. Added `.worktrees/` to `.gitignore`

3. Created `.squad/docs/worktree-setup.md` with comprehensive guide

**What This Enables:**

- All worktrees live under repo-root/.worktrees/ (not scattered as siblings)
- Worktrees organized by issue: .worktrees/42/, .worktrees/45/, etc.
- Clean repo workspace - no sibling folders
- Project-level configuration - no shell env vars needed
- Coordinator automatically uses this path when spawning agents

**Example:**
- Before: `/workspace/dnd-notes-42` (sibling folder)
- After: `/workspace/dnd-notes/.worktrees/42/` (dedicated folder)

**Limitations:**

The `workTreesFolder` config key is a convention. Full automation depends on:
1. Coordinator parsing `.squad/config.json` and reading `workTreesFolder`
2. Coordinator applying this path when calculating worktree location

Current squad agent template describes default behavior (sibling folders).
If full automation not yet in Coordinator, manual worktree creation still uses sibling paths.
Team should test and confirm Coordinator uses the configured folder.

**Follow-up:** If Coordinator does not parse `workTreesFolder`, add:
- Config parsing to `squad.agent.md` Pre-Spawn section
- Update path calculation to use `workTreesFolder` instead of repo-parent

**Status:** IMPLEMENTED — Decision recorded, docs provided, team ready to adopt

---

### 2026-04-13: Brand — Worktree Governance Decision

**By:** Brand (Platform Dev)  
**Requested by:** FFMikha  
**Status:** IMPLEMENTED

## Decision

Treat `.squad/config.json` as the preferred repo-local source of truth for Squad worktree behavior. When `workTreesFolder` is set, resolve worktrees under that folder from the repo root / team root; when it is absent, keep the legacy sibling-path fallback.

## Why

The repo already enabled `worktrees: true` with `workTreesFolder: ".worktrees"`, but the authoritative Squad governance still documented sibling-folder defaults only. Aligning governance, lifecycle docs, and workflow examples removes ambiguity for coordinator setup, manual worktree commands, and future template reuse.

## Impact

- Repo-local `.worktrees/` layouts are now clearly supported
- Existing sibling-folder behavior remains the documented fallback
- Worktree creation, reuse, and cleanup examples now describe the same resolution rule across Squad docs

---

### 2026-04-13: Issue #33 Backend Restore + Combined Approval — Ready for Merge
**By:** Data (Backend), Scribe (Memory Manager)

**What:**
Post-rebase verification confirms both issue #33 backend and frontend slices are APPROVED and ready for merge:

**Backend: Activity Endpoint (`GET /api/notes/activity`)** ✅ APPROVED
- Post-rebase validation by Data confirmed stable implementation
- Membership-aware auth via `resolveAccessibleCampaign()` (no regression)
- Route ordering safe (no issue #27 shadow-routing)
- Collaborator summaries derivation correct
- Null-attribution fallback (optional chaining + graceful "Unknown" display)
- Full regression test coverage: owner/guest access, filter isolation, foreign rejection, claim validation
- Non-blocking gaps: limit parameter edge-case test (future optimization); legacy null-attribution response test (fallback verified in code)
- **Verdict:** Ship-safe. Frontend can proceed independently.

**Frontend: Activity UI Slice** ✅ APPROVED by Chunk
- Recent Activity list (sorted by `updatedAt` descending) ✅
- Collaborator sidebar with click-to-filter, click-again-to-clear ✅
- Created vs. edited action distinction with actor attribution ✅
- Empty state handling ✅
- Membership-aware access (linked collaborators supported) ✅
- **All 5 regression gates retired:**
  - RT1: Activity endpoint request does NOT trigger workspace reload (verified via per-endpoint request counting)
  - RT2: Collaborator filter does NOT shadow route params (filter state uses refs)
  - RT3: Stale-response race on rapid filter clicks prevented (abort controllers + monotonic request IDs)
  - RT4: No stale-timestamp confusion (activity ↔ session browsing use independent state channels)
  - RT5: Empty states intact across all modes (campaign-empty, filtered-empty, session-empty)
- Code quality: membership-aware auth, null-attribution test, no bootstrap coupling, quick-capture preservation, lint clean
- Test results: 16 web + 24 API tests passing
- **Verdict:** APPROVED FOR MERGE (2026-04-13T00:05:00Z)

**Combined Status:** 🚀 READY FOR MERGE
- Both backend + frontend approved
- Full regression coverage (RT1–RT5 gates all retired)
- All tests passing (16 web + 24 API)
- No merge blockers
- Next: Mikey confirms CI gates green and merges to main

**Orchestration logs:**
- Backend restore: `.squad/orchestration-log/2026-04-13T00:06:00Z-backend-restore-and-combined-approval.md`
- Backend approval: `.squad/orchestration-log/2026-04-13T00:05:00Z-issue-33-ui-approval.md` (includes backend verification)

**Status:** APPROVED & READY FOR MERGE — Mikey to gate merge post-CI

### 2026-04-12: Immediate action plan — Unblock PR #35 and PR #36, then route Issue #33 frontend
**By:** Mikey (Lead)

**What:**
Post-Issue #28 triage identifies clear blocking issues in current PRs and recommends sequenced fixes before proceeding to higher-priority activity feature (#33 backend + frontend).

**Immediate Priority (in order):**
1. ✅ **PR #35 validation fix** — COMPLETE
   - Split `validateNoteInput()` into separate create/update functions ✅
   - Apply defaults only in POST handler, never in PUT ✅
   - Add regression test: PUT with omitted body/status must fail 400 ✅
   - **Verdict:** APPROVED by Mikey; merged in commit `6e1cf08`
   - Owner: @copilot

2. ✅ **PR #36 session browsing rework** — COMPLETE
   - Extract `browseMode`/`selectedSessionName` entirely out of `loadWorkspace` dependency chain ✅
   - Use ref or memo to avoid callback identity churn that triggers bootstrap rerun ✅
   - Add cancellation or "latest-selection-only" logic to `handleSelectSession()` ✅
   - Add regression tests: mode toggle without reload, new-note from session mode preserves state, rapid switches resolve in order ✅
   - **Verdict:** APPROVED by Chunk; merged and ready
   - Owner: Stef (@copilot)

3. ✅ **Issue #33 activity UI** – COMPLETE & APPROVED
   - Implement activity feed view in App.tsx using Data's stable activity endpoint ✅
   - Three UX surfaces: recent-notes list, activity filtered by collaborator, campaign activity timeline ✅
   - Thin slice: read-only display, no edit actions, backward-compatible null-attribution ✅
   - Leverage membership-aware auth from PR #21 ✅
    - **Verdict:** APPROVED by Chunk (QA Lead) – all 8 regression gates passing ✅
    - Non-blocking: Verify Data's `/api/notes/activity` endpoint in final artifact
   - Owner: Stef or @copilot

**Why:**
PR #35 validation fix eliminated data-loss blocker. PR #36 unblocked by PR #35 merge; stable App.tsx frame now ready for #24, #25, #33 UI work. Activity is next high-value lane: backend done and approved, frontend straightforward, improves product narrative.

**Held Work:**
- #24 (search): Unblocks after #28 tag infrastructure (done) AND App.tsx frame solid (PR #36 merged ✅)
- #25 (mobile): Depends on #24 + stable note-browsing frame; hold until #24 in progress
- #29 (graph-tag spike): Deferred per product roadmap (after search/browsing/mobile solid)
- #26 (richer formatting), #30 (note-to-note links): Backlog, low priority vs. search + mobile

**Status:** ALL THREE ITEMS RESOLVED ✅ — PR #35 & #36 merged, Issue #33 UI approved and ready for merge

### 2026-04-13: Git rebase recovery — stash-and-continue strategy for clean history
**By:** Brand (Platform Dev), Scribe (Memory Manager)

**What:**
Interactive rebase on `main` is paused at commit 7 of 14. Worktree contains two distinct categories of changes:
- **Staged:** `.squad/*` metadata files (session logs, agent histories, decisions.md)
- **Unstaged:** App changes from Issue #33 UI work + Issue #27 corrections

**Decision:**
Use **OPTION A: Stash-and-continue** to maintain clean commit history and avoid mixing concerns:
1. Stash all worktree changes (both staged and unstaged):
   ```bash
   git stash push -u -m "Session #33 UI work + squad metadata before rebase continue"
   ```
2. Continue rebase (remaining 7 commits will replay cleanly):
   ```bash
   git rebase --continue
   ```
3. After rebase completes, restore stash:
   ```bash
   git stash pop
   ```
4. Post-rebase: organize #33 work (feature branch, or merge to main once rebase is done)

**Rationale:**
- Prevents `.squad/*` metadata from being folded into historical issue #27 commits
- Keeps Issue #33 work cleanly separated (can rollback independently if needed)
- Maintains commit hygiene and blame clarity
- Rebase completion becomes straightforward without scope creep

**Why not OPTION B (reset rebase)?**
- Would lose granular history of who did what (not ideal for multi-agent team)
- Combining #27 corrections + #33 UI into single commit adds hidden complexity
- Current approach (stash) is safer and reversible

**Status:** DECISION MADE — awaiting user execution of stash and rebase --continue commands

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

### 2026-04-12: Issue #27 — Session Browsing Backend (REVISION APPROVED, consolidated)
**By:** Data (backend fix), Chunk (reviewer), Mikey (approver)

**What:**
Session-based note browsing v1 backend revision fixes four critical regressions from first attempt:
1. **Route shadowing fix:** Moved `/api/notes/sessions*` routes ahead of `/api/notes/:noteId` catch-all in Express
2. **Double-decode fix:** Removed manual `decodeURIComponent()` from session detail (Express already decodes the param)
3. **Auth regression fix:** Switched both session-browsing routes from `resolveOwnedCampaign()` to `resolveAccessibleCampaign()`, granting linked collaborators proper access matching `/api/notes` pattern
4. **Contract alignment:** Confirmed existing `SessionsResponse` and `NotesResponse` contracts in `apps/web/src/types.ts` are reusable

**Chunk's validation confirms:**
- Route shadowing fix verified: `/api/notes/sessions` and `/api/notes/sessions/:sessionId` registered before `/api/notes/:noteId` catch-all
- Double-decode fix verified: manual `decodeURIComponent()` removed; Express decoding only applied
- Auth regression fix verified: both session routes switched to `resolveAccessibleCampaign()` for membership-aware access
- Test coverage validates session names with percent-encoding (e.g., `50% done`) correctly handled via Express param decoding
- Claimed collaborators can browse sessions via authenticated membership access
- No shadowing of session endpoints by note-detail catch-all

**Frontend handoff:**
- Session detail URLs must use `encodeURIComponent(sessionName)` exactly once
- Endpoints are ship-safe for any authenticated linked collaborator
- No additional scoping or contract changes needed

**Why:**
Original concept (lightweight session discovery, no schema migration) aligns with product roadmap (search and filtering before graph relationships). First shipped implementation had route ordering, double-decode, and auth pattern regressions. Revision fixes all four and maintains the thin-slice architecture. Chunk's validation confirms the backend slice is production-ready for frontend session UI work to proceed without blocking.

**Verdict:** APPROVE  
**Status:** Ship-ready. Lint, test, build all pass. Ready for frontend session-browsing UI work.

**Files affected:**
- `apps/api/src/app.ts`
- `apps/api/src/note-store.ts`
- `apps/api/src/types.ts`
- `apps/api/test/app.test.ts`
- `apps/web/src/types.ts`
- `README.md`

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

### 2026-04-12: Issue #27 — Session Browsing Frontend (APPROVED & MERGED)
**By:** Chunk (reviewer)  
**Requested by:** FFMikha  
**Implementation:** @copilot (revision from prior REJECTION)

**Initial Verdict:** REJECT (2026-04-12) — addressed dependency chain and state wiring issues

**Revised Verdict:** ✅ APPROVE (2026-04-12T23:19:25Z) — All rejection criteria retired

**What was fixed:**
1. ✅ Browse-mode workspace reload — RETIRED
   - `browseMode`/`selectedSessionName` isolated from `loadWorkspace` dependency chain
   - Regression test verifies `fetch()` call count stays constant across mode toggles

2. ✅ Draft/create-note clobbering — RETIRED
   - No `loadWorkspace()` call on session switch = no loading spinner, no draft overwrite
   - Regression test proves draft fields survive full mode toggle round-trip

3. ✅ Stale-response race conditions — RETIRED BY DESIGN
   - `displayedNotes` is synchronous `useMemo` filter over already-loaded notes
   - Zero network calls on session switch = zero race conditions

4. ✅ Test coverage quality — RETIRED
   - 3 new web tests: no-refetch toggle, draft preservation, empty state handling
   - 3 new API tests: session aggregation, auth guards, shared guest access
   - All new tests pass; 2 pre-existing failures on main are unrelated

**Status:** ✅ MERGED — PR #36 commit `9d0966b` (session-based note browsing and recap views)

**Files affected & shipped:**
- `apps/web/src/routes/CampaignRoute.tsx` — Activity tab UI, collaborator filter state
- `apps/web/src/routes/SharedCampaignRoute.tsx` — Session browsing in shared workspace
- `apps/api/src/routes.ts` — Session aggregation endpoints (backend)
- `apps/web/src/App.test.tsx` — Comprehensive regression test suite

**Impact:** Unblocks Issue #33 frontend (activity UI can now build on stable App.tsx frame)

### 2026-04-12: Issue #33 — Frontend Acceptance & Regression Targets: Recent Activity UI Slice (READY FOR IMPLEMENTATION)
**By:** Chunk (tester), FFMikha (product)  
**Status:** Product decisions pending; backend contract stable; ready for routing

**What:**
Issue #33 adds a **recent activity view** to the note-taking workspace — a read-only list of recently created and edited notes, optionally filtered by a single collaborator, membership-aware for linked accounts. Backend `GET /api/notes/activity` is stable; frontend thin slice v1 focuses on UI only.

**Frontend scope (thin slice v1):**
- Activity list showing recent notes, sorted by `updatedAt` descending (newest first)
- Distinguish 'created' vs 'edited' actions with timestamps and actor attribution
- Collaborator filter sidebar with click-to-filter and clear-filter button
- Empty state message when campaign has no notes
- Membership-aware access (not auth-only; supports linked collaborators)

**Not in scope (future work):**
- Pagination / "Load more" UI
- Full-text search / tag filtering
- Shared workspace activity support (product decision pending)
- Session-based filtering / activity diffs

**Backend contract (approved, stable):**
```
GET /api/notes/activity?campaignId=...&membershipId=...&limit=20
Response: { campaign, collaborators[], activity[] }
```

**Regression gates (critical):**
- RT1: Activity endpoint does NOT trigger workspace reload
- RT2: Collaborator filter does NOT shadow route params
- RT3: Stale-response race conditions on rapid filter clicks prevented
- RT4: No stale-timestamp confusion between activity and session browsing
- RT5: Empty state does NOT regress when campaign is shared

**Files to modify:**
- `apps/web/src/App.tsx` — Activity tab UI, filter state management
- `apps/web/src/api.ts` — `fetchActivity()` client function
- `apps/web/src/types.ts` — Activity response types
- `apps/web/src/App.test.tsx` — Regression tests

**Product decisions pending:**
1. Shared workspace activity: authenticated-only or visible in `/share/:shareToken`?
2. Collaborator filter privacy: full visibility, creator-only, or owner-only?
3. Copy & labels: "Recent activity", "Activity feed", or "Recent notes"?
4. Pagination: infinite scroll, "Load more" button, or no pagination?

**Assigned owner:** Stef (frontend) or @copilot (fallback), pending PR #36 merge

**Status:** READY FOR IMPLEMENTATION — Unblocked by PR #36 merge; awaiting product decisions (non-blocking)

---

### 2026-04-12: Parallel Work Lane Decision During PR #36 Conflict (RESOLVED)
**By:** Mikey (Lead), FFMikha (product)  
**Context:** PR #36 (session browsing UI) had merge conflicts; team asked if Issue #33 (activity UI) could start in parallel

**Analysis:**
- PR #36 conflict scope: 8 files modified, major rebase required (now resolved & merged)
- Issue #33 UI backend: ✅ Stable, approved, no changes needed
- Issue #33 UI frontend: Would collide with PR #36 App.tsx changes if started during conflict resolution

**Decision:** HOLD Issue #33 UI until PR #36 merges; START Issue #28 (Tag Facets) as safe parallel lane

**Why #28 is safe:**
1. Zero App.tsx collision — `<TagsPanel>` sidebar is isolated, doesn't restructure main frame
2. Independent backend — Tag count query on existing `tags` field, no schema changes
3. Unblocks #24 downstream — Tag facets are hardest infrastructure piece for search
4. Parallel to PR #36 — @copilot can land #28 while #36 conflict resolution happens offline

**Timeline:**
1. ✅ Now: PR #36 merged, conflicts resolved
2. ✅ Issue #33 UI unblocked, ready for routing (high-priority continuation)
3. ⏳ Issue #28 (tag facets) still queued as safe parallel lane

**Status:** RESOLVED — PR #36 merged successfully; Issue #33 now ready for immediate implementation

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

### 2026-04-12: Issue #33 Acceptance & Regression Targets — Recent Activity Views (READY FOR BACKEND DESIGN)
**By:** Chunk (Tester)

**What:**
Recent activity views acceptance criteria and regression targets for issue #33. Three user flows: recent notes list (sorted by recency, last editor + timestamp), activity filtered by collaborator (who did what), and activity scoped to campaign (with membership-aware auth). Critical regression targets: auth & scope (linked collaborators must access activity same as /api/notes), attribution consistency (null attribution from legacy notes, consolidated memberships), ordering & staleness (most-recent-first sort, pagination for v1), membership/collaborator lifecycle (display name changes, future member removal). Medium risk: noisy audit log scope creep (rejects minute-by-minute timestamps, full diffs, separate edit events). Low risk: response format follows /api/notes pattern.

**Why:**
Defines clear acceptance bar for backend implementation. Prevents scope creep toward full audit trails. Identifies critical regression paths (auth pattern from #27, legacy note handling, membership consolidation interaction). Test plan covers 7+ edge cases (null attribution, linked collaborator access, consolidated membership attribution, cross-campaign rejection, guest share-link access). Ship criteria: all tests pass, auth matches /api/notes pattern, legacy notes don't crash, cross-campaign requests gate properly, response format consistent.

**Verdict:** READY FOR BACKEND DESIGN  
**Status:** Acceptance criteria approved. Awaiting implementation. High-priority path block.

**Files affected:**
- `.squad/decisions/inbox/chunk-issue-33.md` (detailed acceptance & regression doc)

### 2026-04-12: Issue #29 Recommendation — Defer Graph-Style Tags Until v3+ (DEFERRED)
**By:** Stef (Frontend Dev)

**What:**
Graph-style tag relationships (edges between tags for flexible navigation) are recommended for deferral until after search and tag-browsing foundations land. Current app uses flat comma-separated tags with no discovery mechanism (no click-to-find, no filter, no search). Graph relationships only unlock value when paired with search, tag browsing (click tag → see notes), and visualization. Phase 1 (v1–v2, near-term): full-text search, tag list view, tag detail view with notes, mobile UX. Phase 2 (v3+, only after Phase 1): auto-inferred graph relationships and optional relationship editor. Current flat model is sufficient for v1; graph complexity premature without discovery.

**Why:**
Users can't traverse relationships without search and tag browsing UI. Without usage data from basic search/browsing, relationship definition becomes speculative. Risk: ship relationship editor that users don't use because they can't search or browse tags. Better path: ship search + tag browsing first, observe natural tag usage patterns, then add relationships if value is proven. Aligns with product roadmap decision prioritizing search/mobile before graph complexity.

**Verdict:** DEFERRED UNTIL v3+  
**Status:** Spike complete. Recommendation incorporated into product roadmap. Supports Mikey's routing (issue #28 tag facets unblocks #24 search for Phase 1 foundation).

**Files affected:**
- `.squad/decisions/inbox/stef-issue-29.md` (spike analysis and phasing)

### 2026-04-12: Next Work Lane — Issue #28 (Tag Facets) Recommended (ROUTING DECISION)
**By:** Mikey (Lead)

**What:**
Issue #28 (tag facets with counts, autocomplete, filtering infrastructure) identified as next safe high-value lane. Justification: zero file collision with in-flight PRs (#35 quick capture, #36 session browsing) — #28 focuses on tag backend (NoteStore.listTagsWithCounts, new /api/campaigns/:campaignId/tags endpoint) and isolated TagsPanel UI component. Unblocks #24 (search) without blocking anything; #24 can consume tag infrastructure immediately. Thin slice: backend API ~50 lines + ~30 lines tests, frontend component ~100 lines. Hold issues #24 (search), #25 (mobile) until PR #36 lands and App.tsx frame stabilizes. Proposed assignment: Stef (frontend) + Data (backend) if needed, or Data solo for backend slice with Stef following.

**Why:**
Routing is determined by dependency graph and file collision risk. #28 is unambiguously safe in current PR cluster; establishes tag querying infrastructure that #24 search needs. #24 and #25 both require stable App.tsx note-browsing frame, which PR #36 (session browsing frontend) is finalizing. Deferring #24/#25 until #36 merges prevents merge conflicts and scope collision. Issue #29 spike (Stef completed) recommends deferring graph tags entirely, making tag facets (#28) the right next step for search foundation. Expected timing: 2–4 hours combined (backend 1–2h, frontend 1–2h).

**Verdict:** APPROVED FOR NEXT ASSIGNMENT  
**Status:** Routing locked. Ready to queue #28 after current PR cluster stabilizes. #24 immediately queued after #28 lands.

**Files affected:**
- `.squad/decisions/inbox/mikey-next-lane.md` (detailed routing and thin-slice breakdown)

### 2026-04-12: PR #35 Review — Quick Note Capture (CHANGES REQUESTED)
**By:** Mikey (Lead)

**What:**
PR #35 adds quick-capture UI for rapid note entry (owner + shared flows). Changes requested: validation defaults in validateNoteInput() apply `.default('')` for body and `.default('draft')` for status. Same schema is reused for both POST (create) and PUT (update) handlers. Risk: client omitting body or status on PUT will silently blank the body or force note back to draft, breaking existing update semantics. Before PR #35, these requests failed validation. Quick-capture defaults are appropriate for create but must not affect update behavior. Required fix: separate create/update validation schemas, or apply defaults only in POST handlers. Add regression test proving update cannot accidentally clear body or reset status from omitted fields.

**Why:**
Validation regressions are high-risk for silent data loss. The oversight is natural (one schema, two contexts) but breaks the expectation that omitted fields don't alter stored data. Caught early via review; straightforward fix.

**Verdict:** CHANGES REQUESTED  
**Status:** Blocking. Requires validation schema revision before merge. Low-complexity fix; expected 15–30 min to address.

**Files affected:**
- `.squad/decisions/inbox/mikey-review-pr-35.md` (detailed blocking concern)
- `apps/api/src/validation.ts` (separate schemas or scoped defaults)
- `apps/api/src/app.ts` (apply defaults only to POST handlers)
### 2026-04-12: Issue #28 Acceptance & Regression Targets — Tag Facets & Autocomplete (DRAFT, READY FOR PRODUCT SIGN-OFF)
**By:** Chunk (Tester)

**What:**
Tag facets and autocomplete acceptance criteria for issue #28. Thin slice scope: tag autocomplete during note editing (suggest previously used tags in campaign) + tag browsing UI (facet list with counts, clickable to filter notes). No backend schema changes or new API endpoints required; all logic is client-side over existing /api/notes response. Critical features: campaign-scoped tag queries (no scope bleed to other campaigns), tag count accuracy under concurrent edits, multiple-tag AND logic filtering, state persistence during browsing/editing (no workspace reloads like issue #27 regression). Regression test matrix covers 30+ test cases: autocomplete deduplication, empty campaign handling, special character handling, tag facet count updates, multi-tag filtering, stale-response protection from rapid clicks, create-note flow while filtered, mode-switching orthogonality.

**Why:**
Chunk's acceptance strategy prevents scope creep and common traps (campaign-scoping bugs, issue #27 state-reload regression, concurrent count inconsistency, empty-state confusion). Thin slice proves user value first; backend optimization (dedicated tag endpoints) deferred. UX decisions blocking further work: tag name normalization (case handling), multiple-tag logic (AND vs. OR), autocomplete trigger timing, facet sort order, empty-state copy, null session handling, count staleness tolerance.

**Verdict:** DRAFT, READY FOR PRODUCT SIGN-OFF  
**Status:** Acceptance criteria complete. UX decisions require FFMikha approval (7 blockers listed). All regression tests defined; implementation can proceed once product sign-off received. High-signal feature for tag discovery and search foundation.

**Files affected:**
- `.squad/decisions/inbox/chunk-issue-28.md` (detailed acceptance, regression matrix, UX traps, sign-off checklist)
### 2026-04-12: Issue #33 Backend Slice — Activity Endpoint (APPROVED)
**By:** Data (Backend Dev), Chunk (Tester)

**What:**
Data implemented the activity endpoint for issue #33: `GET /api/notes/activity` scoped through `resolveAccessibleCampaign()` so owners and linked collaborators can read the same campaign activity feed. Endpoint returns one latest-state activity row per note (either created or edited state), plus collaborator summaries derived from membership attribution. Supports optional query params: `campaignId`, `membershipId`, `limit`. Non-audit-log design: no new persistence tables, no per-edit history table, just the latest practical note activity needed for UI awareness.

**Why:**
Aligns with Chunk's acceptance criteria (auth matches /api/notes pattern, no scope creep to audit log). Thin slice preserves existing data model, no schema migration required. Uses membership attribution from PR #21 to track collaborator actions. Matches issue #27 pattern (membership-aware auth, accessible to claimed collaborators).

**Chunk's Review (2026-04-12):**
Chunk reviewed Data's backend implementation and issued **APPROVED** verdict:
- ✅ **Membership-aware access** — uses `resolveAccessibleCampaign()`, linked collaborators included
- ✅ **Collaborator-safe behavior** — route ordering prevents shadowing (issue #27 pattern), summaries derived from full activity
- ✅ **Reliable edit classification** — `createTimestampAfter()` guarantees `updatedAt` always moves forward, `updatedAt !== createdAt` never misclassifies edits
- ✅ **Null-attribution handling** — legacy null actors skipped in summaries, optional chaining applied
- ✅ **Regression coverage** — owner + guest activity, collaborator summaries, membership filter, foreign-membership rejection, claimed-collaborator access all tested

**Non-blocking gaps (future coverage pass):**
- No explicit test for `limit` query param (default, clamp, invalid → 400)
- No test exercises legacy/null-attribution notes in activity response

**Verdict:** APPROVED  
**Status:** Backend slice ship-safe. Ready for merge. Frontend/UI slice can be picked up independently against stable API.

**Interface Contract (Stable):**
```
NoteActivityResponse {
  campaign: ...,
  collaborators: [...],
  activity: [...]
}
```

**Files affected:**
- `apps/api/src/app.ts` (GET /api/notes/activity endpoint)
- `apps/api/src/note-store.ts` (activity query logic)
- `apps/api/src/types.ts` (ActivityResponse shape)# Corrected Post-#33 Routing: Proceed with Issue #28 (Tag Facets)

**By:** Mikey (Lead)  
**Date:** 2026-04-13 (correction pass)  
**Status:** READY FOR IMMEDIATE START (post-#33 merge)

---

## Context

Prior recommendation (in `mikey-post-33-lane.md`) assumed #35 and #36 were still pending merge. **That context is now stale.**

**Actual local state (2026-04-13):**
- ✅ PR #35 (quick capture): MERGED to main (`8443cba`)
- ✅ PR #36 (session browsing): MERGED to main (`9d0966b`)
- ✅ Issue #33 (activity UI): APPROVED locally, approved code in dirty worktree, ready to merge commit
- ✅ No open PRs remain
- ⏳ Issue #28, #24, #25, #26, #30: All still open on GitHub, waiting for next lane assignment

---

## Corrected Decision

**Proceed with Issue #28 (tag facets + counts) immediately after #33 lands.**

The prior recommendation is **correct and unchanged**. #28 is:
- **Zero-dependency**: Can start the moment #33 merges (no blockers)
- **Unblocks critical path**: #28 → #24 (search) → #25 (mobile)
- **File-safe**: No collision with other work; isolated backend + sidebar component
- **Thin slice**: ~150 lines total, backward compatible, no schema changes

---

## Preparatory Non-Code Work (Worth Doing Now)

**No implementation work yet** — the worktree is intentionally dirty with #33. Once #33 merges:

1. **Land #33 locally** ✓ (approved, ready to git commit + push)
   - Verify CI passes green post-merge
   - Confirm main is clean and ready for next slice

2. **Assign #28 ownership** (concurrent with #33 merge)
   - Primary: Stef (frontend focus preferred; tag UI is straightforward)
   - Fallback: @copilot if Stef blocked
   - Estimated effort: 4–6 hours (isolated scope, no cross-team dependencies)

3. **Optional sketch before code** (low-effort, high-confidence)
   - Review `apps/api/src/note-store.ts` for existing note-listing logic
   - Confirm SQL group-by + count pattern fits alongside existing queries (it does; no surprises expected)
   - No design gate needed; scope is explicit in prior decision doc

---

## Why This Correction

The prior decision was **strategically sound** — the local state change (PRs already merged) doesn't alter the routing choice. However:

- **Stale assumption:** "PRs #35 and #36 are pending merge" → Now both merged
- **Stale concern:** "File collision risk in App.tsx and app.ts" → Risk eliminated; those PRs are stable on main
- **Confirmation:** #28's safety and priority are **unchanged**; proceed with confidence
- **Impact:** No blocking architectural decisions or new risks discovered

---

## Thin Slice Scope (Unchanged from Prior Doc)

### Backend (~50 lines + tests)
- `NoteStore.listTagsWithCounts(campaignId)` → `{ tag: string; count: number }[]`
- `GET /api/campaigns/:campaignId/tags` endpoint, owner-auth required
- No schema changes; respects campaign boundaries

### Frontend (~100 lines)
- `TagsPanel.tsx` read-only sidebar component
- Integration into App sidebar (next to activity panel)
- `fetchTags(campaignId)` in api.ts

### Testing
- API: auth, foreign rejection, empty state, count accuracy
- Web: render empty, render with counts, no filter wiring yet (deferred to #24)

---

## Post-#28 Work

Once #28 merges:

1. **Immediately route #24 (search)** — Now unblocked; highest priority after mobile baseline
2. **Keep #25 (mobile) queued** — Will start after #24 closure
3. **Parking lot:** #26 (rich formatting), #30 (note links) — Mikey design gate deferred; collect requirements in parallel

---

## Notes for FFMikha

- No action needed until #33 merges and CI passes
- #28 is production-ready once approved; no follow-on architecture review required
- After #28 + #24 land, mobile layout work (#25) becomes the next P1 gate
# Issue #24 — Campaign Note Search with Filters

**Prepared by:** Chunk (Tester)  
**Date:** 2026-04-13  
**Status:** PREP ONLY — Acceptance criteria and regression target list; no code implementation.

---

## Charter

This document defines acceptance criteria and regression target tests for issue #24: adding a search UI with multi-filter capabilities to find campaign notes by title, body, tags, session, and collaborator. The feature must respect campaign scope, owner/collaborator access, work on mobile, and integrate cleanly with the quick-capture and session-browsing flows that are now merged.

---

## Product Goals

1. **Search in one campaign at a time** — respects the selected campaign and never bleeds results across campaigns
2. **Find notes by content** — title and body full-text matching (case-insensitive)
3. **Filter by metadata** — tags (AND logic), session name, collaborator who created/edited
4. **Preserve access model** — only show notes the user can edit/view based on campaign membership
5. **Mobile-safe UX** — filters and results stack naturally on small screens
6. **Integrate with existing flows** — quick capture, session browsing, activity view work together without interference

---

## Acceptance Criteria (AC)

### AC1: Search Input & Scope
- **Given:** User is in authenticated workspace with a campaign selected
- **When:** User types in the search input box
- **Then:** 
  - Search updates in real-time (debounced ≥200ms to avoid thrashing)
  - Search is scoped to the selected campaign only (never shows notes from other campaigns)
  - Empty search shows all notes in the campaign (equivalent to "no filter")
  - Whitespace-only search is treated as empty
  - Search text is preserved when toggling between browse modes (notes ↔ sessions ↔ activity)

### AC2: Title and Body Matching
- **Given:** A campaign has notes with various titles/bodies
- **When:** User enters search text (e.g., "goblin", "dragon", "50%")
- **Then:**
  - Matching is case-insensitive (e.g., "GOBLIN" matches "goblin")
  - Both title and body are searched (note: product to confirm if match-any or match-all fields; default assume match-any = OR)
  - Partial word match is supported (e.g., "drag" matches "dragon", "dragged", "dragonborn")
  - Special characters in search text are literal (e.g., "50%" matches "50% done", not regex)
  - Results update immediately as user types (debounced)
  - Leading/trailing whitespace in search input is trimmed before matching

### AC3: Tag Filtering
- **Given:** Campaign has notes with various tags
- **When:** User selects one or more tags from the tag facet list or autocomplete
- **Then:**
  - Selected tags are shown as chips/pills (visual affordance for "active filter")
  - Matching uses AND logic: only notes that have ALL selected tags are shown
  - Tag matching is case-insensitive and respects tag normalization (product confirms rules)
  - Tag facet count is accurate (reflects total notes matching current search + session + other active filters)
  - Clicking an active tag chip clears that tag from the filter
  - Multiple-tag deselect works: clicking a second time on a selected tag removes it

### AC4: Session Filtering
- **Given:** Campaign has notes assigned to multiple sessions (or no session)
- **When:** User selects a specific session from the session dropdown/list
- **Then:**
  - Only notes tagged with that session name are shown
  - "(No session)" or "Unassigned" option shows notes with null `sessionName`
  - "All sessions" clears the session filter and shows all notes
  - Session filter works in combination with search + tags (all filters apply simultaneously)
  - Session count in the filter shows how many notes match current search + tag filters + this session

### AC5: Collaborator/Member Filtering
- **Given:** Campaign has notes created/edited by different collaborators
- **When:** User selects a collaborator from the member filter
- **Then:**
  - Filter shows notes created by that member (respects `created_by_membership_id`)
  - Also include notes last edited by that member (respects `last_edited_by_membership_id`)
  - Collaborator name is displayed with optional role badge (owner, editor, viewer, or claimed)
  - Filter shows only collaborators who appear in the current search + tag + session result set
  - "All members" or clicking the active member clears the collaborator filter
  - Null attribution (legacy notes) are handled gracefully: either shown under "Unknown", excluded, or listed separately (product decides)

### AC6: Mobile-Safe UI Behavior
- **Given:** User is on a mobile device (< 768px viewport width)
- **When:** User interacts with search, filters, and results
- **Then:**
  - Search input and all filter controls stack vertically without horizontal scroll
  - Filter dropdowns/panels are touch-friendly (min 44px tap targets)
  - Results list is full-width and scrollable
  - Active filters are visible and removable even when filter panel is collapsed
  - Switching between browse modes (notes ↔ sessions ↔ activity) preserves search state
  - No layout shift or reflow when filters expand/collapse

### AC7: Access Control
- **Given:** User has linked collaborator membership in a campaign
- **When:** User searches and filters notes
- **Then:**
  - Only notes in the linked campaign are searchable
  - Search results respect note edit permissions (collaborator can see their own notes and team notes)
  - Collaborator filters show only members of the current campaign
  - Owner-only management functions (delete, revoke access) remain gated outside search results
  - Guest users (shared link) see their campaign's notes only; search works with same filters

### AC8: Integration with Quick Capture
- **Given:** User has search active (text entered, filters selected)
- **When:** User creates a new note via the quick-capture button
- **Then:**
  - New note appears in the search results immediately (if it matches current filters)
  - Search state and filter selections are NOT cleared
  - New note is added to the appropriate session (respects quick-capture session assignment)
  - Tag suggestions in quick-capture still show all campaign tags (not filtered by current search)

### AC9: Integration with Session Browsing
- **Given:** User is in session-browse mode with a session selected
- **When:** User toggles to "All notes" or enters search/filters
- **Then:**
  - Session selection is preserved in the background (does NOT re-run workspace bootstrap)
  - Search + filters work across all sessions (not just the previously selected session)
  - Clicking back to "Browse by session" with an active search state shows that session's notes matching the search
  - Rapid mode toggles do NOT cause workspace reload, flashing loader, or lost drafts

### AC10: Integration with Activity View
- **Given:** User is in the activity view
- **When:** Activity shows recent notes
- **Then:**
  - Search + filter state is independent of activity view (does NOT affect activity results)
  - Activity view shows all unfiltered recent changes (not search-filtered)
  - Clicking a note in activity view opens it; search/filter state is preserved
  - Toggling from activity back to all-notes restores the previous search/filter state

### AC11: Empty States
- **Given:** User has applied search + filters that match zero notes
- **When:** Results list is empty
- **Then:**
  - Empty state message is shown (e.g., "No notes match your search")
  - Message suggests clear filters or broaden search (CTA copy TBD by product)
  - Filter state is still visible so user knows what to adjust
  - If campaign is empty (no notes at all), message says "No notes in this campaign yet" or CTA to create one

### AC12: Performance & Responsiveness
- **Given:** Campaign has 100+ notes
- **When:** User searches and filters
- **Then:**
  - Search input debouncing prevents excessive re-renders (debounce threshold: ≥200ms, product confirms)
  - Filter facet counts are computed from current notes array, not cached (keep fresh)
  - Results render without noticeable lag (< 500ms visible update after debounce window)
  - Search state does NOT trigger workspace bootstrap (avoids the issue #27 regression)

---

## Regression Target List (RTL)

### RT1: Campaign Scope Isolation
**Risk:** Search bleeds results across campaigns (tag facet / search / filter state resets on campaign switch)
- **Test:** Multi-campaign user selects campaign A, searches for "dragon", switches to campaign B → results clear; switching back to A restores search "dragon" and previous result count
- **Test:** Tag facet shows only tags from selected campaign (not union of all campaigns)
- **Test:** After switching campaigns, new campaign's collaborator list is shown (not previous campaign's members)
- **Key file:** `apps/web/src/App.tsx` (campaign selection, notes array scope)

### RT2: Search State Preservation During Mode Toggles
**Risk:** Toggling between notes ↔ sessions ↔ activity re-runs workspace bootstrap, flashing loader, losing drafts
- **Test:** User types "goblin" in search, switches to session-browse mode, toggles back to all-notes → search text "goblin" is still there, no flashing loader
- **Test:** User has unsaved note draft open, clicks "Browse by session", then "All notes" → draft is preserved
- **Test:** Activity view can be toggled on/off without affecting search state
- **Key file:** `apps/web/src/App.tsx` (browseMode state, loadWorkspace deps)

### RT3: Stale-Response Race on Rapid Filter Clicks
**Risk:** User clicks tag A, then tag B, then clears A; out-of-order responses paint wrong result set
- **Test:** Rapid tag selections (click tag1 → tag2 → tag3 → clear tag2) resolve in correct order; final result matches the last filter state
- **Test:** Rapid session switches show correct note list under heading (no list/heading mismatch)
- **Test:** Abort controllers or request deduplication prevents old searches from overwriting newer ones
- **Key file:** `apps/web/src/App.tsx` (filter handlers, fetch abort/dedup logic)

### RT4: Tag Filter AND Logic
**Risk:** Multiple tags use OR instead of AND; user selects tag:combat AND tag:boss but sees notes with either tag
- **Test:** Note has tag:combat AND tag:boss. User selects both tags → note shown. User deselects tag:boss → note still shown. User selects tag:trap (and note doesn't have it) → note hidden.
- **Test:** Empty results when no note has all selected tags (intersection is empty)
- **Key file:** `apps/web/src/App.tsx` (filter logic), `apps/api/src/note-store.ts` (backend if filter added later)

### RT5: Collaborator Attribution Accuracy
**Risk:** Null/legacy attribution causes crashes or "Unknown" label never shown; consolidation rewrites author name incorrectly
- **Test:** Note with null `created_by_membership_id` is shown in collaborator filter as "Unknown" (or handled gracefully per product decision)
- **Test:** After consolidation (issue #23), moved notes show target membership as author in search results
- **Test:** Claimed collaborator (issue #20) sees their own notes under their real account name, not guest token name
- **Key file:** `apps/api/src/note-store.ts` (null attribution fallback), `apps/web/src/App.tsx` (render attribution)

### RT6: Session Filter on Notes Without Session
**Risk:** Notes with null `sessionName` are excluded from "No session" filter; session filter prevents other filters from working
- **Test:** Note with null `sessionName` appears when user selects "(No session)" filter
- **Test:** Combining session filter + text search: user searches "dragon" + filters to "Session 3" → only notes in Session 3 matching "dragon" shown
- **Test:** Clearing session filter while search is active shows all matching notes across all sessions
- **Key file:** `apps/web/src/App.tsx` (filter combination logic)

### RT7: Title/Body Matching Case Sensitivity & Partial Words
**Risk:** Search is case-sensitive; partial word matches fail; special regex chars crash search
- **Test:** User searches "GOBLIN" (uppercase) → finds notes with "goblin" (lowercase)
- **Test:** Search "dragon" → finds "Dragonborn", "dragon", "dragged" (partial match)
- **Test:** Search "50%" (literal special char) → finds "50% done", not interpreted as regex
- **Test:** Search with leading/trailing spaces is trimmed (search " goblin " = search "goblin")
- **Key file:** `apps/web/src/App.tsx` (search normalization)

### RT8: Tag Facet Count Accuracy Under Concurrency
**Risk:** Facet counts are stale; clicking a tag with 0 notes shows empty result; counts don't reflect current filters
- **Test:** User enters search "goblin", facet shows tag:location has 3 notes. User selects tag:location → result set shows exactly 3 notes (all matching "goblin" AND tag:location)
- **Test:** User selects tag:combat, then refines search to "boss" → tag:combat facet count updates to reflect only notes matching "boss" AND tag:combat
- **Key file:** `apps/web/src/App.tsx` (facet count computation, should be live per `notes` array state)

### RT9: Mobile Layout & Touch Targets
**Risk:** Filters are unreadable on mobile; tap targets too small; horizontal scroll required
- **Test:** Mobile viewport (375px width): search input, tag pills, session dropdown all stack without horizontal overflow
- **Test:** All interactive elements have ≥44px touch target
- **Test:** Collapsing filter panels on mobile preserves active filter visibility
- **Key file:** `apps/web/src/App.tsx` (CSS Grid, media queries; Material UI responsive styling)

### RT10: Search Does NOT Affect Activity View
**Risk:** Search/filter state leaks into activity endpoint; activity is filtered when it shouldn't be
- **Test:** User has search "dragon" active, switches to activity view → activity shows all recent notes, NOT filtered to "dragon"
- **Test:** User applies tag:combat filter, switches to activity → activity shows all collaborators, NOT filtered to notes with tag:combat
- **Test:** Activity endpoint call does not include search text or filter params (independent state channels)
- **Key file:** `apps/web/src/App.tsx` (separate state for search vs. activity), `apps/api/src/app.ts` (activity endpoint)

### RT11: Create/Edit Note Doesn't Clear Search State
**Risk:** Creating a note through quick capture clears search text; editing a note in-place breaks filters
- **Test:** User searches "goblin", creates a new note with quick-capture → search text "goblin" is still in input, result list updates to include new note (if it matches)
- **Test:** User filters to tag:combat, clicks a note to edit it, saves → tag:combat filter is still active, result list refreshes
- **Test:** Canceling a note edit preserves search + filter state
- **Key file:** `apps/web/src/App.tsx` (note lifecycle handlers, draft state)

### RT12: Shared Campaign (Guest) Search
**Risk:** Guest users cannot search (missing endpoint); guest search bleeds results across campaigns; guest-to-owner-claim breaks search state
- **Test:** Guest user in shared campaign can search notes (if read permissions allow)
- **Test:** Guest user search is scoped to the shared campaign only
- **Test:** After claiming membership (issue #20), user can search with authenticated access using linked account
- **Key file:** `apps/web/src/SharedCampaignRoute.tsx`, `apps/api/src/app.ts` (guest note endpoints)

### RT13: Search Input Debouncing
**Risk:** Search fires on every keystroke; typing "dragon" triggers 6 requests instead of 1
- **Test:** User types "d", "dr", "dra", "drag", "drago", "dragon" quickly → only 1–2 API requests (debounced ≥200ms)
- **Test:** Debounce is reset if user pauses and resumes typing
- **Key file:** `apps/web/src/App.tsx` (useCallback + debounce logic)

### RT14: Orthogonality with Existing Tag Facets (Issue #28)
**Risk:** Search filters conflict with tag facet state from issue #28; tag facet AND/OR logic changes under search
- **Test:** Tag facets from issue #28 continue to work as before (AND logic, counts are live)
- **Test:** New search text input does not interfere with facet panel (both can coexist)
- **Test:** Toggling between "All notes" and "Browse by session" with search active does NOT re-render facets incorrectly
- **Key file:** `apps/web/src/App.tsx` (facet state, search state integration)

### RT15: Product Decisions (Open Questions for FFMikha)
**Defer to product sign-off before implementation:**
1. **Title + body search logic:** Match-any (OR) or match-all (AND)? Default assume OR.
2. **Tag normalization:** Uppercase tags, trailing spaces, accent handling — apply same rules from issue #28.
3. **Null attribution in collaborator filter:** Show as "Unknown", exclude, or separate category?
4. **Empty-state CTA copy:** "No notes match your search" or "Try clearing filters"?
5. **Session filter:** "(No session)", "Unassigned", or both?
6. **Debounce threshold:** 200ms, 300ms, or configurable?
7. **Facet sort order:** Alphabetic or by note count (same as issue #28)?
8. **Guest access:** Can guests search shared campaigns?
9. **Pagination/lazy-load:** Cap results on screen (e.g., 50) or load all?
10. **Search persistence:** Save search state in localStorage or only session memory?

---

## Scope & Non-Goals

### In Scope
- Campaign-scoped full-text search on title + body
- Multi-filter UI: tags (AND), session, collaborator
- Mobile-safe responsive layout
- Integration with quick-capture, session browsing, activity view
- Regression coverage for auth, state isolation, concurrent updates

### Out of Scope (Defer to Future Issues)
- Backend API search endpoint (product confirms if needed or client-side only)
- Advanced query syntax (e.g., `tag:"combat" AND body:"dragon"`)
- Search history / saved searches
- Search analytics / trending search terms
- Full-text indexing / FTS optimization
- Bookmark/favorite notes
- Note preview hover cards in search results (use existing note-detail panel)

---

## Test Plan & Coverage Matrix

| Test Case ID | User Flow | Filter Combo | Expected Result | Key Risk |
|--------------|-----------|--------------|-----------------|----------|
| TC-S1 | Search "goblin" (no filters) | search only | Shows all notes with "goblin" in title/body | Case sensitivity, partial match |
| TC-S2 | Search "goblin" + tag:combat | search + 1 tag | Shows notes matching "goblin" AND tag:combat | AND logic correctness |
| TC-S3 | Search "goblin" + tag:combat + tag:boss | search + 2 tags | Shows notes with "goblin" AND both tags | Multi-tag AND |
| TC-S4 | Search empty, tag:combat selected | tags only | Shows all notes with tag:combat (count accuracy) | Tag facet staleness |
| TC-S5 | Session-browse mode → "All notes" with search "goblin" | mode toggle + search | No loader flash, search preserved | RT2: state preservation |
| TC-S6 | Rapid tag clicks: A → B → C → clear B | rapid filter clicks | Final result matches last filter state (only A+C) | RT3: stale responses |
| TC-S7 | Create note while search "goblin" active | quick-capture + search | New note appears in results if it matches | RT11: search preservation |
| TC-S8 | Edit note tags; toggle session filter on/off | edit + filter toggle | Result list refreshes, search state preserved | Filter/edit interaction |
| TC-S9 | Multi-campaign user: campaign A search "dragon" → switch to B | campaign switch | Search "dragon" clears; switching back to A restores it | RT1: scope isolation |
| TC-S10 | Null attribution note + collaborator filter | legacy note + collaborator | Note shown under "Unknown" or handled gracefully | RT5: null attribution |
| TC-S11 | Mobile viewport, 5 active filters | responsive layout | All filters visible, no horizontal scroll, stacked | RT9: mobile layout |
| TC-S12 | Search "50%", special characters | special chars | Matched literally (not regex) | RT7: escaping |
| TC-S13 | Activity view active, search "goblin" | activity + search | Activity shows all notes, NOT filtered to "goblin" | RT10: activity isolation |
| TC-S14 | Debounce test: type "d-r-a-g-o-n" quickly | debounce | Only 1–2 API requests (not 6) | RT13: performance |
| TC-S15 | Guest shared campaign search | guest access | Guest can search (if enabled); results scoped to share | RT12: guest scope |

---

## Regression Gate Criteria (Ship Checklist)

**Before marking issue #24 "ready to merge", all of the following must be true:**

- ✅ AC1–AC12 all pass with evidence (test cases, manual QA, or both)
- ✅ RT1–RT14 all regression tests pass; RT15 open questions answered by FFMikha
- ✅ Search state does NOT trigger workspace bootstrap (avoids issue #27 pattern)
- ✅ Mobile layout tested on real device or emulator (iOS + Android)
- ✅ Null attribution gracefully handled (no crashes, "Unknown" or exclusion shown)
- ✅ Tag AND logic verified (multiple tags require ALL to match)
- ✅ Debouncing working (rapid typing doesn't spam API)
- ✅ Integration tests pass: quick-capture creates note → appears in search, session-browse toggle preserves search, activity view independent
- ✅ ESLint + TypeScript compilation clean
- ✅ `npm run test && npm run build` all pass
- ✅ Accessibility check: ARIA labels on filters, keyboard navigation works

---

## File Changes Expected

### Backend (if needed, product confirms)
- `apps/api/src/app.ts` — new search/filter endpoint (optional; may be client-side only)
- `apps/api/src/note-store.ts` — search query builder if backend-driven (optional)
- `apps/api/test/app.test.ts` — regression tests for search scope, filters, auth (optional)
- `apps/api/src/types.ts` — search request/response types (optional)

### Frontend
- `apps/web/src/App.tsx` — search input, filter state management, result rendering
- `apps/web/src/App.test.tsx` — regression test coverage (RT1–RT14)
- `apps/web/src/api.ts` — search/filter API calls (if backend endpoint added)

### No Changes
- `apps/api/data/dnd-notes.sqlite` — schema unchanged
- `apps/web/src/templates.ts` — starter notes stay same
- Shared routes — guest access logic same as notes endpoint

---

## Open Questions for FFMikha (Product)

Before implementation starts, confirm:

1. **Search algorithm:** Full-text search (client-side on `notes` array or backend endpoint)?
2. **Title + body matching:** OR (match either) or AND (match both)?
3. **Tag normalization:** Same rules as issue #28 (case-insensitive, trim spaces, remove accents)?
4. **Collaborator filter:** Include both created_by AND last_edited_by, or just created_by?
5. **Null attribution:** Show as "Unknown", exclude, or "Uncredited"?
6. **Session filter:** Show "(No session)" option or auto-hide if no notes have null sessionName?
7. **Mobile priority:** Full feature parity on mobile or simplified filter UI?
8. **Guest search:** Enable search in shared campaigns or read-only for guests?
9. **Debounce delay:** 200ms, 300ms, or user-configurable?
10. **Persistence:** Save search state in localStorage (survive page reload) or session-only?

---

## Status

**Prepared by:** Chunk (Tester)  
**Date:** 2026-04-13  
**Ready for:** Product sign-off (FFMikha) on open questions, then backend/frontend implementation  
**Next Steps:** FFMikha reviews and approves this document; squad routes to dev team for implementation; Chunk owns QA gate before merge

---

### 2026-04-13: Issue #28 Branch Re-Review — REJECT Current State

**By:** Chunk (Tester)

**What:**
Current branch implementation of tag facets and filtering is functionally complete but contains a critical list/detail mismatch that blocks shipment.

**Status:** REJECTED — not ship-safe yet

**What still works:**
- Tag facets and counts derived locally from `notes` state
- Active single-tag filter visible in workspace chrome
- Tag autocomplete reuses same local facet list
- Tag clicks do NOT trigger extra workspace fetches (regression-verified)
- Root lint/build/test passing

**Ship blocker — Editor/Detail Pane Mismatch:**

When a tag filter is applied, `filteredNotes` narrows the left pane list, but `selectedNote` still pulls from the full `notes` array. The form can focus on and edit a note that no longer appears in the filtered list.

**Code evidence:**
- `App.tsx` computes `filteredNotes` from `selectedTagFilter` (list narrows locally)
- `selectedNote` derives from `selectedNoteId` against full `notes` array (no filtering)
- `handleSelectTagFilter()` flips filter state but does NOT reconcile `selectedNoteId`, `isCreating`, or `draft` with filtered results

**User impact:** Left pane says "Notes tagged 'clue'" while the form edits an unrelated note. Trust-breaking corner case.

**Regression expectation for fix:**
Add web regression that selects a non-matching note, clicks a tag facet, and proves the editor either:
1. Retargets to the first visible matching note, OR
2. Clears into a safe create/empty state

(Either acceptable; silently editing a hidden note is not.)

**Revision owner:** @copilot  
**Locked out for this cycle:** Stef

**Why:** List/detail sync is a core trust mechanism. Shipment without this fix risks user confusion and data-mutation surprises.

---

### 2026-04-13: Clear Tag Filter When Starting a Brand-New Note

**By:** Stef (Frontend Dev)

**What:**
When starting a brand-new note from a filtered list view, the active tag filter is now cleared locally in `App.tsx`.

**Why:**
- Composing and browsing are distinct workflows
- Leaving the filter on makes a fresh save feel incomplete if it doesn't use the filtered tag
- Keeps the fix frontend-only (no workspace reload or API traffic)
- Maintains regression coverage proving no extra fetches

**Impact:**
- Tag browsing still stays local and visible while browsing
- Note editor still reuses facet tags for autocomplete
- Regression coverage proves **New note** clears filter without re-fetching workspace data

**Status:** Merged into implementation scope, verified via test updates

### 2026-04-13: Conservative forgotten-issue sweep

**By:** Mikey (Lead)

**What:**
Ran a conservative pass over open GitHub issues and only closed items whose resolution was already unambiguous from `main` or from an already-completed spike outcome:

- **Closed #29** — the spike is complete and the recommendation is already recorded: defer graph-style tag relationships until after search, tag browsing, and mobile foundations.
- **Closed #32** — built-in campaign starter templates and note templates are already shipped on `main`.
- **Closed #33** — the recent activity API/UI flow is already shipped on `main`.

Left these open intentionally:

- **#23** — backend consolidation support exists, but the issue asks for an owner-facing consolidation flow and that UI is not clearly surfaced in the current app.
- **#24, #25, #26, #30** — still represent real unfinished product work in the current repo state.

**Why:**
For backlog hygiene, the safe rule is: close only when `main` clearly ships the user-facing outcome, or when a spike issue's recommendation has already been produced and adopted. If the repo only shows groundwork or a partial backend slice, leave the issue open and let implementation or product explicitly retire it later.

**Status:** Recorded & Complete

### 2026-04-13: Issue #25 Mobile Note Workspace Single-Pane Flow

**By:** Stef (Frontend Dev)

**What:**
On narrow screens (`<lg`), the authenticated note workspace switches from always rendering browse + editor together to an explicit single-pane toggle: **Browse notes** or **Edit/Create note**. Desktop keeps the split browse/editor layout.

**Why:**
Stacking both surfaces vertically still forces too much scrolling and context juggling on phones and tablets. A single-pane flow keeps browse tools together, gives the editor full width, and leaves room for future browse additions (search, tag facets, sessions, activity) without reintroducing crowding.

**Implementation Notes:**
- Keep browse state local (`noteBrowseMode`, tag filter, selected session/activity filter) so switching panes does not reload workspace
- Selecting a note or starting a new note automatically opens editor on narrow screens
- Editor exposes direct "Browse notes" button so users move between list and form without losing draft state
- Regression coverage in `apps/web/src/App.test.tsx` with `matchMedia`-driven narrow-screen tests

**Files Changed:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`

**Status:** IMPLEMENTED (commit `de1b16e`)

### 2026-04-13: Issue #25 Mobile Regression Bar — Note Workspace

**By:** Chunk (Tester)

**What:**
Treat the note workspace as **single-pane below `lg`** and **split-pane at `lg`+**. Maintain three critical regression paths before approval:

1. **Desktop dual-pane stays fast** — wide screens show note list and editor together
2. **Mobile existing-note save stays reachable** — narrow screens can open a note, edit it, save it, and return to refreshed list
3. **Mobile new-note launch stays direct** — tapping "New note" on narrow screens opens editor immediately and keeps save path available

**Why:**
The core mobile risk was not note rendering itself; it was forcing browse controls, note lists, and editor to live on screen at once. A narrow-screen toggle keeps list/detail workflow intact without inventing a second note system, and it leaves room for future browse additions without reintroducing complexity.

**Validation:**
- `npm run lint` ✓
- `npm run test` ✓ (all mobile-specific regression tests)
- `npm run build` ✓

**Files:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`

**Status:** APPROVED
