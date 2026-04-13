# Team Decisions Log

This document records all architectural decisions, routing directives, and feature approvals that shape the product backlog and implementation strategy.

---

### 2026-04-12: Issue #28 Frontend-First Tag Discovery Slice — APPROVED

**Merged by:** Scribe (2026-04-12T23:08:49Z)  
**Original inbox decisions:**
- Code review verdict
- Design decision

## Decision Summary

Stef's frontend-only tag discovery and filtering UI is **APPROVED** and ship-safe. Tag facets and filtering work entirely within existing campaign-scoped state. Implementation reuses tag data in note-editor autocomplete.

## Approval Criteria Met

1. ✅ No backend changes required
2. ✅ Campaign scoping preserved (no cross-campaign bleed)
3. ✅ Issue #27 regression pattern avoided
4. ✅ High-quality autocomplete component
5. ✅ Clear empty states
6. ✅ Self-healing behavior (auto-clear when tag disappears)
7. ✅ Regression coverage (core flow proven in test)

## Impact

- Unblocks issue #24 (search foundation)
- Tag infrastructure now in place for future graph relationships
- Ready to merge; no schema changes, no backend work

## Non-Blocking Gaps (Future Work)

- Case-sensitive tag matching (mixed-case legacy tags)
- `handleStartNote` UX polish (doesn't clear selected tag)
- Multi-tag AND filtering (deferred to search/foundation work)

## Files Affected

- `apps/web/src/App.tsx` (tag facets panel, tag-based filtering)
- `apps/web/src/App.test.tsx` (regression test + adapted suite)
- `README.md` (feature summary update)

## Status

**APPROVED** — Merge safe. Unblocks search foundation (#24).

---

### 2026-04-13: Issue #28 Implementation Decision — Ship Frontend-Only

**By:** Stef (Frontend Dev)  
**Date:** 2026-04-13

## Decision

Ship the approved tag-discovery slice entirely inside `apps/web/src/App.tsx`:

- Derive campaign-scoped tag facets and counts from the already loaded `notes`
- Keep the active single-tag filter in local client state only
- Reuse the same tag list for note-editor autocomplete suggestions
- Auto-clear the active tag filter when refreshed notes no longer contain that tag

## Why

This keeps the browse UX fast, avoids the rejected #27 pattern of mode-driven workspace reloads, and gives quick tag reuse without inventing a backend contract early.

## Files Changed

- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`
- `README.md`

---

### 2026-04-13: Post-#33 Lane Recommendation — Issue #28 (consolidated routing)

**By:** Mikey (Lead)  
**Date:** 2026-04-13 (consolidated from three routing decisions)  
**Original decisions:**
- `mikey-post-33-lane.md` — Initial recommendation
- `mikey-issue-28-routing.md` — Final confirmation
- `mikey-correct-post-33-lane.md` — Context correction (PRs already merged)

## Decision

**Proceed with Issue #28 immediately after #33 lands.** The tag infrastructure work is a thin-slice, zero-dependency foundation that unblocks the critical-path search work (#24).

## Rationale

1. **Zero dependencies** — Can start immediately when #33 merges. No blocking issues, no file contention.
2. **Small, focused scope** — ~150 lines of code total (no schema changes, backward compatible).
3. **Unblocks critical path** — #28 (tag infrastructure) → #24 (search + filters) → #25 (mobile).
4. **No file collisions** — Recent PRs (#35, #36, #33) saturate App.tsx and app.ts; #28's sidebar component and endpoint are isolated.
5. **Matures tag model** — Adds query-based tag awareness before search complexity lands.

## Thin Slice Scope

### Backend (~50 lines + tests)
- `NoteStore.listTagsWithCounts(campaignId)` → `{ tag: string; count: number }[]`
- `GET /api/campaigns/:campaignId/tags` endpoint, owner-auth required
- No schema changes; respects campaign boundaries

### Frontend (~100 lines)
- `TagsPanel.tsx` read-only sidebar component
- Integration into App sidebar
- `fetchTags(campaignId)` in api.ts

### Testing
- API: auth, foreign rejection, empty state, count accuracy
- Web: render empty, render with counts, no filter wiring yet (deferred to #24)

## Post-#28 Work

Once #28 merges:
1. **Immediately route #24 (search)** — Now unblocked; highest priority
2. **Queue #25 (mobile)** — Remains blocked until #24 confidence
3. **Parking lot** — #26 (rich formatting), #30 (note links) require design gates

## Confidence

**HIGH.** Architecture is proven; NoteStore already groups/counts in session queries. No schema changes needed. Frontend sidebar integration is standard Material UI pattern.

---

### 2026-04-13: Operational Setup for Issue #28 — Frontend-Only Implementation

**By:** Brand (Platform Dev)  
**Date:** 2026-04-13  
**Status:** READY TO EXECUTE

## Context

Main worktree is clean (all #33 work merged to commit 762fe1d). Issue #28 scope is frontend-only tag discovery + filtering UI (APPROVED, no backend changes).

## Recommendation: Feature Branch Approach

**Use a dedicated feature branch for #28, created from clean main.** Git worktrees are not needed here because:
- No blocking parallel work in main right now (all PRs merged, rebase complete)
- @copilot or Stef can work linearly in a single worktree without interruption
- Thin slice scope (~3–4 hours for frontend autocomplete + facets panel)
- Feature branch is simpler to manage and audit

## Setup Steps

### 1. Create Feature Branch

```bash
cd /home/adelisle/workspace/dnd-notes
git fetch origin
git checkout -b issue/28-tag-facets-autocomplete origin/main
```

**Branch naming rationale:**
- Prefix `issue/` signals issue-driven work (matches team convention)
- Include issue number for tracking
- Slugified description aids discoverability

### 2. Verify Clean Baseline

```bash
npm run test        # All tests pass against current code
npm run build       # Build succeeds
npm run lint        # Lint clean
```

### 3. Implementation Scope

**Frontend only** (no API changes):
- `apps/web/src/` tag autocomplete component (reuse existing note-editor TagsField)
- `apps/web/src/App.tsx` tag facets panel (list tags with counts, click to filter notes)
- `apps/web/src/App.test.tsx` regression coverage
- `README.md` feature summary

**No backend changes required** — tag data sourced from existing campaign notes.

### 4. Pre-PR Verification Checklist

Before opening a PR:

```bash
npm run lint         # No style violations
npm run test         # All tests pass
npm run build        # Clean build, no warnings
git diff origin/main # Review file changes (should be web/ + README only)
```

**Expected files changed:**
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`
- `README.md`

### 5. Merge to Main (After Code Review + Tests Pass)

**Preferred: Fast-forward merge (linear history)**

```bash
git checkout main
git pull origin main
git merge --ff-only issue/28-tag-facets-autocomplete
git push origin main
```

**Alternative: Squash merge (single clean commit)**

```bash
git merge --squash issue/28-tag-facets-autocomplete
git commit -m "feat: add tag facets, counts, and autocomplete (issue #28)

- Tag discovery panel with counts for campaign browsing
- Note editor tag autocomplete (suggest previously used tags)
- Campaign-scoped filtering (no cross-campaign data bleed)
- Regression coverage: core filter flow proven in 30+ test cases

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin main
```

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|-----------|
| Accidental `node_modules` changes | Very Low | `.gitignore` excludes `node_modules/`; branch is feature-only |
| Merge conflict with in-flight PRs | Very Low | #28 touches only web autocomplete + facets; no API changes |
| Stale node dependencies during long feature branch | Low | Run `npm audit` weekly; no new deps added for #28 |
| Regression in existing tests | Low | Regression test matrix (30+ cases) defined |

## Summary

**Status: READY**

Main worktree is clean and verified. Create branch `issue/28-tag-facets-autocomplete` from clean main and begin implementation. Estimated duration: 3–4 hours (frontend + regression tests).

---

### 2026-04-13: Issue #24 — Campaign Note Search with Filters (Acceptance Criteria)

**Prepared by:** Chunk (Tester)  
**Date:** 2026-04-13  
**Status:** PREP ONLY — Acceptance criteria and regression target list for future implementation

## Charter

Defines acceptance criteria and regression target tests for issue #24: adding a search UI with multi-filter capabilities to find campaign notes by title, body, tags, session, and collaborator. The feature must respect campaign scope, owner/collaborator access, work on mobile, and integrate cleanly with existing flows.

## Product Goals

1. **Search in one campaign at a time** — respects the selected campaign and never bleeds results across campaigns
2. **Find notes by content** — title and body full-text matching (case-insensitive)
3. **Filter by metadata** — tags (AND logic), session name, collaborator who created/edited
4. **Preserve access model** — only show notes the user can edit/view based on campaign membership
5. **Mobile-safe UX** — filters and results stack naturally on small screens
6. **Integrate with existing flows** — quick capture, session browsing, activity view work together without interference

## Key Acceptance Criteria (Subset)

### AC1: Search Input & Scope
- Search updates in real-time (debounced ≥200ms)
- Search scoped to selected campaign only
- Empty search shows all notes
- Search text preserved when toggling between browse modes

### AC2: Title and Body Matching
- Case-insensitive matching
- Both title and body searched (match-any = OR)
- Partial word match supported
- Special characters literal (not regex)

### AC3: Tag Filtering
- Selected tags shown as chips
- AND logic: only notes with ALL selected tags shown
- Tag matching case-insensitive with normalization
- Facet count accurate
- Multiple-tag deselect works

### AC4: Session Filtering
- Filter shows only notes tagged with that session
- "(No session)" option for unassigned notes
- "All sessions" clears filter
- Works in combination with search + tags

### AC5: Collaborator/Member Filtering
- Shows notes created or last edited by member
- Collaborator name displayed with optional role badge
- Filter shows only collaborators in current result set
- Null attribution handled gracefully

### AC6: Mobile-Safe UI Behavior
- Search input and filters stack vertically
- Touch-friendly tap targets (min 44px)
- Results full-width and scrollable
- Active filters visible and removable
- No layout shift when filters expand/collapse

### AC7: Access Control
- Only notes in linked campaign are searchable
- Search results respect note edit permissions
- Collaborator filters show only current campaign members
- Guest users (shared link) see their campaign's notes only

---

### 2026-04-13: Issue #33 Activity Feature Landing Analysis

**By:** Brand (Platform Dev)  
**Date:** 2026-04-13  
**Status:** APPROVED — Safe to land as single atomic commit

## Context

The dirty tree contains Issue #33 Activity Feature (Backend + Frontend) ONLY. No mixing with #28 or other work.

## What's Present

### Backend (Issue #33 Activity Endpoints)
- `POST /api/campaigns/:campaignId/memberships/consolidations`
  - Membership consolidation backend (preview/apply mode)
  - No schema changes, pure business logic
  - Validation: `validateMembershipConsolidationInput` added

- `GET /api/notes/activity?campaignId=...&membershipId=...&limit=20`
  - Recent activity endpoint with collaborator filtering
  - Returns: activity entries + collaborator summaries
  - Membership-aware auth via `resolveAccessibleCampaign()`
  - Regression test coverage: owner/guest access, filter isolation, foreign rejection, claim validation
  - Test count: 24 API tests passing

### Frontend (Issue #33 Activity UI)
- Activity browse mode (`noteBrowseMode = 'activity'`)
  - Recent activity list (sorted by `updatedAt` descending)
  - Collaborator sidebar with click-to-filter, click-again-to-clear
  - Created vs. edited action distinction with actor attribution
  - Empty state handling
  - Membership-aware access (linked collaborators supported)
  - Test count: 16 web tests passing

## What's NOT Present

- **Issue #28 (Tag Facets):** No tag infrastructure changes
- **Consolidation UI:** Backend endpoint exists, but no modal/form UI in App.tsx
- **Other features:** Only #33 is dirty

## Safe Landing

**NO SPLIT NEEDED.** All changes are tightly coupled to Issue #33. Consolidation endpoint is preparatory infrastructure, not a separate feature—it's part of the same issue scope.

### Merge Risk: ✅ LOW
- Approval chain complete
- All tests green (40 total: 24 API + 16 web)
- No schema changes, pure endpoint + UI additions
- Membership-aware auth uses existing `resolveAccessibleCampaign()` (no new auth model)
- Session browsing endpoints (#27) already landed; activity builds on same pattern

### Regression Risk: ✅ MINIMAL
- Five explicit regression gates (RT1–RT5) all passing
- Activity endpoint does not trigger workspace reload
- Collaborator filter uses refs, not callback identity
- Stale-response races on rapid filter clicks prevented (abort controllers + monotonic IDs)
- Empty states intact across all modes

## Decision

Land Issue #33 (Activity Feature) as a single atomic commit. No split needed.

---

---

### 2026-04-13: PR #37 Review — Mikey Lead Approval

**By:** Mikey (Lead)  
**Date:** 2026-04-13  
**Status:** APPROVE with merge conditions

## Context

PR #37 is the `@copilot` revision of Issue #28 tag facets after Chunk rejected the earlier branch for a list/detail mismatch: the note list could narrow under a tag filter while the editor still pointed at a hidden note.

## Review Outcome

- ✅ **Primary blocker is fixed.** `apps/web/src/App.tsx` now reconciles the selected note against the visible filtered set with `syncNoteSelectionToVisibleNotes`, and `handleSelectTagFilter()` applies that reconciliation immediately when a tag is selected.
- ✅ **Safety net is in the right place.** The follow-up `useEffect` keeps the editor aligned when filtered notes change after edits or deletes, so the fix is not limited to the click path.
- ✅ **Regression proof exists.** `apps/web/src/App.test.tsx` now covers the rejected case: select a non-matching note, apply a tag filter, verify the editor retargets to a visible note, then clear the filter and confirm the full list returns.
- ✅ **Scope stays thin.** The PR remains frontend-only for Issue #28, matching the approved direction: local tag facets, local filtering, editor autocomplete reuse, no backend/schema/API sprawl.
- ✅ **Validation is green locally.** `npm run lint && npm run test && npm run build` passed on both `main` and `pr-37-review`.

## Changed Files Check

- `apps/web/src/App.tsx` and `apps/web/src/App.test.tsx` contain the meaningful product change and match the previously approved repair strategy.
- `README.md` accurately describes the shipped tag-browsing behavior.
- `.squad/` history/decision/context file updates are consistent with the routing and review trail; no process mismatch found there.

## Remaining Merge Conditions

1. **Chunk QA sign-off is still required** per the documented routing plan for this revision cycle.
2. **PR #37 is still a draft,** so it should be marked ready once the QA gate is satisfied.
3. **Normal branch protections still apply.** GitHub did not show attached check runs on the PR during this review, so local validation is the current evidence.

## Verdict

**Lead approval: yes.** I do not see a remaining architecture or correctness blocker in the fix itself. Once Chunk signs off and the PR is moved out of draft, this is ready to land.

---

### 2026-04-13: PR #37 QA Review — Chunk Approval

**By:** Chunk (Tester)  
**Date:** 2026-04-13

## What I checked

- Re-reviewed the list/detail sync repair in `apps/web/src/App.tsx`, especially the eager re-selection in `handleSelectTagFilter()` and the `useEffect` safety net that reconciles `selectedNoteId` against `displayedNotes`.
- Re-reviewed the regression coverage in `apps/web/src/App.test.tsx`, with special attention to filter switching, clearing, and preserving tag-filter behavior across adjacent flows.
- Re-ran the repo verification bar: `npm run lint && npm run build && npm run test`.
- Re-ran the two tag-focused web regressions directly:
  - `syncs the selected note when a tag filter excludes the current detail pane note`
  - `derives tag facets locally, clears the active filter for a new note, and reuses tags in the editor`

## Verdict

**APPROVED.** PR #37 retires the ship blocker from issue #28 and is ready to come out of draft / merge.

## Why it clears QA

- The original failure mode is covered now: starting from a selected non-matching note, clicking a tag facet re-targets the editor to a visible note instead of leaving the detail pane stale.
- Switching from a single-match tag to a multi-match tag still leaves the editor aligned with the filtered list.
- Clearing the filter restores the full list without breaking the selection state.
- The no-fetch/local-tag-browsing behavior from the earlier slice still holds.

## Non-blocking follow-up

- I would still like a future explicit regression around editing or deleting the active filtered note while a tag filter remains on. The current code path looks safe because the filtered-list effect reuses the same helper as direct tag clicks, so this is hardening work, not a release blocker.

---

## Archive

Older decisions have been moved to `.squad/decisions/archive/` for historical reference.
