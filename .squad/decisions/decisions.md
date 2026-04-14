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

---

### 2026-04-14: Future repo-specific docs/preview/release workflows are in scope

**By:** FFMikha (via Copilot)
**Date:** 2026-04-14

## Decision

`dnd-notes` may eventually add docs, preview, and release workflows, but they must be built for this repo's actual branch strategy, build/test commands, deploy targets, and SHA-pinning policy. Do not restore the stock Squad CLI release/docs/preview templates as-is.

## Why

The user is interested in those lanes long-term, but the upgrade-added versions target the Squad CLI product repo rather than this app repo. Their assumptions around `preview` / `insider` branches, `CHANGELOG.md`, root `test/*.test.js`, and a dedicated docs site make them misleading noise until they are rewritten for `dnd-notes`.


---

### 2026-04-13: Phase 2 Implementation — Markdown Editor & Inline References (APPROVED)

**Consolidated by:** Scribe (2026-04-13T19:08:05Z)  
**Original recommendations:**
- `stef-phase2-editor.md` — Stef (Frontend architecture)
- `data-note-reference-phase2.md` — Data (Backend reference strategy)

**Status:** APPROVED — Team aligned, green-lit for immediate execution

## Overview

Phase 2 adds a dual-mode markdown editor and support for inline note references. Frontend focuses on editor UX (toggle, Lexical, custom nodes); backend adds a references table for safe migration from the current `linkedNoteIds` field.

## Frontend Decision: Keep Markdown Canonical

**The editor and data flow remain markdown-first.**

- API contract: `body: string` stores pure markdown
- `react-markdown` + `remark-gfm` render client-side (status quo)
- Lexical editor (Phase 2b) imports/exports markdown without conversion
- Inline references use markdown syntax: `![[noteId|label]]`
- Backend stores references embedded in `body` until Phase 3 (structured extraction)

**Why:** No format fragmentation, no conversion bugs, Lexical node system cleanly supports custom syntax.

## Backend Decision: Staged Migration to References Table

**Phase 2a schema addition:** `note_references` table as single source of truth

```sql
CREATE TABLE note_references (
  id TEXT PRIMARY KEY,
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  reference_type TEXT NOT NULL,  -- 'implicit' (body-derived) | 'explicit' (linkedNoteIds)
  position_in_body INTEGER,       -- null for explicit; char offset for implicit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_note_id, target_note_id, reference_type, position_in_body)
);

CREATE INDEX idx_references_target ON note_references(target_note_id, campaign_id);
CREATE INDEX idx_references_source ON note_references(source_note_id, campaign_id);
```

**Why this approach:**
- Single source of truth for all link queries
- `reference_type` splits body-derived (new) vs. explicit (old `linkedNoteIds`)
- Safe migration window: both systems coexist, lazy sync on first read/write
- Target ID in table (not title) means rename operations don't break references
- Indexed for fast "what links to this note?" queries

**No API breaking change:** `linkedNoteIds` field remains in responses for 1–2 major versions.

## Phased Editor Implementation

### Phase 2a: Mode Toggle (1–2 days, start immediately)

- **What:** Add a button to hide/show the stacked markdown preview
- **Code change:** `App.tsx` line 3655–3682, add `showPreview` state and conditional render
- **Benefit:** Immediate UX win; ship fast; validate cadence
- **Owner:** Stef or Copilot
- **Blocker:** None

**Backend parallel work (Phase 2a):**
- Design `note_references` table schema
- Implement `NoteStore.syncLinkedNotesIntoReferences()` for lazy migration
- Write migration tests (legacy data, cross-campaign, validation)

### Phase 2b: Lexical Editor (4–5 days, post-2a)

- **What:** Replace plain `<textarea>` with markdown-native Lexical editor
- **Setup:**
  - Add `lexical` + `@lexical/markdown` to `apps/web/package.json`
  - Create `NoteEditor.tsx` wrapping `LexicalComposer`
  - Markdown import/export via `@lexical/markdown` config
  - Optional raw-markdown mode (toggle to edit raw text)
- **Scope:** Basic nodes (paragraph, heading, emphasis, code, blockquote, lists)
- **Acceptance:** Save/load cycle preserves markdown byte-for-byte; all tests pass
- **Owner:** Stef
- **Blocker:** None

**Backend parallel work (Phase 2b):**
- Extend `NoteInput` with optional `inlineReferences` field
- Modify `createNote()` and `updateNote()` to accept and normalize both `linkedNoteIds` and `inlineReferences`
- Implement backend re-parsing of body to validate parser consistency

### Phase 2c: Inline Reference Nodes (2–3 days, post-2b)

