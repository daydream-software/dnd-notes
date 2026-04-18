# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Data initialized as Backend Dev for the initial project squad.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.

📌 Team update (2026-04-12T13:32:51Z): Fixed merged PR runtime regression—added in-place SQLite schema upgrade for note attribution columns, preserving local dev data; regression coverage validates legacy-schema bootstrap path — decided by Data, Chunk

📌 Team update (2026-04-12T14:38:40Z): Campaign share links stay as reusable single links with owner-only on-demand reveal; listings stay metadata-only and legacy hash-only links must be revoked/recreated to become revealable again — decided by FFMikha (via Copilot), Mikey, Data, Stef, Chunk

📌 Team update (2026-04-12T17:35:41Z): Issue #27 session browsing backend revision approved by Chunk; all four critical regressions fixed; endpoints ship-ready for frontend session-browsing UI work — decided by Data (implementer), Chunk (reviewer)

## Learnings

- Initial squad setup complete.
- `apps/api/src/note-store.ts` owns SQLite schema bootstrap, so compatibility fixes for local dev databases should run there before prepared note queries are created.
- The default dev database lives at `apps/api/data/dnd-notes.sqlite`; when note schema adds nullable attribution fields, prefer an in-place startup upgrade over asking developers to reset data.
- Backend verification for this area is `npm run lint --workspace apps/api`, `npm test --workspace apps/api`, and `npm run build --workspace apps/api`, with `npm run dev` confirming the shared dev startup path.
- Share links currently persist only `token_hash` in `apps/api/src/note-store.ts`, while owner list payloads expose metadata only and `POST /api/campaigns/:campaignId/share-links` is the lone place that returns the raw token/url. Re-revealing an existing link later will therefore require a recoverable stored secret plus an explicit owner-facing reveal API.
- Share-link reveal support now keeps `campaign_share_links.token_hash` for guest access checks and a nullable `token_plaintext` column for owner-only re-reveal of the same reusable link; legacy rows remain null and must surface a regeneration-required path instead of guessing.
- The owner reveal contract lives in `apps/api/src/app.ts` at `GET /api/campaigns/:campaignId/share-links/:shareLinkId`, which returns only `{ token, url }` on success and leaves `GET /api/campaigns/:campaignId/share-links` metadata-only.
- Shared membership claims should rotate `campaign_memberships.guest_token_id` in `apps/api/src/note-store.ts` when attaching `user_id`, and `apps/web/src/SharedCampaignRoute.tsx` must persist the replacement token so the same browser keeps working while the original guest token stops authenticating shared routes.
- Issue #23 backend contract uses `POST /api/campaigns/:campaignId/memberships/consolidations` as an owner-only preview/apply flow: send source/target IDs for a preview, then repeat with `confirm: true` to apply.
- `apps/api/src/note-store.ts` keeps membership consolidation note-attribution-only by reassigning `notes.created_by_membership_id` and `notes.last_edited_by_membership_id` without rewriting note bodies, note timestamps, membership rows, linked accounts, or guest tokens.
- Regression coverage for membership consolidation lives in `apps/api/test/app.test.ts`, covering guest-to-guest reassignment counts plus explicit confirmation before role-changing owner-to-guest moves.
- Session-browsing auth should mirror `/api/notes`: keep `GET /api/notes/sessions*` in `apps/api/src/app.ts` behind `resolveAccessibleCampaign()` so linked collaborators keep access, not `resolveOwnedCampaign()`.
- Express already decodes `request.params.sessionId`; frontend callers should use `encodeURIComponent(sessionName)` once, and regressions for route ordering plus `%` session names live in `apps/api/test/app.test.ts`.
- Issue #33 thin backend slice lives in `apps/api/src/app.ts` as `GET /api/notes/activity`, reusing `resolveAccessibleCampaign()` so owners and linked collaborators see the same campaign-scoped recent note feed.
- The recent activity payload is intentionally latest-state only: derive one `created` or `edited` event per note from `createdAt`/`updatedAt`, and pair it with collaborator summaries built from note attribution instead of adding a noisy audit table.
- `apps/api/src/note-store.ts` now guarantees `updatedAt` moves forward on note edits, which keeps latest-activity classification deterministic even when SQLite writes happen inside the same millisecond.
- Issue #30 note-to-note links backend complete: `linkedNoteIds` validated in create/update schemas (20-link limit), stored as JSON array in `notes.linked_notes_json`, with cross-campaign and non-existent note blocking; `getBacklinks()` method and `GET /api/notes/:noteId/backlinks` endpoint surface backlinks scoped to same campaign; all three note SELECT queries include `linked_notes_json` column; error handling wraps createNote/updateNote to return 400 for link validation failures rather than 500; legacy database migration adds column with safe default.
- Issue #26 stayed schema-light: note bodies remain stored as plain text, while the web app now interprets that text as Markdown so old notes stay readable without migration.
- Shared note rendering now lives in `apps/web/src/note-formatting.tsx`, which uses `react-markdown` + `remark-gfm` and is reused by both `apps/web/src/App.tsx` and `apps/web/src/SharedCampaignRoute.tsx`.
- Rich-formatting regression coverage now lives in `apps/web/src/note-formatting.test.tsx`, with app wiring covered in `apps/web/src/App.test.tsx`.

