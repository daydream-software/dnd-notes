# Orchestration Log: Issue #42 Decision Gate Resolution

**Timestamp:** 2026-04-18T14:50:02Z  
**Event:** User resolved decision #5 (tenant persistence) via coordinator acceptance  
**Context:** FFMikha explicitly accepted the Postgres-based direction for issue #42 after reviewing three independent proposals.

---

## Gate State Before Resolution

**Decision blocker:** Decision #5 (tenant persistence: SQLite vs. Postgres for Phase 0) had three conflicting recommendations:
- Brand (Platform Dev): SQLite Phase 0, defer Postgres to Phase 1–2
- Mikey (Lead): Postgres Phase 0, NoteStore rewrite included
- Data (Backend Dev): SQLite Phase 0, explicit single-writer rules; control-plane-only Postgres path if needed

**Decisions 1–4 locked:** All three proposals agreed on registry (ghcr.io), ingress-nginx, wildcard DNS-01 TLS, and K8s Secrets.

---

## Resolution

**User directive:** FFMikha accepted **Postgres-based direction** for tenant persistence.

**Accepted decisions (locked):**
1. GitHub Container Registry (ghcr.io)
2. ingress-nginx via AKS add-on
3. Wildcard certificate + cert-manager DNS-01
4. Kubernetes Secrets (Phase 0–1)
5. **Postgres for tenant data** — shared instance, per-tenant databases, per-instance DB users, centralized backups

**Decision impact:**
- OKE/ARM dropped from current platform plan (confirmed)
- Phase 0 includes NoteStore Postgres migration (~2600-line sync → async rewrite)
- Stateless pod architecture replaces single-writer choreography
- Rolling updates become standard K8s rolling update (zero-downtime)
- Postgres operational cost and connection pooling assumed for Phase 0 forward

---

## Action Items Completed by Scribe

1. **Orchestration log:** This entry
2. **Session log:** User locked Postgres direction (see `.squad/log/2026-04-18T14-50-02Z-issue-42-postgres-lock.md`)
3. **Decisions merged:** Coordinator decision merged to `.squad/decisions.md`
4. **Directive captured:** User directive merged to `.squad/decisions.md`
5. **Superseded proposals retired:** Brand, Mikey, Data proposals removed from inbox (not merged as canonical decisions)
6. **Now.md updated:** Phase 0 execution lane reflects Postgres direction
7. **Committed:** All `.squad/` changes staged and committed

---

## Next Execution Lane

**Phase 0 (Postgres-based):** Parallel tracks
- **Track A (Data):** NoteStore Postgres adapter (5–7 days)
- **Track B (Brand):** Dockerfile + K8s manifests (3–5 days parallel)
- **Track C (Brand):** CI container build + push (1 day after B)

**Phase 0 gate (revised):**
- ✅ App runs against Postgres (all API tests pass)
- ✅ Rolling update is stateless (zero-downtime)
- ✅ SQLite fallback works for local dev
- ✅ Dockerfile is maintainable

**Blocker:** None. Phase 0 execution can begin immediately.

---

**Status:** Decision gate closed. Postgres direction locked. Next: Phase 0 execution begins.
