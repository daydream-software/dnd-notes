# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Data initialized as Backend Dev for the initial project squad.

*History summarized on 2026-04-21T16:43:21Z — old detailed entries (April 12–18) archived. Keeping recent team updates and all learnings.*

## Recent Updates



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
- When a locked squad decision supersedes an exploratory history note, point the history entry at `.squad/decisions.md` or mark it explicitly superseded; do not leave PR-visible history pointing at stale inbox artifacts or retired endpoint drafts.
- Parse `PORT` strictly in control-plane startup; permissive `parseInt()` behavior can silently accept junk suffixes that should fail fast at boot.
- Control-plane auth middleware should drain unauthorized request bodies before returning 401 so rejected keep-alive requests do not leave unread payloads behind.
- Control-plane shutdown should bound `server.close()` with a hard timeout; keep-alive sockets can otherwise block SIGINT/SIGTERM exit and leave SQLite handles open.
- Locked issue #53 control-plane management routes live under `/internal/tenants*`; keep service code, tests, and README aligned to that internal-only contract instead of drifting to `/api/*`.
- Control-plane state audit rows should read `current_state` inside the same write transaction used for the update, and `reason` should be omitted or non-empty so transition history never silently collapses `''` into `null`.
- Issue #58 moved `apps/api/src/note-store.ts` behind an async statement wrapper in `apps/api/src/note-store-database.ts`, so the API can await the same `prepare/get/all/run` flow on SQLite and Postgres instead of forking route contracts.
- The API now selects Postgres whenever `DATABASE_URL` is set and otherwise falls back to SQLite via `NOTES_DB_PATH`; Postgres pool tuning lives in `NOTES_DB_POOL_MIN`, `NOTES_DB_POOL_MAX`, `NOTES_DB_IDLE_TIMEOUT_MS`, `NOTES_DB_CONNECTION_TIMEOUT_MS`, and `NOTES_DB_STATEMENT_TIMEOUT_MS`.
- Admin backup/restore keeps a SQLite-compatible snapshot format even for Postgres-backed tenants: `backupDatabase()` exports a `.sqlite` snapshot, and `restoreNoteStoreFromBackup()` can import that snapshot back into Postgres for migration/recovery.
- Regression coverage for the adapter slice now lives in `apps/api/test/postgres-adapter.test.ts`, while the existing API suite still validates the SQLite fallback path.
- Postgres-backed tenant image rollouts now reuse `POST /internal/tenants/:tenantId/provision` with a version override; `apps/control-plane/src/provisioning.ts` marks ready tenants as `upgrading` during the rollout and returns them to `ready` once the rollout is fully complete (observedGeneration matches, updatedReplicas/availableReplicas equal spec.replicas).
- The generated tenant Deployment contract now explicitly stays single-replica `RollingUpdate` with drain-first replacement (`maxSurge: 0`, `maxUnavailable: 1`) to prevent pod overlap while the per-tenant RWO PVC remains mounted, plus `minReadySeconds: 5` and `terminationGracePeriodSeconds: 30`; the operator choreography and rollout rationale live in `apps/control-plane/README.md` and `RUNTIME.md`.
- `TenantProvisioningService.provisionTenant()` must reject blank version overrides before rollout classification; otherwise direct callers can record an `upgrading` transition without persisting a new tenant version/image.
- `TenantProvisioningService.provisionTenant()` must trim version overrides before comparing/persisting them and reject non–image-tag-safe values; the HTTP provision route should surface those validation failures as 400s instead of masking them as 500s.
- Control-plane reprovision errors in `apps/control-plane/src/provisioning.ts` must not echo raw tenant `DATABASE_URL` values; include tenant context and guidance, but never reflect credentials back into logs or HTTP error details.
- When Postgres tenant database/role identifiers in `apps/control-plane/src/provisioning.ts` would exceed the 63-character limit, truncate with a stable hash suffix instead of plain slicing so long subdomains cannot collide; regressions live in `apps/control-plane/test/provisioning.test.ts`.

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

*94 older learning items archived.*

## 2026-04-19: PR #59 Review Feedback Resolution

**Work:** Addressed all Copilot review threads on PR #59 (control-plane skeleton).