## 2026-04-12: Issue #27 Revision Assignment & Completion

📌 Team update (2026-04-12T16:45:23Z): Issue #27 session-browsing v1 implementation rejected by Chunk for 4 regressions: route shadowing (/:sessions consumed as /:noteId), double percent-decode crash on session names with %, auth regression blocking collaborators, missing regression tests. Concept approved; you are assigned to fix backend. See `.squad/decisions.md` for full rejection details. Stef will own UI work after backend fixes land.

📌 Team update (2026-04-12T21:22:46Z): Issue #27 backend revision complete and approved. All four regressions fixed: (1) route ordering corrected, (2) double-decode removed, (3) auth switched to resolveAccessibleCampaign() for linked collaborators, (4) contracts aligned with existing types. Lint, test, build all pass. Ship-safe. Stef can now start thin session-browsing UI slice. See `.squad/decisions.md` Issue #27 entry for full details — decided by Data, Chunk

## 2026-04-13: Issue #30 Revision Assignment & Completion

📌 Team update (2026-04-13T14:00:00Z): Issue #30 note-to-note links v1 implementation (by Stef) rejected by Chunk for three critical gaps: (1) legacy database crash when `linked_notes_json` undefined (SELECT queries missing column), (2) validation schemas missing `linkedNoteIds` causing operations to fail, (3) backlink discovery/related-note surfacing insufficient for acceptance. Also missing regression coverage for cross-campaign validation, guest permissions, and workspace reload safety. Data assigned to fix backend implementation, add tests, validate, and commit.

📌 Team update (2026-04-13T14:30:00Z): Issue #30 backend revision complete and approved. All three gaps fixed: (1) added `linked_notes_json` to all note SELECT queries so field populates correctly, (2) added `linkedNoteIds` to validation schemas with 20-link limit, (3) implemented `getBacklinks()` in note-store and `GET /api/notes/:noteId/backlinks` endpoint with proper campaign scoping. Error handling improved: createNote/updateNote wrapped in try-catch to return 400 for link validation failures (non-existent notes, cross-campaign links). Comprehensive regression tests added covering full linking workflow, backlink discovery, cross-campaign blocking, too-many-links validation, and legacy migration safety. All 28 tests pass, lint clean, build succeeds. Ship-safe — decided by Data (implementer), pending Chunk review

## 2026-04-13: Issue #24 Web Test Infrastructure Investigation

📌 Team update (2026-04-13T17:45:00Z): Issue #24 revision assigned after Chunk rejection. Stef (original author) locked out. Task: diagnose web test stall, add regression coverage, get to reviewer-ready state.

