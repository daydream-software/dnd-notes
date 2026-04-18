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
- **PR #51 review (2026-04-17):** For docs-focused PRs, keep merge scope to the user-facing docs plus any required tracked squad history; a repo-root `plan.md` is session-planning residue, not ship material, and should be removed before merge.
- **PR #51 re-review (2026-04-17):** Once the stray `plan.md` is gone, the remaining shape is acceptable: the restore-rehearsal checklist belongs in `README.md`, and `.squad/agents/copilot/history.md` is valid only as durable squad context, not as a substitute for product docs.
- **Origin-model handoff (2026-04-16):** Frontend API access is already centralized behind `VITE_API_BASE_URL` in `apps/web/src/api.ts`, so the missing production seam is backend-owned share-link URL generation, not web fetch plumbing. `apps/api/src/app.ts` currently builds share URLs from `Origin` or `request.protocol + host`, while CORS is blanket `app.use(cors())`; safest next slice is an explicit API env like `PUBLIC_WEB_URL` for canonical `/share/:token` links, README + `.env.example` docs, and API tests proving env-first behavior with request fallback kept only for local/dev compatibility.
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

## 2026-04-13: Post-#33 Routing Correction & Landing Order Analysis

📌 Team update (2026-04-13): Mikey completed routing correction pass confirming next lane post-#33. Corrected stale assumption (PRs #35, #36 pending) with actual state (both merged). Routing decision unchanged and confirmed: zero-dependency path to Issue #28 immediately after #33 lands. Reviewed `NoteStore.ts` for tag-query pattern fit; no architectural surprises. Landing order confirmed: #33 → #28 → #24 → #25; #26, #30 parking lot. #28 ownership: Stef preferred, Copilot fallback (4–6h). Decision: PROCEED WITH #28 (CONFIRMED). Full analysis: `.squad/decisions/inbox/mikey-correct-post-33-lane.md`

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
📌 Team update (2026-04-13T00:04:28Z): Issue #27 COMPLETE — Frontend UI approved and merged after @copilot's revision (PR #36). Parallel lane decision on Issue #33 (activity UI) RESOLVED: Issue #33 UI unblocked post-PR-#36 merge, Issue #28 (tag facets) remains safe parallel option. PR #36 merged on main. Issue #33 queued for immediate assignment (primary: Stef, fallback: @copilot). Frontend thin slice scope: activity feed UI, collaborator filter sidebar, created/edited attribution, empty state. Backend contract stable. Regression test plan documented (RT1–RT5 gates). Awaiting product decisions on shared-workspace activity support and filter privacy. Assignment in orchestration log. No blocking architectural decisions — decided by FFMikha, Chunk, Scribe

## 2026-04-13: Issue #28 Routing Review & Artifact Commit

**By:** Mikey (Lead)

**What:**
Examined process state: Stef's issue #28 implementation rejected by Chunk for list/detail mismatch (can edit a note that's invisible in filtered view). Coordinator rerouted to @copilot before artifact was pushed to GitHub, creating a broken handoff risk (private rejection, no public artifact).

**Action Taken:**
1. ✅ Committed Stef's full artifact to `issue/28-tag-facets-autocomplete` with clear failure reason in commit message (commit `fc8a467`)
2. ✅ Pushed branch to GitHub—artifact now discoverable, handoff integrity restored
3. ✅ Verified Brand's repair path: keep artifact on branch, let @copilot revise against baseline
4. ✅ Documented routing decision: `.squad/decisions/inbox/mikey-issue-28-routing.md`

**Verdict:**
- ✅ **Process state is correct:** rejection gate working, artifact public, routing explicit
- ✅ **No other routing change needed:** Stef locked out (correct), @copilot owns revision, Chunk re-reviews after fix
- ✅ **Blocker is architecturally sound:** List/detail sync is a core trust boundary; fix must reconcile `selectedNoteId` with `filteredNotes` (either retarget or clear to create state)

**Recommendation:**
Proceed with planned revision. Copilot should: (1) pick a list/detail reconciliation strategy (soft redirect or clear to create), (2) implement safety check in `handleSelectNote` or tag-filter handler, (3) add regression test, (4) rerun tests; Chunk re-reviews.

---

## 2026-04-13: PR #37 Review — Tag Filter Sync Fix

**By:** Mikey (Lead)

**What:**
Reviewed PR #37, the `@copilot` revision of Issue #28 after Chunk's earlier rejection for the list/detail mismatch under tag filtering.

