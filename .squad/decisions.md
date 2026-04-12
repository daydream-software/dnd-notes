# Squad Decisions

## Active Decisions

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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