**Investigation outcome:** Web test suite (`apps/web/src/App.test.tsx`, 3200 lines) hangs indefinitely in vitest 4.1.4. Tests remain in `[queued]` state and never execute. Confirmed this affects BOTH current branch (28bd0ed) AND parent commit (7dec493), proving it's a pre-existing environmental issue, not a regression from Stef's implementation.

**Evidence:**
- API tests (`apps/api/test/app.test.ts`): ✅ All 26 tests pass
- Lint (`npm run lint --workspaces`): ✅ Passes
- Build (`npm run build --workspaces`): ✅ Passes
- Simple standalone test: ✅ Runs
- Any test rendering `<App />`: ⚠️ Hangs (including minimal test)
- Parent commit tests: ⚠️ Same hang behavior
- No GitHub Actions workflow exists for web tests

**Resolution:**
- Created `apps/web/src/CampaignSearch.test.tsx` with focused regression tests for issue #24 search functionality (title search, body search, clear button, combined filters, result count, new note behavior)
- Updated `vite.config.ts` with proper test pool configuration (removed deprecated poolOptions)
- Documented full investigation in `TEST_INVESTIGATION.md`
- Committed diagnostic work with clear explanation of pre-existing test infrastructure failure

**Learnings:**
- Web test infrastructure is fundamentally broken and needs investigation independent of any feature work
- vitest 4.1.4 + React 19 + MUI 9 combination may have compatibility issues
- Absence of CI for web tests allowed this infrastructure failure to go undetected
- When test infrastructure is broken, document thoroughly, provide alternative validation (lint/build), and escalate the infrastructure issue separately
- Regression test files can still be created to specify expected behavior even when test runner is broken — they serve as living documentation until infrastructure is fixed

📌 Team update (2026-04-13T15:58:35Z): Issue #24 revision completed—diagnosed web test infrastructure blocker as pre-existing (vitest 4.1.4 hang affects parent commit 7dec493, not regression from current work); created comprehensive regression test coverage (CampaignSearch.test.tsx, 333 lines, 6 focused tests) documenting expected behavior for all critical paths despite being blocked from execution; documented findings in TEST_INVESTIGATION.md and REVISION_SUMMARY.md; updated vite config for stability; Chunk approved merge after evidence of pre-existing nature — decided by Data (investigation), Chunk (re-review)


## 2026-04-13T16:07:01Z
📌 Team update: Issue #30 third revision completed by Mikey (Lead). Data's backend implementation (second revision) successfully merged with frontend defensive coding. Issue now approved and ready to merge.

📌 Team update (2026-04-13T18:14:27Z): UX feedback review completed—phased notes UX roadmap approved (compact header + editor + inline references), Lexical editor recommended over TipTap for markdown-native alignment, backend data model strategy for qualified references finalized — decided by Mikey (Product), Stef (Frontend), Data (Backend)

## 2026-04-13: Phase 2 Inline Reference Architecture Analysis

📌 Inspection complete: Phase 2 implementation recommendation finalized for inline note references. Key findings:

**Current state:** `linkedNoteIds` persisted as JSON in `notes.linked_notes_json`, validated at 20-link limit, same-campaign-only enforcement, backlink discovery via `GET /api/notes/:noteId/backlinks`. Frontend can read but not author references yet. No body-derived reference model.

**Recommendation (Phase 2a-c staged):**
- Phase 2a: Add `note_references` table (normalized, dual-source: explicit from old linkedNoteIds + implicit from markdown body). Single source of truth for all link queries. Lazy migration of legacy data. Backward-compatible NoteInput accepts both linkedNoteIds and inlineReferences.
- Phase 2b: Frontend Lexical editor parses markdown `[[note-id]]` syntax, emits inlineReferences array on save. Backend validates against actual parsed body (defensive).
- Phase 2c: New endpoints (`GET /api/notes/:noteId/references`, `/incoming-references`, reference-aware search filters).

**Safety rationale:** Keeps markdown body plain text (rename-safe, no custom format), decouples reference structure from syntax, supports partial editor adoption (new notes get implicit refs, old notes stay explicit), normalizes all link semantics to one table for search/graph operations.