**Findings:**
- `apps/web/src/App.tsx` now reconciles `selectedNoteId` against the visible filtered note set via `syncNoteSelectionToVisibleNotes`, which closes the trust-boundary bug from the rejected branch.
- `apps/web/src/App.test.tsx` adds the required regression proving the editor retargets when the active note falls out of the filtered list, and local validation passed with `npm run lint && npm run test && npm run build`.
- Scope stayed thin and correct: frontend-only tag facets/autocomplete, no backend contract creep, README updated to reflect the shipped behavior.

**Verdict:**
Lead-level review is **APPROVE**, with two remaining merge conditions: Chunk should give the QA sign-off required by the routing plan, and PR #37 should be moved out of draft before landing.

---

## 2026-04-13: PR #37 Merged & Issue #28 Closed

📌 **Coordinator action:** PR #37 moved out of draft, approved by Mikey (Lead) + Chunk (QA), and merged to `main`. Issue #28 closed as resolved.

**Merged Changes:**
- `apps/web/src/App.tsx` — tag facets + filtering + `syncNoteSelectionToVisibleNotes` logic
- `apps/web/src/App.test.tsx` — regression coverage (filter switching, clearing, re-selection)
- `README.md` — feature documentation

**Impact:** Issue #28 (tag infrastructure) now fully shipped and unblocks issue #24 (search foundation). All three blockers from the earlier branch rejection are now retired:
1. ✅ List/detail mismatch fixed via immediate reconciliation in `handleSelectTagFilter()`
2. ✅ Regression proof covers the failure case
3. ✅ Safety net via `useEffect` reconciliation keeps editor aligned across note changes

**Next Steps:** Issue #24 (search + filters) unblocked for implementation.

- **Issue Sweep (2026-04-13):** Ran a conservative GitHub issue sweep and closed #29, #32, and #33 as forgotten-to-close work. #29's spike outcome was already decided (defer graph-style tags until later phases), #32 starter templates are shipped on `main`, and #33 recent activity is shipped on `main`. Left #23 open because the backend consolidation route exists but a clearly surfaced owner-facing pick/preview/apply flow is not obvious in the current app; #24, #25, #26, and #30 remain clearly unshipped.

## 2026-04-13T16:07:01Z
✅ Issue #30 third revision: Completed frontend defensive coding fix for linkedNoteIds undefined crashes. Added optional chaining and nullish coalescing at four hotspots. All 49 tests passing. Issue approved by Chunk and ready to merge. Commit: 3d5b3ef

📌 Team update (2026-04-13T18:14:27Z): UX feedback review completed—phased notes UX roadmap approved (compact header + editor + inline references), Lexical editor recommended over TipTap for markdown-native alignment, backend data model strategy for qualified references finalized — decided by Mikey (Product), Stef (Frontend), Data (Backend)

## 2026-04-13: Phase 2 Implementation Audit

**Context:** FFMikha requested implementation recommendations for note references, editor migration, and overall next steps.

**Key findings from codebase inspection:**
- Current editor: plain `<TextField multiline>` + separate `<NoteBodyPreview>` using react-markdown/remark-gfm (App.tsx:3656-3682)
- Note links: `linkedNoteIds: string[]` stored as JSON in `linked_notes_json` column (note-store.ts:463), validated against same-campaign constraint (note-store.ts:1952-1959)
- Frontend link picker: MUI `<Autocomplete multiple>` in editor pane (App.tsx:3619-3639), backlinks computed via filter (App.tsx:588-593)
- Web tests: vitest 4.1.4 infrastructure broken with React 19 + MUI 9 (pre-existing, not feature regression)
- Decision already made (decisions.md:2429-2452): Lexical over TipTap, phased approach (compact header → editor → inline refs)

**File ownership map:**
- `apps/web/src/App.tsx`: editor pane, draft state, link picker, preview (~3800 lines, monolithic)
- `apps/web/src/note-formatting.tsx`: react-markdown wrapper (keep for read-only contexts)
- `apps/api/src/types.ts` + `apps/web/src/types.ts`: `Note.linkedNoteIds` and `NoteInput.linkedNoteIds`
- `apps/api/src/validation.ts`: create/update schemas with linkedNoteIds validation
- `apps/api/src/note-store.ts`: `linked_notes_json` column, same-campaign validation

**Recommendation delivered to user:** Lexical remains correct editor choice. Phase order: compact header → new editor component → body-derived reference model (backend + extraction). Note reference migration safest as additive: keep `linkedNoteIds` until body-derived refs are authoritative.


## 2026-04-13: Phase 2 Leadership — Scope, Timeline, and Approvals