- **What:** Editor support for `![[noteId|label]]` syntax with a reference picker
- **Scope:**
  - Custom Lexical `NoteRefNode` that parses/renders/exports reference syntax
  - Reference picker modal (Autocomplete, current campaign notes)
  - Inline pills in formatted view; raw syntax in markdown mode
  - Validation on blur/save (target must exist, same campaign)
- **Acceptance:**
  - Editor recognizes and renders references
  - Save preserves syntax in markdown
  - References appear safely in excerpts (as plain text, no `![[...]]`)
  - Backlinks auto-update if note adds a reference
- **Owner:** Stef + Data
- **Blocker:** None (Phase 2 embeds syntax; structured extraction is Phase 3)

**Backend work (Phase 2c):**
- Add `GET /api/notes/:noteId/references` endpoint
- Rename `getBacklinks()` to `getIncomingReferences()`, return from table
- Add reference-aware search (filter by `referencesOnlyTo`, `referencedBy`)

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Lexical bundle bloat (50KB+) | Medium | Code splitting; defer to notes route. Measure impact before Phase 2b merge. |
| Round-trip markdown mutation | Medium | Unit tests (byte-for-byte comparison on all existing notes); regression coverage. |
| Dual-source confusion during migration | High | Clear `reference_type` semantics; deprecation notice in API docs; update guides. |
| Backlinks show stale data | Medium | Recompute in `loadWorkspace` effect whenever notes change; regression test coverage. |
| Parser divergence (editor != backend) | Medium | Backend re-parses body on write; mismatch returns 400. |

## Timeline

| Phase | Owner | Est. | Blocker | Target Date |
|-------|-------|------|---------|-------------|
| 2a (toggle + schema) | Stef/Data | 1–2d | None | Week of 2026-04-14 |
| 2b (Lexical + parser) | Stef/Data | 4–5d | Phase 2a | Week of 2026-04-21 |
| 2c (references UI + endpoints) | Stef/Data | 2–3d | Phase 2b | Week of 2026-04-28 |
| **Phase 2 total** | — | **7–10d** | None | **2026-05-02 (best case)** |

## Acceptance Criteria for Phase 2 Complete

- [ ] Mode toggle hides/shows preview without draft loss
- [ ] Lexical editor renders all markdown formats correctly
- [ ] Save/load cycle preserves markdown (byte-for-byte)
- [ ] Raw markdown mode available (toggle shows source)
- [ ] `note_references` table created, indexed, and populated
- [ ] Legacy `linkedNoteIds` synced lazily to `note_references`
- [ ] NoteInput accepts both old and new reference formats (backward compatible)
- [ ] Reference picker inserts `![[noteId|label]]` syntax correctly
- [ ] Excerpts sanitize references safely (no `![[...]]` in output)
- [ ] Search finds notes and their references (no special syntax required)
- [ ] All existing tests pass (26 baseline + Phase 2 regression coverage)
- [ ] No performance regression (bundle, load, save times)
- [ ] Backlinks panel updates when new reference added to another note

## Migration Window

**Minor version N:** Ship Phase 2a schema. Both `linkedNoteIds` and `inlineReferences` accepted; normalized to `note_references` table.  
**Minor version N+1:** All reads go through `note_references` table. Deprecate `linkedNoteIds` from API response.  
**Minor version N+2:** Remove `linkedNoteIds` field entirely.

## Markdown Sanitization (Excerpts) — Status: ✅ Ready

Current `excerpt()` function in `App.tsx:331` uses `markdownToPlainText()` from `note-formatting.tsx`:
- Already strips markdown syntax (headings, emphasis, code, blockquotes)
- Handles HTML tag stripping via `/<[^>]+>/g` regex
- Collapses whitespace, limits to 112 chars
- Will sanitize `![[...]]` syntax to plain text safely

**No changes needed for Phase 2.** The function is solid.

## Notes for Product (Mikey)

- Timeline is flexible: Phase 2a can ship independently if UX validation needed
- Recommend: Ship 2a (1–2d) → gather feedback → start 2b while settling
- Phase 2c scope (inline references) can be refined post-2b based on user testing
- No user-facing breaking changes; all work is additive

## Next Steps

1. **Immediate:** Stef begins Phase 2a (mode toggle implementation)
2. **Parallel:** Data designs Phase 2a schema + test migration logic
3. **Week 1:** Phase 2a PR ready for review
4. **Week 2:** Phase 2b architecture review + Lexical setup
5. **Week 3–4:** Phase 2b/2c execution and QA
6. **Week 5:** Phase 2 complete (best case)

---

---