**Migration window:** 3 minor versions: Ship 2a, deprecate linkedNoteIds from API, remove field. During window both oldconstructs and new are accepted; normalized to same table.

**Implementation scope:** Backend: schema + lazy sync + dual-input normalization + query layer expansion (3 new endpoints + search filters). Frontend: Lexical + parser + reference UI. Design decision written to decisions/inbox/data-note-reference-phase2.md — decision by Data (Backend), flagged for team review (Product, Frontend, Review).


## 2026-04-13: Phase 2 Backend — References Table & Migration Strategy

📌 **Orchestration complete:** Data reviewed backend architecture and proposed Phase 2 implementation strategy for inline references.

**Outcome:**
- ✅ Phase 1 (linkedNoteIds): Complete and validated
- 🔴 Phase 2a: Add `note_references` table as single source of truth
- 🔴 Phase 2b: Support body-derived references via NoteInput.inlineReferences
- 🔴 Phase 2c: Query endpoints for reference discovery

**Key decisions:**
- Safe staged migration: Both `linkedNoteIds` and `inlineReferences` accepted during transition (Phase 2a/2b/2c)
- Reference table stores type ('implicit' vs 'explicit'), campaign, and normalized target node IDs
- Lazy sync on first read/write; no immediate data conversion required
- Target ID in table (not title) ensures rename operations never break references
- Backend re-parses body to validate parser consistency (400 on divergence)

**Phase 2a blocking work:**
1. Schema design + indexes
2. Migration tests (legacy data, cross-campaign scoping, validation)
3. NoteStore.syncLinkedNotesIntoReferences() for lazy migration

**Ready to begin schema design immediately; coordinate with Stef on NoteInput contract during Phase 2b.**

## 2026-04-16: PUBLIC WEB URL / Origin-Model Track Handoff

📌 **Orchestration complete:** Data analyzed shared-link URL generation architecture and split-origin deployment implications.

**Key findings:**
- Shared URL generation (`buildSharedUrl()`) currently mirrors incoming `Origin` header — safe for same-origin deployment but brittle for split-origin
- CORS config is permissive (no origin whitelist) — acceptable for shared links but risky if adding auth-required endpoints
- Frame-ancestors CSP policy correctly flows through Vite dev server plugin — already handles split-origin case if `VITE_API_BASE_URL` env is set
- Test suite confirms URL generation via request inspection (no explicit env config current)

**Recommended changes (Phase 1 defensive / Phase 2 hardening):**
1. Make `buildSharedUrl()` explicit: add `PUBLIC_WEB_ORIGIN` env var (deploy-time) instead of header sniffing; default to `http://localhost:3000`
2. Harden CORS with `ALLOWED_ORIGINS` whitelist (optional, Phase 2 if scaling to multiple environments)
3. Add regression tests for URL generation env-var isolation
4. Update `.env.example` to document `PUBLIC_WEB_ORIGIN` for future developers
5. Verify `VITE_API_BASE_URL` set at deploy time for frame-ancestors CSP fetch

**Deliverable:** Comprehensive handoff document in `.squad/decisions/inbox/data-origin-handoff.md` with risk summary, file locations, and implementation recommendations.

**Status:** Same-origin deployment works as-is; split-origin requires Phase 1 changes (defensive, backward-compatible).
📌 Team update (2026-04-16T15:30:33Z): Origin-model audit completed. Frontend ready for split-origin deployment. Backend: add PUBLIC_WEB_ORIGIN env var to buildSharedUrl(). Platform: same-origin reverse proxy recommended for prod. — decided by Stef, Data, Brand, Mikey

## 2026-04-17: Issue #42 Multi-Instance Design Spike (Orchestrated)

