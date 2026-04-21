# Session Log: Issue #42 Postgres Direction Locked

**Date:** 2026-04-18T14:50:02Z  
**User:** FFMikha  
**Event:** Locked Postgres-based tenant persistence direction for issue #42

---

## Summary

User explicitly confirmed the Postgres-based direction for tenant data persistence in issue #42 after reviewing three independent evaluations from Mikey, Brand, and Data.

**Locked decision (Decision #5):**
- **Tenant persistence model:** Shared Postgres instance, per-tenant databases, per-instance DB users
- **Backup strategy:** Centralized pg_dump → Azure Blob Storage
- **App architecture:** Stateless pods, NoteStore async migration (sync → `node-postgres`)
- **Rolling updates:** Standard K8s rolling update (no special choreography)
- **Local dev:** SQLite fallback (no Postgres dependency in development)

---

## Phase 0 Implications

**New critical path:** NoteStore Postgres adapter (~2600 lines)

**Parallel execution:**
1. **Data:** Port `note-store.ts` + `note-store-notes.ts` + `note-store-bootstrap.ts` from `better-sqlite3` (sync) to `node-postgres` (async). Keep SQLite as fallback. All API tests pass against Postgres. (5–7 days)
2. **Brand:** Dockerfile + K8s manifests (Deployment, Service, StatefulSet for Postgres or reference to Azure-managed Postgres). (3–5 days, parallel)
3. **Brand:** CI pipeline — container build + push to ghcr.io. (1 day after manifests)

**Phase 0 gate (revised):**
- ✅ App runs against Postgres (all API tests pass)
- ✅ Rolling update works on k3d (stateless pods, zero-downtime)
- ✅ SQLite fallback works for local dev without Postgres
- ✅ Dockerfile and manifests are maintainable

---

## Decisions 1–4 (Locked Earlier)

No changes:
1. **Image registry:** GitHub Container Registry (ghcr.io)
2. **Ingress controller:** ingress-nginx via AKS add-on
3. **DNS & TLS:** Wildcard cert + cert-manager DNS-01
4. **Secret backend:** Kubernetes Secrets (Phase 0–1), documented as MVP

---

## Platform Direction

- **OKE/ARM:** Dropped (confirmed). AKS x86-64 only for Phase 0–2.
- **Local dev:** k3d remains unchanged (x86-64, SQLite or Postgres).
- **Phase 1+:** Control plane HA, multi-replica management, Postgres connection pooling (if 50+ tenants).

---

## Status

✅ Decision gate closed. Phase 0 execution can begin immediately.

No blockers remaining for Phase 0 start.

Estimated Phase 0 timeline with Postgres: **3–4 weeks** (includes NoteStore migration).