📌 **Review complete:** Mikey reviewed Phase 2 scope and approved implementation strategy.

**Outcome:**
- ✅ **Phase 2 APPROVED** — all team members aligned on scope, timeline, and responsibilities
- ✅ Frontend + Backend decisions merged to decisions.md
- ✅ Orchestration logs created for Stef, Data, and Mikey

**Phase 2 scope confirmed:**
- Frontend: Dual-mode editor (2a toggle, 2b Lexical, 2c inline refs)
- Backend: Additive references table (safe migration, no breaking changes)
- Timeline: 7–10 days total (Phase 2a: 1–2d, 2b: 4–5d, 2c: 2–3d)
- Ship target: 2026-05-02 (best case)

**Key approvals:**
- Lexical chosen over TipTap (markdown-first, backend already stores markdown)
- Markdown canonical throughout (no format conversion)
- References table as single source of truth (rename-safe, searchable)
- Zero API breaking change Phase 2 (backward compatible migration window)

**Handoffs confirmed:**
- **Stef:** Phase 2a ready to start immediately (mode toggle)
- **Data:** Phase 2a schema design + lazy migration tests
- **Chunk:** Regression test plan needed (import/export, backlinks, search)
- **Product:** Phase 2 timeline approved; scope flexible post-2b for user testing

**Phase 2 is green-lit. Immediate actions: Stef begins Phase 2a; Data designs schema.**

## 2026-04-14: Web Test Infrastructure P1 — Scope Definition & CI Workflow

📌 **Status:** P1 blocker diagnosed and scoped; CI workflow created; work assigned to Brand & Chunk.

**Problem:** vitest 4.1.4 hangs when running App.test.tsx (full integration test). No CI coverage for web tests. Issue #24 (search) merged without test validation.

**Thinnest Slice Decision:**
1. **Brand (Tester):** Root cause investigation (vitest 4.1.4 + React 19 + MUI 9 compatibility)
2. **Chunk (QA):** Fallback path validation (either downgrade to 3.x OR skip App.test.tsx, move to Playwright E2E)
3. **Mikey:** Created reviewer gate with clear approval conditions

**Scope Boundaries:**
- ✅ Fix or isolate test infrastructure
- ✅ Create CI workflow for web tests
- ✅ Update README with test expectations
- ❌ Full App.test.tsx rewrite (defer to E2E)
- ❌ Sweeping test stack migration (boring/incremental preference)

**Deliverables:**
- ✅ `.squad/decisions/inbox/mikey-web-test-scope.md` — full scope doc with reviewer gate
- ✅ `.github/workflows/web-test.yml` — boring CI workflow (runs existing tests, no new test writing)

**Reviewer Gate:** Brand → Chunk → Mikey. No merge without all conditions met.

**Key principle:** Restore working test coverage incrementally. Don't block other work. E2E testing (Playwright) for App component is a Phase 2 follow-up.

**Files modified:**
- Created: `.squad/decisions/inbox/mikey-web-test-scope.md`
- Created: `.github/workflows/web-test.yml`

## 2026-04-14: HANDOFF TO BRAND & CHUNK — DETAILED WORK PLAN

**Status:** Scope locked, CI skeleton ready, work ready to start.

### For Brand (Platform Dev)

**Your task:** Root cause investigation (2–4 hours)

**What's the problem?**
vitest 4.1.4 hangs indefinitely when tests render App.test.tsx. Simple components (CampaignSearch, NoteBodyEditor) test fine. The hang happens in the test worker pool, not in the app logic.

**Your checklist:**
1. Create minimal vitest repro: simple React 19 component + vitest + jsdom
2. Test matrix: Does vitest 4.1.4 work for small components? Only App.tsx hangs?
3. Audit vite.config.ts: Check pool setting, timeout, environment config
4. Upstream research: Known issues with vitest 4.1.4 + React 19 + MUI 9?
5. **Decide:** Either (a) config fix, (b) downgrade to vitest 3.x, or (c) skip App.test.tsx to Playwright

**What not to do:**
- Don't rewrite App.test.tsx (that's a Playwright E2E task in Phase 2)
- Don't try every vitest version (focus on 3.x as fallback only)
- Don't add new test coverage (restore existing first)

**When you're done:**
- Tell Chunk which path to take (a/b/c above)
- Update CI workflow if config changes are needed
- No approval needed; Chunk waits for your decision

### For Chunk (Tester)

**Your task:** Validation + fallback (1–2 hours, after Brand decides)

