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

### 2026-04-12: Issue #27 — Session Browsing Frontend (REJECTED)
**By:** Chunk (reviewer)  
**Requested by:** FFMikha  
**Revision owner:** @copilot

**Verdict:** REJECT

**What I checked:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/types.ts`
- `README.md`
- Root validation: `npm run lint && npm run test && npm run build` (all passed)

**Findings:**
The UI shape is still the right thin v1: it stays inside the existing note shell, uses the approved session endpoints, keeps the existing detail pane, and resets toward the flat note flow in intent. But the shipped state wiring is not safe enough to approve.

1. `noteBrowseMode` is a dependency of `loadWorkspace()` in `apps/web/src/App.tsx`, which rebuilds `loadCampaigns()` and re-triggers the auth bootstrap `useEffect`. Toggling `All notes` / `Browse by session` therefore re-fetches the whole workspace, shows the full-screen workspace loader, and can overwrite local editor state.
2. That same dependency chain means `New note` from session mode is not reliably isolated from the existing note flow: the forced workspace reload can repopulate the draft from server data and kick the user back onto an existing note instead of leaving them in clean create-note mode.
3. `handleSelectSession()` has no stale-response guard or request cancellation. Fast session switching can leave the heading on the latest session while the note list/detail pane shows an earlier response that resolved later.
4. `apps/web/src/App.test.tsx` only covers the happy-path drill-in. It does not lock down the create-note reset requirement, the no-full-reload toggle behavior, or out-of-order session responses.

**Why this blocks approval:**
Issue #27 asked for a thin browse mode that preserves the existing note flow and avoids collisions with active note-creation/settings work. The current implementation looks thin, but the mode toggles are not local UI state in practice—they can reboot the workspace and disturb draft/editing state. That is exactly the kind of weird-at-the-table regression this slice was supposed to avoid.

**Re-approval bar:**
- Keep browse-mode reads out of the bootstrap dependency chain (use refs/current state reads instead of callback identity churn)
- Make session detail loading latest-selection-safe
- Add regression coverage for:
  - switching modes without a full workspace reload
  - starting a new note from session mode without losing create-note state
  - rapid session changes resolving out of order

**Status:** REQUIRES REVISION  
**Next owner:** @copilot (Stef locked out of this revision cycle)

**Files affected:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/types.ts`

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
- `apps/api/src/types.ts` (ActivityResponse shape)