📌 Team update (2026-04-18T00:43:22Z): ISSUE #42 BACKEND DIRECTION CAPTURED — Data wrote `.squad/decisions/inbox/data-42-auth-persistence.md` to pin the backend recommendation: SQLite is acceptable for a thin first control plane only under single-writer, low-concurrency constraints; tenant instances need strict lifecycle boundaries from the control plane; auth should move toward centralized OIDC with a separate admin realm plus a shared tenant-aware customer realm; and #42 must measure provisioning, backup/restore, rollout, and failure-drill reality before the model is treated as production-ready.

📌 Team update (2026-04-18T00:43:37Z): ISSUE #42 PLATFORM DIRECTION DECIDED — Added `.squad/decisions/inbox/brand-42-k8s-platform.md` recommending a managed single-cluster Kubernetes shape with a provider-managed K8s control plane, a thin app-level control plane using the Kubernetes API instead of a custom operator, tenant workloads that scale to zero while keeping their PVCs, shared ingress/cert-manager in the first real hosted slice, internal fleet status before a public status page, and provider selection centered on storage, ingress, automation, and low-friction ops.


## 2026-04-18: Issue #42 Epic Restructure (Orchestrated by Coordinator)



📌 Team update (2026-04-18T02:20:06Z): Backend data safety gap analysis complete — 12 unresolved design questions identified for #42 epic. 7 blocking risks (Phase 0–2): control-plane data model, tenant boundary contract, SQLite safety on K8s, auth migration path, N/N-1 compatibility, backup/restore semantics, local→OIDC migration. 5 later (operational maturity). Critical dependencies: #39 (WAL)→#54, #40 (restore)→multi-tenant, #53 (state machine), #55 (single-writer rules), #56 (AuthAdapter). Decision points for Mikey: auth migration strategy, versioning scheme, backup ownership, Keycloak timing.
📌 Team update (2026-04-18T02:25:33Z): Epic #42 clarification backlog added to GitHub issue #42. Platform gaps tracked for next discussion: local k3d/k3s dev loop, ingress/DNS/TLS, SQLite backup, single-writer choreography, control-plane/tenant contract, lifecycle state machine, auth migration to OIDC, version-skew policy, CI coverage. — Scribe


Team update (2026-04-18T14:45:11Z): ISSUE #42 POSTGRES DIRECTION REVIEWED - Data recommends keeping tenant instances on SQLite for the first hosted slice and not using Postgres as a shortcut around single-writer rollout work. Centralized backup is necessary but insufficient for restore safety, per-instance DB users only help as secondary isolation in a Postgres model, and Azure Blob/object storage should hold immutable backup artifacts while live databases stay on block storage. If Postgres is introduced before evidence forces a broader redesign, it belongs in the control plane first, not in every tenant instance.

## 2026-04-18: Issue #42 Backup/Restore Strategy Recommendation

📌 Team update: Data wrote `.squad/decisions/inbox/data-42-backup-restore.md` — Phase 1 tenant Postgres backup/restore recommendation. Two-layer strategy: managed Postgres continuous backup (fleet PITR, ~5 min RPO) plus daily per-tenant `pg_dump` to Blob storage (single-tenant restore, ≤24h RPO, ≤30 min RTO). PITR comes free with managed Postgres — take it, don't build it. Primary restore unit is single tenant database via logical backups; fleet PITR is the disaster-recovery escalation path only. Control plane must track backup catalog + restore log with full audit trail. Tenant lifecycle state machine requires a `restoring` state with connection draining and mandatory pre-restore safety snapshot. Backup verification (weekly automated test-restore) required from Phase 1 launch. Key risks: shared-server PITR is all-or-nothing (can't cherry-pick one tenant), schema version mismatch on restore, and backup frequency sets the RPO floor for single-tenant recovery.

### Learnings