**What's your job?**
Brand will give you a decision (fix, downgrade, or skip to E2E). You validate it works, then sign off.

**Your checklist (after Brand's decision):**
1. Apply the chosen fix: update vite.config.ts OR downgrade package.json OR mark App.test.tsx as E2E-only
2. Run locally: `npm run lint && npm run test && npm run build`
3. Verify: All expected tests pass (no timeouts, no hangs)
4. Update README: Document which tests run in CI vs E2E
5. Sign off: "All tests pass, fallback stable"

**The fallback paths:**
- **Option A (downgrade to 3.x):** Remove ^4.1.4, install latest 3.x, re-run all tests, confirm no hangs
- **Option B (skip App.test.tsx):** Document that App full-integration tests move to Playwright E2E, keep unit tests in CI
- **Option C (config fix):** Apply Brand's fix to vite.config.ts, re-run all tests

**When you're done:**
- Tell Mikey: "Tests pass, ready to review"
- No action on CI workflow (Brand owns that)

### For Mikey (Lead)

**Your role:** Reviewer gate (final sign-off)

**Approval conditions:**
- ✅ Brand identified root cause (fix OR fallback)
- ✅ Chunk validated chosen path (local tests pass)
- ✅ CI workflow runs successfully on the branch
- ✅ README updated with test expectations
- ✅ Scope stayed thin (no test rewrites, no surprises)
- ✅ Chunk + Brand both signed off

**When you approve:**
- Review the actual changes (vite config OR package downgrade OR README notes)
- Verify CI workflow passes
- Merge to main
- Unblock Phase 2 work (Stef can now rely on passing tests)

### Timeline

- **T+0:** Brand starts investigation
- **T+2-4h:** Brand decides path
- **T+2-6h:** Chunk validates (parallel or sequential based on Brand's decision)
- **T+4-8h:** Mikey reviews + approves
- **T+8h:** Merge, unblock main lane

**Target:** Complete by end of next session (4–6 hours total)

### Key Principle

**Restore working test coverage incrementally.** Don't block other work. Don't oversimplify. E2E testing (Playwright) for App component is a Phase 2 follow-up, not this pass.

---

## Architecture Notes (For Future Reference)

**Test stack current state:**
- vitest 4.1.4: Hangs on App.test.tsx (full integration test)
- Simple component tests: Pass fine (CampaignSearch, NoteBodyEditor, note-formatting)
- Hang symptom: Tests stuck in `[queued]` state, never execute
- Root: Likely worker pool deadlock or jsdom environment conflict with React 19 + MUI 9

**What works:**
- API tests: All 26 tests in apps/api pass
- Lint + build: All pass
- Individual component tests: Pass within 1–7 seconds

**CI coverage before this pass:** None (no web test workflow)

**Decision:** Boring incremental fix (downgrade or isolate) rather than test framework rewrite.

## 2026-04-14: Web Test Infrastructure Approval & Web CI Fix

Web test infrastructure P1 approved for Brand + Chunk execution:
- Investigation lead (Brand): vitest 4.1.4 hang root cause OR fallback selection (downgrade/isolate)
- CI wiring (Brand): `.github/workflows/web-test.yml` routed through new root scripts (`npm run test:web`)
- Validation (Chunk): Fallback path tested locally; `npm run lint && build && test` passing
- QA gate (Chunk): sign-off before merge
- Lead gate (Mikey): Architecture verified, scope confirmed thin

**Root cause of current CI no-op:** `.github/workflows/web-test.yml` calls `npm run test --workspace web`, but this repo uses npm 7 workspaces with directory paths (`apps/web`), not shorthand names. New scripts in `package.json` expose `npm run test:web` routed to `apps/web/`. Focused smoke lane (CampaignSearch, NoteBodyEditor, note-formatting) is the thinnest useful CI slice, proves plumbing works end-to-end.

**Decisions in queue:** `brand-fix-upgrade-pinning.md` (post-upgrade audit), `brand-web-test-infra.md` (root scripts), `chunk-web-regression.md` (smoke suite strategy), `copilot-directive-2026-04-14T15-13-34Z.md` (signed commits required), `mikey-web-test-scope.md` (this gate).

Decision merged to `.squad/decisions.md`. Awaiting Brand background agent start. — Scribe
📌 Team update (2026-04-16T15:30:33Z): Origin-model audit completed. Frontend ready for split-origin deployment. Backend: add PUBLIC_WEB_ORIGIN env var to buildSharedUrl(). Platform: same-origin reverse proxy recommended for prod. — decided by Stef, Data, Brand, Mikey

---

## 2026-04-17: Issue #42 Multi-Instance Design Spike (Orchestrated)

📌 Team update (2026-04-18T00:43:22Z): ISSUE #42 BACKEND DIRECTION CAPTURED — Data wrote `.squad/decisions/inbox/data-42-auth-persistence.md` to pin the backend recommendation: SQLite is acceptable for a thin first control plane only under single-writer, low-concurrency constraints; tenant instances need strict lifecycle boundaries from the control plane; auth should move toward centralized OIDC with a separate admin realm plus a shared tenant-aware customer realm; and #42 must measure provisioning, backup/restore, rollout, and failure-drill reality before the model is treated as production-ready.

📌 Team update (2026-04-18T00:43:37Z): ISSUE #42 PLATFORM DIRECTION DECIDED — Added `.squad/decisions/inbox/brand-42-k8s-platform.md` recommending a managed single-cluster Kubernetes shape with a provider-managed K8s control plane, a thin app-level control plane using the Kubernetes API instead of a custom operator, tenant workloads that scale to zero while keeping their PVCs, shared ingress/cert-manager in the first real hosted slice, internal fleet status before a public status page, and provider selection centered on storage, ingress, automation, and low-friction ops.


## 2026-04-18: Issue #42 Epic Restructure (Orchestrated by Coordinator)



📌 Team update (2026-04-18T02:20:06Z): Platform gap analysis complete — 11 cross-cutting risks identified for #42 epic. Critical gaps: local K8s dev loop (k3d), ingress/wildcard DNS/TLS, SQLite backup strategy, control-plane SPOF, CI for containers/manifests. All gaps prioritized by phase and assigned to Brand/Data. Awaiting Mikey + FFMikha review and timeline adjustment.

## 2026-04-18: Issue #42 Planning Resumed — Phase 0 Kickoff & Decision Points

📌 **Planning decision:** Resolved Data's four blocking decision points and produced concrete Phase 0 execution plan.

**Decisions made:**
1. **Auth migration:** Dual-mode with `AuthAdapter` interface. Local auth + OIDC coexist. OIDC not mandatory until Phase 3 production cutover.
2. **Versioning:** Semver + explicit `schema_version` integer per tenant DB. N reads N and N-1.
3. **Backup ownership:** Control plane orchestrates (schedule, inventory, retention), tenant app executes (`/internal/backup`, `/internal/restore`). Control plane never touches tenant data.
4. **Keycloak timing:** Phase 2 as planned, but mock OIDC in Phase 1 validates `AuthAdapter` early.

**Phase 0 is unblocked — two parallel tracks:**
- Track A: #52 Containerize (Brand) — Dockerfile, k3d dev loop (`scripts/dev-cluster.sh`), K8s manifests, CI container build
- Track B: #39 WAL investigation (Data) — measured WAL behavior, crash recovery, backup consistency
- Track C: #43 Deployment artifacts (Brand, companion to #52)

**Phase 0→1 design overlap (start now, parallel with Phase 0):**
- Control-plane state machine (Data → feeds #53)
- Internal API contract `/internal/*` (Data → feeds #53, #54)
- Ingress/wildcard DNS/TLS spike (Brand → feeds #54)
- `AuthAdapter` interface draft (Data → feeds #56)

**Full sequencing:** Phase 0 → Phase 1 (#53 → #54 → #55) → Phase 2 (#56, #40) → Phase 3 (#57). Design work overlaps Phase 0 to prevent Phase 1 stall.

**Decision document:** `.squad/decisions/inbox/mikey-issue-42-planning.md`

## Learnings

- **Epic #42 planning pattern:** Architecture spike (multiple risk reviews) → decision resolution (Mikey answers blocking questions) → execution kickoff (parallel tracks with measured acceptance). The gap between "architecture decided" and "Phase 0 underway" was the real planning debt.
- **Decision point triage:** Data's 4 blocking questions were the right forcing function. Without explicit answers to auth strategy, versioning, backup ownership, and Keycloak timing, no child issue can be confidently scoped.
- **Phase overlap reduces idle time:** Design tasks for Phase N+1 can start during Phase N implementation when outputs are interfaces/contracts rather than code. State machine, API contract, and adapter interface drafts are all non-blocking on Phase 0 code.
- **Key file paths:** Epic decisions consolidated in `.squad/decisions.md` lines 3492–4180. Sub-issues: #52 (containerize), #43 (artifacts), #39 (WAL), #53 (control plane), #54 (provisioning), #55 (rollout), #56 (OIDC), #40 (restore), #57 (fleet status).