### 2026-04-14: Squad upgrade workflow syncs must be audited for repo fit and SHA pinning

**By:** Brand (Platform Dev)

## Context

Running `squad upgrade` in this repo reintroduced floating-tag GitHub Actions refs in existing squad workflows and also dropped in several new active workflows aimed at Squad CLI release/docs branches (`dev`, `preview`, `insider`, root `test/*.test.js`, `docs/`, `CHANGELOG.md`). Those additions do not match this app repo's structure or release flow.

## Decision

1. Treat `.squad/templates/workflows/` as the source of truth for synced squad workflows.
2. After every `squad upgrade`, audit active `.github/workflows/` for:
   - commit-SHA pinning on every `uses:` reference
   - repo fit (branches, directories, commands, and release assumptions)
3. Keep only the workflow set that fits this repo today:
   - `sync-squad-labels.yml`
   - `squad-triage.yml`
   - `squad-heartbeat.yml`
   - `squad-issue-assign.yml`
   - `squad-label-enforce.yml`
   - `web-test.yml`
4. Remove upgrade-added active workflows when they clearly target a different project shape instead of pinning them and carrying dead automation.

## Rationale

- Pinning alone is not enough if the workflow itself assumes the wrong repo topology.
- Using the mirrored template as the sync source avoids one-off drift in the squad-managed files we do keep.
- Pruning clearly wrong release/docs workflows keeps the repo moving without silently adopting brittle automation.

## Files

- `.github/workflows/`
- `.squad/templates/workflows/`
- `.squad/agents/brand/history.md`


### 2026-04-14: Web test infrastructure should route through root workspace scripts and focused smoke CI

**By:** Brand (Platform Dev)

## Context

The existing `.github/workflows/web-test.yml` was not giving real coverage because it called `npm run ... --workspace web`, but this repo defines workspaces by path (`apps/web`, `apps/api`). The workflow therefore failed before lint, test, or build work even started.

At the same time, the practical blocker for Issue #24 follow-up work was not "no way to run any web tests" anymore — focused Vitest runs like `CampaignSearch.test.tsx` execute cleanly when invoked correctly. What was missing was a stable, discoverable entrypoint for that focused slice and a CI lane that exercised it.

## Decision

1. Add root-level web entrypoint scripts in `package.json`:
   - `lint:web`
   - `build:web`
   - `test:web`
   - `test:web:focused`
2. Keep the full web suite available via `npm run test:web`.
3. Point `.github/workflows/web-test.yml` at the new root scripts and keep the CI lane intentionally focused on the fast smoke slice (`note-formatting`, `NoteBodyEditor`, `CampaignSearch`) instead of the long all-in-one `App.test.tsx` suite.

## Rationale

- Root scripts remove guesswork and avoid repeating brittle workspace selectors across workflow files.
- Using `apps/web` matches the actual npm workspace layout and fixes the current CI no-op/failure mode.
- A focused smoke lane is the thinnest useful CI slice for this batch: it proves lint/build/test plumbing end-to-end and gives immediate regression coverage for the active web search work without pretending the full integration suite is fast enough for every PR gate.

## Files

- `package.json`
- `.github/workflows/web-test.yml`


# Chunk — Web regression test decision

## Decision
Keep apps/web/src/App.test.tsx as a narrow smoke suite and move deeper behavior coverage into focused feature files.

## Why
The old monolithic App integration file was the flaky surface: it blocked the suite while smaller App mounts and focused campaign-search tests ran cleanly. A tiny smoke path still proves the app can render, authenticate, and reopen a saved workspace, while dedicated files like apps/web/src/CampaignSearch.test.tsx cover search behavior without reintroducing that instability.

## Impact
- apps/web/src/App.test.tsx should protect only the minimal app-boot smoke path.
- New frontend regressions should prefer dedicated test files with endpoint-scoped fetch mocks.
- Search coverage now explicitly includes session-name and collaborator-name matching alongside title/body/tag behavior.


### 2026-04-14T15:13:34Z: User directive
**By:** FFMikha (via Copilot)
**What:** Never skip signing; rewrite unsigned local commits into a signed commit before continuing.
**Why:** User request — captured for team memory


# Web Test Infrastructure P1 — Scope & Reviewer Gate

**Date:** 2026-04-14  
**Owner:** Mikey (Lead)  
**Status:** ACTIVE — Work assigned to Brand & Chunk

## Problem Statement

- **vitest 4.1.4 hangs indefinitely** when running tests that render the App component
- **No CI workflow** exists to catch web test failures
- **Regression coverage blocked** for all feature work touching UI
- **Impact:** Issue #24 merged without test validation; future features at risk