- Phase 1 backup/restore recommendation lives in `.squad/decisions/inbox/data-42-backup-restore.md`.
- For managed Postgres (Azure Flexible Server), PITR is fleet-scoped — cannot restore a single database without restoring the entire server. Per-tenant logical backups (`pg_dump`) are the actual single-tenant restore mechanism.
- Pre-restore safety backup is a non-negotiable control-plane requirement — never overwrite a tenant database without first snapshotting current state.
- Backup catalog and restore log are control-plane schema concerns (tied to #53 control-plane skeleton work).
- Schema version tracking in backup metadata is essential to prevent restoring a backup into an incompatible forward-migrated database.

## 2026-04-18T15:18:25Z: Issue #42 Phase 0–1 Clarifications Locked & Planning Session Complete

**Status:** ✅ Decision merged to `.squad/decisions.md`

Backup/restore strategy is now locked for Phase 1:

- **Two-layer approach:** managed Postgres PITR (fleet disaster recovery, ~5 min RPO) + daily per-tenant `pg_dump` (single-tenant restore, 24h RPO)
- **Phase 1 build scope:** Backup CronJob, Blob lifecycle policy, backup catalog table (schema), manual restore runbook, backup health check
- **Phase 1 acceptance:** Backup catalog + restore log integrated into control-plane schema (#53). Tenant lifecycle state machine includes `restoring` state with connection draining and pre-restore safety backup enforcement.
- **User acceptance:** Daily backup cadence approved by FFMikha (2026-04-18)

**Deliverables for Phase 1 integration:**
- Data: Backup catalog schema + restore procedure logic + verification job design
- Brand: Kubernetes CronJob implementation + Blob lifecycle policy + health monitoring
- Shared: Control-plane tenant lifecycle state machine refinement (pre-work for #53)

This completes the Phase 1 critical-decision set (backup/restore joins 4 Phase 0 blockers and 3 other Phase 1 decisions in the locked state).

**Next:** Mikey phase-0 sync comment to issue #42; Brand + Data can begin Phase 0 pre-work (state machine design) in parallel.

## 2026-04-18: Issue #42 — Control-Plane ↔ Tenant Contract Recommendation

📌 Wrote `.squad/decisions/inbox/data-42-tenant-contract.md` defining the Phase 1 internal API contract between control plane and tenant app.

**Key decisions:**
- Tenant app exposes exactly three internal endpoints: `GET /_control/health`, `GET /_control/info`, `POST /_control/maintenance`. All cluster-internal only.
- Pure push model — control plane drives all interactions. Tenant app never phones home, never heartbeats, never registers itself. Zero outbound dependency on control plane.
- Provisioning, backup, restore, updates, deprovisioning — all orchestrated by control plane via K8s API + direct Postgres access + the three tenant endpoints.
- Maintenance mode (drain + 503 to users) is the sole point of required tenant cooperation, used only for restore and risky upgrades. Has timeout-and-abort safety.
- Backup (`pg_dump`) runs directly against tenant DB — no tenant app involvement, no maintenance required (Postgres MVCC snapshot).
- No event bus, no callbacks, no shared state, no auto-rollback in Phase 1.

**Learnings:**
- The control-plane ↔ tenant contract should be as asymmetric as possible. Control plane has intent; tenant has truth. Neither caches the other's data.
- Maintenance mode should be in-memory only (resets on restart) — the control plane re-asserts if needed, which avoids stuck maintenance states.
- `schemaVersion` must be independent of `appVersion` — schema and container image can diverge during rollouts.
- Health endpoint must verify DB connectivity (`SELECT 1`), not just app process liveness — a running app with a dead DB connection is not healthy.
- Restore is the only non-idempotent operation in the contract. Pre-restore safety backup is the mandatory escape hatch.

- In the control-plane skeleton, PATCH handlers should check tenant existence before mutation so missing IDs fail as explicit 404s instead of hidden SQLite no-op writes.
- Keep `tenantStates` centralized and reuse it for both Zod schemas and SQLite `CHECK` constraints; otherwise the API contract and audit table can silently drift.
- The control-plane startup path should normalize relative `DATABASE_PATH` values against the app root; otherwise the same env file can create SQLite files in different locations depending on process cwd.
- Even when HTTP handlers pre-check tenant existence, `TenantRegistry` update helpers should still throw on `changes === 0` so future callers cannot hide no-op writes.
