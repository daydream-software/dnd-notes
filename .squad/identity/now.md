# Current Focus

- **Updated:** 2026-04-18T14:50:02Z
- **Active slice:** Issue #42 Phase 0 execution — Postgres-based tenant direction locked
- **Execution status:** All five cross-cutting decisions locked (registry: ghcr.io, ingress: ingress-nginx, TLS: wildcard cert-manager, secrets: K8s Secrets Phase 0–1, persistence: Postgres per-tenant databases). OKE/ARM dropped. Decision gate resolved.
- **Phase 0 execution (Postgres-based):** Parallel tracks begin immediately:
  - **Track A (Data):** NoteStore Postgres adapter (5–7 days) — port `note-store.ts`, `note-store-notes.ts`, `note-store-bootstrap.ts` from `better-sqlite3` (sync) to `node-postgres` (async). Keep SQLite as fallback for local dev. All API tests pass against Postgres.
  - **Track B (Brand):** Dockerfile + K8s manifests (3–5 days parallel) — multi-stage Dockerfile, Deployment, Service, StatefulSet for Postgres (dev) or reference Azure Postgres Flexible Server (prod).
  - **Track C (Brand):** CI pipeline (1 day after B) — container build + push to ghcr.io via GitHub Actions.
- **Phase 0 gate (Postgres-based):** App runs against Postgres (all API tests pass), rolling update is stateless (zero-downtime), SQLite fallback works for local dev, Dockerfile is maintainable.
- **Tracked platform issues:** #52, #43, #53, #54, #55, #56, #39, #40, #57
- **Live issue slice:** Issue #46 (`squad:data` — note SQL refactor) continues in parallel with Phase 0
- **Production context still active:** same-origin deployment default, admin backup/restore now shipped, WAL/restore-concurrency/provisioning follow-ups tracked in #39–#43
- **Decision gate status:** ✅ CLOSED. All decisions locked. Phase 0 ready to execute.

## 2026-04-11 21:53 UTC — First App.tsx Refactor Slice Landed

**Lane:** Frontend shell extraction (`#44`)

**Progress:** Extracted note editor action toolbar into `NoteEditorActions.tsx`, validated, committed to `squad/44-app-shell-refactor` worktree branch.

**Next:** Continue extracting bounded presentation components from `App.tsx` — campaign form, share link panel, or session browser.