**Fixed blocking issues:**
- PORT validation: Parse `process.env.PORT` string to number with range check (prevents named-pipe misinterpretation)
- Foreign key enforcement: Enable SQLite FK pragma on initialization (ensures CASCADE works)
- Transaction atomicity: Wrap tenant state update + audit log insert in single transaction (prevents broken audit trail)
- 404 for missing tenant: Check existence before update, return 404 not 500 (correct HTTP contract)
- Slug validation: Enforce DNS-label rules via regex (no leading/trailing hyphens)
- Added test coverage for 404 on state update to non-existent tenant

**Follow-up fixes:**
- Updated README to clarify concurrent state-change protection is a target, not enforced yet
- Removed gitignored inbox files from commit history
- Fixed decision doc inconsistency: weekly backup verification IS Phase 1 scope
- Cleaned up broken inbox references in decisions.md

**Deferred to Phase 1:**
- CORS + admin-realm JWT (per locked decision, integrates with #54)
- Concurrent state-change locking (needs orchestration context)

**Validation:** All 16 tests pass, lint clean, build succeeds.

**Commit:** b0091ae, pushed to `squad/53-control-plane-skeleton`

**Learnings:**
- `better-sqlite3` transactions require the explicit `.transaction()` method; wrapping UPDATE + INSERT in a function passed to `.transaction()` ensures atomicity
- SQLite foreign key constraints are OFF by default; enable with `db.pragma('foreign_keys = ON')` immediately after opening the database
- `process.env.PORT` is always a string when set; passing it directly to `app.listen()` makes Node treat it as a named pipe path rather than a TCP port number
- DNS-label validation regex: `/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/` enforces start/end with alphanumeric, max 63 chars
- Review feedback classification matters: distinguish blocking issues (fix now) vs follow-up (defer with rationale) vs not-applicable (explain and close)

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

📌 Recorded the locked Phase 1 control-plane ↔ tenant contract in `.squad/decisions.md`.

**Key decisions:**
- Tenant app exposes exactly four internal endpoints: `GET /health`, `GET /ready`, `GET /_control/info`, and `POST /_control/maintenance`. All cluster-internal only.
- Pure push model — control plane drives all interactions. Tenant app never phones home, never heartbeats, never registers itself. Zero outbound dependency on control plane.
- Provisioning, backup, restore, updates, deprovisioning — all orchestrated by control plane via K8s API + direct Postgres access + the locked tenant endpoints documented in `.squad/decisions.md`.
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
- Control-plane schema bootstrap should stamp a version/signature (`user_version` + metadata) and fail fast on enum-constraint drift, instead of waiting for a later write to discover stale SQLite CHECK constraints.
## 2026-04-19: Issue #42 — Remaining 4 Clarifications Recommendation

📌 Wrote `.squad/decisions/inbox/data-42-remaining-four.md` covering the 4 remaining open clarification items from the #42 epic.

**Items addressed:**
1. **Tenant lifecycle state machine** — 9 states (provisioning → migrating → ready → maintenance/upgrading/restoring/suspended → failed/deprovisioned). `desired_state`/`observed_state` reconciliation model. Every state has explicit DB write posture.
2. **Auth migration (OIDC/Keycloak)** — Three-phase additive migration (2a: add OIDC alongside local, 2b: default OIDC + deprecate local, 2c: remove local). AuthAdapter strategy pattern. Guest tokens unchanged. Membership model unchanged. No flag day.
3. **Version-skew policy** — Strict same-version Phase 1; N/N-1 read compatibility starting Phase 2. Forward-only schema migrations. `schema_meta` table for version tracking.
4. **Local Keycloak dev** — Optional Docker Compose sidecar with realm import. No backend code changes until Phase 2a. Does not affect `npm run dev` or `npm test`.

**Key decisions:**
- State machine is the foundation — items 2 and 3 depend on it.
- Auth identity and campaign membership are separate concerns. OIDC changes who you are; membership says what you can do. Keep them apart.
- Version skew starts narrow (same-version only) and widens only when fleet size forces it.
- Local Keycloak is a developer convenience, not a dependency.

### Learnings

- Tenant lifecycle state machine should use `desired_state`/`observed_state` reconciliation (Kubernetes pattern). Control plane writes desired; polls observed from `/_control/info`.
- Auth migration must be additive and reversible. The `AuthAdapter` strategy pattern (env-var selected) gives a rollback path at any point.
- Guest share-link tokens are orthogonal to OIDC — they stay app-issued and membership-scoped regardless of identity provider.
- `schema_version` tracked in both the tenant database (`schema_meta` table) and control-plane registry (`tenants.schema_version`) enables backup/restore version mismatch detection.
- Version-skew testing cost is multiplicative. Defer N/N-1 support until fleet size makes coordinated upgrades impractical.


## 2026-04-19: Issue #53 Control-Plane Architecture Analysis & Phase 1 Readiness


**Outcome:**
- ✅ #53 can start immediately in parallel with Phase 0 (#52, #43, #46)
- ✅ Control plane and tenant workload are decoupled; no blocking architectural gap
- ✅ All locked decisions from #42 (Phase 1) are accounted for in the skeleton design
- ✅ Execution plan documented and ready for implementation

**Key findings:**

1. **Control-Plane Database:** Single-replica SQLite (Phase 1), not Postgres
   - Write volume negligible: ~N tenant events/day + audit rows
   - Explicit upgrade path to Postgres documented for Phase 2 (50–100+ tenant scale)
   - Keeps local dev story simple (one sqlite file); intentional separation from tenant Postgres databases

2. **Tenant Registry Model (7-state machine):**
   - `tenants` table: id, slug, ownerId, displayName, state, desiredState, imageTag info, Postgres reference, backup metadata, timestamps
   - `tenant_state_transitions` audit table: append-only lifecycle history with error tracking
   - State enum locked to 7 states from #42 (provisioning→ready⇄maintenance⇄upgrading, restoring, failed, deprovisioned)
   - Idempotent state transitions with validation (rejects invalid moves)

3. **Internal API (Phase 1 skeleton):**
   - `POST /internal/tenants` – Create + request K8s provisioning (idempotent by slug)
   - `GET /internal/tenants` – Fleet visibility with optional filters
   - `GET /internal/tenants/:id` – Full record + live K8s state
   - `PATCH /internal/tenants/:id` – Request state transition + image upgrade
   - `POST /internal/tenants/:id/backups` – Log completed backup
   - `GET /internal/tenants/:id/backups` – Backup catalog (metadata only, blobs in object storage)
   - No `/control/info` endpoint in control plane Phase 1 (tenant reads control plane, not reverse)

4. **Sequencing logic:**
   - Phase 0 validates tenant workload (container image, Postgres porting, health checks) — no orchestration needed
   - Phase 1 builds control plane skeleton in parallel — zero code dependency on tenant app
   - Control plane uses K8s API for state observation (standard pattern), not tenant callbacks
   - Integration point: #54 (provisioning orchestrator) consumes both Phase 0 container + Phase 1 control-plane APIs

5. **Blockers:** None identified
   - All locked decisions from #42 Phase 1 mapped into schema/API design
   - No architectural guidance needed from Lead (self-contained backend work)
   - Ready to proceed autonomously

**Monorepo placement:**
- New: `apps/control-plane/` (Node.js + Express, mirrors API structure)
- Workspace addition: Root `package.json` + `tsconfig.json`
- No changes to `apps/api` or `apps/web`

**Timeline:** 12–16 hours (Data, Backend Dev)
- Schema design + SQL bootstrap (2h)
- Express routing + internal endpoints (4h)
- State machine validation + audit (3h)
- Test coverage (3–4h)

**Decision written to:** `.squad/decisions/inbox/data-control-plane-slice.md` for Mikey (Lead) review

**Next step:** Implementation can begin immediately; review happens asynchronously.


---


## 2026-04-18: Issue #53 — Control Plane Skeleton


**Implementation:**
- Created `apps/control-plane` workspace following existing monorepo patterns
- Implemented SQLite-backed tenant registry with 7-state lifecycle model (provisioning, ready, maintenance, upgrading, restoring, failed, deprovisioned)
- Built internal API surface for tenant CRUD and state management
- All state transitions logged in audit table for full lifecycle history
- 15 comprehensive tests covering full API contract
- Validation: lint clean, build succeeds, all tests pass

**Key Design Decisions:**
- SQLite persistence for Phase 1 (low write volume, straightforward backups)
- Explicit state tracking (no implicit state inference)
- Idempotent state transitions with audit trail
- Thin by design — no business logic beyond registry CRUD and state tracking

**Learnings:**
- When SQLite datetime() creates identical timestamps in rapid succession, use `ORDER BY id DESC` instead of `ORDER BY created_at DESC` for deterministic ordering
- In-memory SQLite databases (`:memory:`) require proper cleanup in test `afterEach` hooks to prevent state leakage between tests
- Monorepo workspace addition requires updating root `package.json` workspaces array and adding convenience dev scripts
- Control-plane port 3001 chosen to avoid conflict with tenant API (3000)

**Follow-up Work:**
This skeleton is ready to drive:
- Issue #54: K8s provisioning orchestration
- Issue #55: Rolling update choreography
- Issue #40: Backup/restore coordination

**PR:** #59 (awaiting Copilot review)


📌 Team update (2026-04-19T22:50:29Z): Issue #58 architecture decisions locked by Mikey. Three decisions ready: SERIALIZABLE isolation, conservative pool defaults, DATABASE_URL fallback rule. Chunk's QA gate confirms done signals. Proceed with implementation in worktree. — Scribe
## 2026-04-21T16:43:21Z — PR #67 Phase 0 Gate Review Complete

**Backend Architecture & Database:**
- `apps/api/src/note-store.ts` owns SQLite schema bootstrap; compatibility fixes for local dev databases should run there before prepared note queries are created.
- The default dev database lives at `apps/api/data/dnd-notes.sqlite`; prefer in-place startup upgrades over asking developers to reset data.
- Backend verification: `npm run lint --workspace apps/api`, `npm test --workspace apps/api`, `npm run build --workspace apps/api`, with `npm run dev` confirming the shared dev startup path.
- Regression coverage for membership consolidation and migration updates live in `apps/api/test/app.test.ts`, covering guest-to-guest counts plus explicit confirmation before role-changing moves.

**API Contracts:**
- Share links persist only `token_hash` in `apps/api/src/note-store.ts`, while owner list payloads expose metadata only. `POST /api/campaigns/:campaignId/share-links` is the lone place returning the raw token/url.
- Share-link reveal contract lives in `apps/api/src/app.ts` at `GET /api/campaigns/:campaignId/share-links/:shareLinkId`, returns only `{ token, url }` on success, leaves `GET /api/campaigns/:campaignId/share-links` metadata-only.
- Session-browsing auth should mirror `/api/notes`: keep `GET /api/notes/sessions*` in `apps/api/src/app.ts` behind `resolveAccessibleCampaign()` for collaborator access, not `resolveOwnedCampaign()`.
- Issue #33 backend lives in `apps/api/src/app.ts` as `GET /api/notes/activity`, reusing `resolveAccessibleCampaign()`.
- Recent activity payload is intentionally latest-state only: derive one `created` or `edited` event per note from `createdAt`/`updatedAt`, pair with collaborator summaries from note attribution.
- Shared membership claims should rotate `campaign_memberships.guest_token_id` in `apps/api/src/note-store.ts` when attaching `user_id`; frontend must persist the replacement token for persistent browser sessions.

**Note & Link Management:**
- Express already decodes `request.params.sessionId`; frontend callers should use `encodeURIComponent(sessionName)` once.
- Issue #30 note-to-note links: `linkedNoteIds` validated in schemas (20-link limit), stored as JSON array in `notes.linked_notes_json`, with cross-campaign and non-existent note blocking.
- `getBacklinks()` method and `GET /api/notes/:noteId/backlinks` surface backlinks scoped to same campaign; all three note SELECT queries include `linked_notes_json` column.
- Link error handling wraps createNote/updateNote to return 400 for validation failures rather than 500; legacy database migration adds column with safe default.
- Issue #26: note bodies remain stored as plain text; web app interprets as Markdown so old notes stay readable without migration.
- Shared note rendering lives in `apps/web/src/note-formatting.tsx`, uses `react-markdown` + `remark-gfm`, reused by both `apps/web/src/App.tsx` and `apps/web/src/SharedCampaignRoute.tsx`.
- Rich-formatting regression coverage in `apps/web/src/note-formatting.test.tsx`, app wiring in `apps/web/src/App.test.tsx`.

**Control-Plane Architecture:**
- Parse `process.env.PORT` string to number with range check (prevents named-pipe misinterpretation).
- Enable SQLite FK pragma on initialization (ensures CASCADE works).
- Wrap tenant state update + audit log insert in single transaction (prevents broken audit trail).
- Check tenant existence before update, return 404 not 500 (correct HTTP contract).
- Enforce DNS-label rules via regex for slug validation (no leading/trailing hyphens).
- Control-plane auth middleware should drain unauthorized request bodies before returning 401.
- Control-plane shutdown should bound `server.close()` with a hard timeout; keep-alive sockets can otherwise block SIGINT/SIGTERM exit.
- Locked issue #53 management routes live under `/internal/tenants*`; keep service code, tests, and README aligned to that internal-only contract.
- Control-plane state audit rows should read `current_state` inside the same write transaction used for the update; `reason` should be omitted or non-empty.

**Database Adapter & Postgres Integration:**
- Issue #58 moved `apps/api/src/note-store.ts` behind an async statement wrapper in `apps/api/src/note-store-database.ts` so API can await the same `prepare/get/all/run` flow on SQLite and Postgres.
- API selects Postgres whenever `DATABASE_URL` is set, otherwise falls back to SQLite via `NOTES_DB_PATH`.
- Postgres pool tuning: `NOTES_DB_POOL_MIN`, `NOTES_DB_POOL_MAX`, `NOTES_DB_IDLE_TIMEOUT_MS`, `NOTES_DB_CONNECTION_TIMEOUT_MS`, `NOTES_DB_STATEMENT_TIMEOUT_MS`.
- Admin backup/restore keeps SQLite-compatible snapshot format even for Postgres-backed tenants: `backupDatabase()` exports `.sqlite` snapshot, `restoreNoteStoreFromBackup()` can import into Postgres.
- Regression coverage for adapter slice lives in `apps/api/test/postgres-adapter.test.ts`, existing API suite validates SQLite fallback path.
- Monorepo workspace addition requires updating root `package.json` workspaces array and adding convenience dev scripts.
- Control-plane port 3001 chosen to avoid conflict with tenant API (3000).
- When SQLite datetime() creates identical timestamps in rapid succession, use `ORDER BY id DESC` instead of `ORDER BY created_at DESC` for deterministic ordering.
- In-memory SQLite databases (`:memory:`) require proper cleanup in test `afterEach` hooks to prevent state leakage.

**Decision & Documentation Practices:**
- When a locked squad decision supersedes an exploratory history note, point the history entry at `.squad/decisions.md` or mark explicitly superseded.
- Do not leave PR-visible history pointing at stale inbox artifacts or retired endpoint drafts.


## 2026-04-21: PR #67 Rollout Strategy Fix

Addressed Copilot review comments on PR #67 (issue #55 rolling-update choreography):

**Problem:** Initial implementation used `maxSurge: 1` / `maxUnavailable: 0`, which could deadlock on multi-node clusters due to RWO PVC multi-attach limits when the surge pod schedules to a different node.

**Solution (following Mikey's lead decision):**
- Changed Deployment strategy to `maxSurge: 0` / `maxUnavailable: 1` (drain-first replacement)
- Tightened `waitForTenantReady()` to wait for full rollout completion: checks `observedGeneration >= metadata.generation`, `updatedReplicas === spec.replicas`, `availableReplicas === spec.replicas`, `replicas === spec.replicas`, `unavailableReplicas === 0`, and `Available=True`
- Updated all docs (control-plane README, RUNTIME.md, root README, squad artifacts) to reflect drain-first rollout with no pod overlap
- This prevents multi-attach issues while the per-tenant RWO PVC remains mounted

**Files changed:**
- `apps/control-plane/src/provisioning.ts` — rollout strategy + stricter readiness wait
- `apps/control-plane/test/provisioning.test.ts` — updated test assertions
- `apps/control-plane/README.md`, `RUNTIME.md`, `README.md` — operator docs
- `.squad/skills/postgres-tenant-rolling-update/SKILL.md`, `.squad/agents/data/history.md`, `.squad/qa-brief-issue-55.md`, `.squad/agents/copilot/history.md` — squad artifacts

**Review loop:** Fixed issues through 3 iterations (4 Copilot reviews total), resolving all 13 review threads. Final review clean with no new comments.

**Key learning:** Drain-first replacement (`maxSurge: 0`) is the safe default while RWO PVCs remain in the pod shape. Future zero-downtime rollouts (`maxSurge: 1`) can come once the PVC is removed or becomes RWX.


## 2026-04-21: Issue Audit and Hardening Gaps Analysis

**Work:** Audited existing issues to avoid duplicates, created GitHub issue #69 (per-tenant Postgres credentials), identified 2 high-confidence backend gaps.

**Issue #69 Created:** "Implement per-tenant Postgres roles and least-privilege runtime credentials"
- **Current state:** All tenant instances share single runtime Postgres credential (`TENANT_DATABASE_RUNTIME_URL`)
- **Problem:** Breaks least-privilege isolation; tenant app compromise = all databases exposed
- **Solution:** Per-tenant Postgres roles with minimal privileges (CONNECT, USAGE only; no superuser/create database)
- **Scope:** Extend `PostgresTenantDatabaseManager.ensureTenantDatabase()` to create randomized per-tenant role, store in per-tenant K8s Secret, cleanup on deprovision
- **Related:** Complements Epic #42 Phase 1 decisions on tenant persistence + #56 Keycloak identity work0

**Duplicate Audit Results:**
- Searched for "postgres credentials OR per-tenant role OR per-tenant secret" — only Epic #42 matched
- Searched for "operator site OR landing site OR operator dashboard" — only Issue #57 (internal fleet status) matched (not a duplicate)
- Conclusion: No existing issues duplicate the per-tenant credential scope; #69 is novel

**Backend Hardening Gaps Identified** (high-confidence, unresolved in Phase 0–1):

1. **Per-Tenant Transition Locking** (MEDIUM priority, affects state consistency)
   - **Current state:** Control-plane README §159–165 explicitly documents: "Single active transition (target): Transitions are intended to be serialized per tenant, **but Phase 1 does not yet enforce this with locking or transactional guards**"
   - **Risk:** Concurrent `PATCH /internal/tenants/:tenantId/state` calls could interleave updates, skip state transitions, or create orphaned K8s resources (e.g., concurrent provision + restore both try to create same PVC)
   - **Gap:** No per-tenant lock (file lock, database row lock, or in-memory semaphore) prevents concurrent transitions
   - **Why not created as issue:** This is already documented as Phase 1 limitation in the README; team is aware. No need to create speculative ticket.

2. **Incomplete Provisioning Rollback** (MEDIUM priority, affects recovery)
   - **Current state:** Provisioning is a multi-step flow: (1) reserve subdomain, (2) create database, (3) apply K8s resources, (4) wait for ready, (5) update registry
   - **Risk:** If step 3 fails (K8s API down), step 2 succeeds (Postgres DB created, orphaned) and registry state moves to `failed`, but the orphaned DB is never deleted until deprovisioning
   - **Gap:** If tenant is stuck in `failed` state and operator retries provision without first deprovisioning, the old database remains; no idempotent cleanup or garbage-collection sweep
   - **Why not created as issue:** Phase 1 deprovisioning (#54 follow-up) is scoped to clean up failed tenants; team intends to handle this operationally. Should be explicitly documented in runbook, not a code gap.

**Conclusion:** Issue #69 is the only actionable missing ticket at this scale. The two gaps are already recognized design tradeoffs documented in control-plane README and Phase 1 scope.

---

- Issue #69 keeps `TENANT_DATABASE_RUNTIME_URL` as a runtime URL template only in `apps/control-plane/src/provisioning.ts`; newly provisioned tenants get a generated Postgres role/password, while already-provisioned tenants keep their existing runtime secret until an explicit migration.
- Least-privilege hosted startup now splits bootstrap from runtime in `apps/control-plane/src/tenant-database-bootstrap.ts` and `apps/api/src/note-store-bootstrap.ts`: the control plane pre-initializes schema/privileges, and the API verifies the schema instead of attempting DDL when the Postgres runtime user lacks `CREATE`.
- Safe tenant teardown for this slice lives in `apps/control-plane/src/provisioning.ts`: deprovisioning terminates tenant sessions, drops the tenant database, and drops the deterministic tenant runtime role, with regressions in `apps/control-plane/test/provisioning.test.ts`.
- Validation for the least-privilege Postgres slice is `npm run lint --workspace apps/control-plane`, `npm run test --workspace apps/control-plane -- --runInBand`, `npm run build --workspace apps/control-plane`, `npm run lint --workspace apps/api`, `npm run test --workspace apps/api -- --runInBand`, `npm run build --workspace apps/api`, and `npm run platform:validate`.