## Thinnest Slice for Success (This Pass)

This pass focuses on **restoring test infrastructure**, not rewriting the entire test stack.

### 1. **Root Cause Investigation** (Brand — Tester)
**Goal:** Determine if vitest 4.1.4 is genuinely incompatible, or if there's a fixable configuration issue.

**Definition of Done:**
- [ ] Isolate the hang: Create minimal reproduction (e.g., simple React component + vitest)
- [ ] Test matrix: Confirm whether simple components test fine, only App.tsx hangs
- [ ] Configuration audit: Check `vite.config.ts` for pool/timeout/environment issues
- [ ] Upstream research: Check vitest 4.1.4 + React 19 + MUI 9 known issues
- [ ] Decision: **Either (a) fixable config tweak, (b) downgrade to vitest 3.x, or (c) switch test runner**

**Risk boundary:** Investigation must complete in 2–4 hours. If root cause unclear, recommend fallback (see below).

---

### 2. **Fallback Test Runner Path** (Chunk — QA)
**Trigger:** If vitest 4.1.4 cannot be fixed in investigation.

**Option A: Downgrade to vitest 3.x**
- Safest path if vitest 4.x is a genuine regression
- Tests for smaller components (CampaignSearch, NoteBodyEditor) already pass in current vitest
- Downgrade + re-run all tests to confirm coverage
- **Time estimate:** 1–2 hours

**Option B: Stay with vitest 4.1.4 but skip App.test.tsx**
- Move App component full-integration tests to Playwright (out of scope for this pass)
- Run unit/component tests (CampaignSearch, NoteBodyEditor, note-formatting) in CI
- Document that full-stack App tests require E2E framework
- **Time estimate:** 1–2 hours

**Definition of Done (for chosen option):**
- [ ] New test configuration validated locally (all working tests pass)
- [ ] CI workflow created: `web-test.yml` runs `npm run test` in `apps/web/`
- [ ] Workflow succeeds on main
- [ ] README updated with test expectations (which tests run in CI, which are E2E-only)

---

### 3. **CI Workflow** (Brand — Tester)
**Parallel to investigation; can start immediately.**

**Goal:** Create `web-test.yml` that runs web tests on PR/merge.

**Definition of Done:**
- [ ] Workflow file: `.github/workflows/web-test.yml`
- [ ] Trigger: On PR `opened`, `synchronize`, and on `push` to `main`
- [ ] Job: `npm run lint --workspace web` + `npm run test --workspace web` (with 30–45s timeout per test)
- [ ] Artifact: Publish test results (or fail loudly if tests timeout)
- [ ] Tested: Merge a dummy commit to trigger workflow; verify it passes
- [ ] **No action pinning required yet** — use major version refs for this pass (Brand will handle pinning separately per existing decision)

---

## Reviewer Gate & Handoff

### For Brand (Tester)
**Before merge to main:**
1. Investigation complete: vitest 4.1.4 root cause identified OR fallback option chosen
2. CI workflow passes: `web-test.yml` runs successfully on main
3. Test suite stable: No timeouts, all expected tests passing
4. **Approval from:** Chunk (QA)

### For Chunk (QA)  
**Before merge to main:**
1. Validate fallback path if taken: Downgrade or skip App.test.tsx works as documented
2. Run full `npm run test && npm run lint && npm run build` locally; all pass
3. Review test expectations against implementation reality
4. **Approval from:** Mikey (Lead)

### Mikey (Lead) Gate
- [ ] Problem is solved (tests either fixed or moved to E2E)
- [ ] CI is wired and reporting correctly
- [ ] Scope stayed thin (no sweeping refactor)
- [ ] README updated for team clarity
- [ ] **APPROVE for merge only if all above completed**

---

## Non-Goals (Explicitly Out of Scope)

- Full App.test.tsx rewrite (defer to Playwright E2E suite post-Phase 2)
- Upgrading vitest beyond investigating 4.1.4 compatibility
- Adding new test coverage (focus on restoring existing tests)
- Refactoring mock setup patterns (document in README if needed)

---

## Success Metrics

At end of this pass:
1. ✅ Web tests run without hanging (or hang is documented as E2E-only)
2. ✅ CI catches web test failures
3. ✅ All simple component tests (CampaignSearch, NoteBodyEditor) run in CI
4. ✅ Team knows what to expect from web test coverage going forward

---

## Decision Log

- **Decided:** 2026-04-14 by Mikey
- **Routing:** Brand (investigation + CI) + Chunk (validation + fallback)
- **Timeline:** 1 pass (est. 4–6 hours for investigation + CI + validation)
- **Approval path:** Brand → Chunk → Mikey

