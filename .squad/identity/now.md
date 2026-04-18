# Current Focus

- **Updated:** 2026-04-19T22:36:25Z
- **Active slice:** Epic #42 Phase 0 Wave 1 — Parallel execution of #52 (Containerize) and #53 (Control-plane skeleton)
- **Execution status:** All five cross-cutting decisions locked (registry: ghcr.io, ingress: ingress-nginx, TLS: wildcard cert-manager, secrets: K8s Secrets Phase 0–1, persistence: Postgres per-tenant databases). OKE/ARM dropped. Decision gate resolved.
- **Phase 0 execution (Postgres-based) — Wave 1 (parallel start):**
  - **Track A (Brand) — Issue #52:** Containerize dnd-notes (1–2 days) — multi-stage Dockerfile, health/readiness endpoints, runtime contract doc, CI container build + smoke tests. No auto-push to GHCR Phase 0.
  - **Track B (Data) — Issue #53:** Control-plane skeleton (12–16 hours parallel) — new `apps/control-plane/` service, SQLite tenant registry, 7-state lifecycle model, thin internal API, audit table. Self-contained; integrates in Phase 1 (#54).
  - **Track C (Data) — BLOCKING:** Postgres adapter port (better-sqlite3 → node-postgres async) — **no tracking issue yet**. Needed for Phase 0 tenant containers to run against Postgres. Priority: file new issue ASAP.
- **Phase 0 gate (Postgres-based):** App containerizes successfully (all health/readiness probes validated in k3d), Postgres adapter ports note-store backend (all API tests pass), SQLite fallback works for local dev, control-plane skeleton exists for Phase 1 integration.
- **Wave 2 (blocked on Wave 1):**
  - #43 Deployment artifacts — rescope as CI pipeline intake (manifest validation, build automation)
  - #54 Provision tenant workloads — depends on #52 + #53
  - #55 Rollout choreography — **stale scope**: retitle for Postgres rolling-update choreography (not SQLite single-writer rules)
- **Tracked platform issues:** #52, #43, #53, #54, #55, #56, #39, #40, #57, and new issue needed for Postgres adapter
- **Production context still active:** same-origin deployment default, admin backup/restore now shipped, WAL/restore-concurrency/provisioning follow-ups tracked in #39–#43
- **Decision gate status:** ✅ CLOSED. All platform decisions locked. Wave 1 execution ready. Stale items identified (see inbox flags).

## 2026-04-11 21:53 UTC — First App.tsx Refactor Slice Landed

**Lane:** Frontend shell extraction (`#44`)

**Progress:** Extracted note editor action toolbar into `NoteEditorActions.tsx`, validated, committed to `squad/44-app-shell-refactor` worktree branch.

**Next:** Continue extracting bounded presentation components from `App.tsx` — campaign form, share link panel, or session browser.
