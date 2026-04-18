# Issue #42 — Five Cross-Cutting Decisions (Revised for Postgres Pivot)

**By:** Mikey (Lead)
**Date:** 2026-04-18
**Type:** Blocking decision resolution for Phase 0 execution
**Triggered by:** FFMikha directive — evaluate Postgres backend, per-instance DB users, centralized backups; drop OKE/ARM

---

## Context

The previous recommendation (2026-04-18T03:15:00Z) locked 5 decisions around a **SQLite-per-tenant + PVC** model. FFMikha is now pushing Postgres with per-instance database users and centralized backups. This changes decision #5 (single-writer) fundamentally and ripples into secrets and execution order.

The app's data layer is ~2600 lines of synchronous `better-sqlite3` code across `note-store.ts`, `note-store-notes.ts`, and `note-store-bootstrap.ts` — roughly 50+ prepared statements. Migration to `node-postgres` (async) is mechanical but non-trivial. The SQL schema itself is standard and maps 1:1 to Postgres.

---

## User Proposals — Adopt / Reject / Reframe

| Proposal | Verdict | Rationale |
|----------|---------|-----------|
| **Postgres backend for tenant data** | ✅ ADOPT | Eliminates single-writer risk entirely. Pods become stateless — rolling updates are trivial. Postgres handles concurrency natively. Trade-off: ~2600-line NoteStore rewrite (sync → async), but the work is mechanical and pays for itself in operational simplicity. |
| **Per-instance DB users** | ✅ ADOPT | `CREATE USER tenant_xxx; CREATE DATABASE tenant_xxx OWNER tenant_xxx;` — clean isolation boundary, auditable, standard Postgres pattern. Control plane provisions users + databases instead of PVCs. |
| **Centralized backup** | ✅ ADOPT | `pg_dump` per-tenant or `pg_basebackup` for the whole cluster → Azure Blob Storage. Dramatically simpler than per-PVC snapshot choreography. Backup age, restore drill, and retention all become Postgres-native ops. |
| **Azure Disk vs Blob Storage** | 🔄 REFRAME | Not either/or — both needed for different layers. **Azure Managed Disk** for Postgres runtime (block storage, required for database I/O). **Azure Blob Storage** for backup cold storage (cheap, durable, ~$0.02/GB/month vs ~$1.50/GB/month for Standard SSD). User's cost intuition is correct: Disk is more expensive, so minimize what lives on Disk (one Postgres instance) and push backups to Blob. |
| **Drop OKE / ARM** | ✅ ADOPT | AKS-only. x64-only for Phase 0–2. Eliminates multi-cloud and multi-arch drag. Revisit only if cost or availability forces it. |

---

## The Five Decisions — Locked

### 1. Image Registry → GitHub Packages *(unchanged)*

- Free for public repos, OIDC-ready with GitHub Actions, zero external setup.
- Fallback: ACR if private images needed later.
- **Postgres pivot impact:** None.

### 2. Ingress Controller → ingress-nginx *(unchanged)*

- Boring, well-documented, AKS default, cert-manager proven.
- Same behavior in k3d and AKS.
- **Postgres pivot impact:** None.

### 3. Wildcard DNS + TLS → cert-manager DNS-01 *(unchanged)*

- Wildcard cert (`*.dnd-notes.example.com`) — one TLS secret for all tenants.
- DNS provider deferred (Azure DNS or Cloudflare). Phase 0 uses localhost.
- **Postgres pivot impact:** None.

### 4. Secrets → K8s Secrets + Postgres credential shape *(minor update)*

- K8s Secrets for Phase 0–1. Documented as MVP shortcut, not production-hardened.
- **New with Postgres:** Secrets now contain `DATABASE_URL` per tenant (or control-plane-issued connection params), not PVC mount paths. Shape: `postgres://tenant_xxx:password@pg-host:5432/tenant_xxx`.
- Upgrade path: Azure Key Vault or Sealed Secrets in Phase 2 if needed.

### 5. ~~Single-Writer Enforcement~~ → Tenant Persistence Model *(replaced)*

**Old decision:** Control-plane validation to enforce single-writer SQLite discipline.

**New decision:** **Shared Postgres instance, per-tenant database, per-tenant DB user.**

- One Azure-managed Postgres Flexible Server (or a self-hosted StatefulSet for dev).
- Control plane provisions: `CREATE USER`, `CREATE DATABASE`, grants, connection string → K8s Secret.
- Tenant app pods are **stateless** — connect to Postgres via `DATABASE_URL`, no PVC needed for app data.
- Rolling updates become trivial: new pod starts, old pod stops, Postgres handles the transition. No single-writer choreography, no PVC handoff, no WAL checkpoint dance.
- Single-writer enforcement is **eliminated as a concern** — Postgres handles concurrent writes natively.

**What this kills:**
- PVC-per-tenant architecture (replaced by shared Postgres)
- SQLite WAL investigation (#39) as a blocking concern (still interesting for local dev, but not production-critical)
- Complex rollout choreography in #55 (simplified to standard K8s rolling update)
- Per-PVC backup/snapshot strategy (replaced by Postgres-native backup)

**What this adds:**
- NoteStore Postgres adapter (~2600 lines of migration work)
- Postgres operational cost (one managed instance, or one StatefulSet + its own PVC)
- Connection pooling consideration (PgBouncer if tenant count grows past ~50)

---

## Revised Execution Order

### Phase 0 (revised): Containerize + Postgres Migration

**Two parallel tracks — the migration is the new critical path:**

| Track | Owner | Work | Time |
|-------|-------|------|------|
| **A: NoteStore Postgres adapter** | Data | Port `note-store.ts`, `note-store-notes.ts`, `note-store-bootstrap.ts` from `better-sqlite3` (sync) to `node-postgres` (async). Keep SQLite as fallback for local dev (`DATABASE_URL` absent → SQLite). All existing API tests must pass against Postgres. | 5–7 days |
| **B: Containerize** | Brand | #52 Dockerfile + #43 K8s manifests. Manifests now include a Postgres StatefulSet (dev) or reference Azure Postgres Flexible Server (prod). No PVC for app data. | 3–5 days (parallel) |
| **C: CI** | Brand | Container build + push to GitHub Packages. | 1 day after B |

**Phase 0 gate (revised):**
- ✅ App runs against Postgres (all API tests pass)
- ✅ Rolling update works on k3d (stateless pods, zero-downtime)
- ✅ SQLite fallback works for local dev without Postgres
- ✅ Dockerfile is maintainable

**Key change:** Phase 0 gate was "PVC survives rolling update" — now it's "app works against Postgres, rolling update is trivial because pods are stateless." Lower risk, higher confidence.

### Phase 1: Control Plane + Tenant Provisioning

**Simplified by Postgres:**
- #53: Control-plane skeleton — provisions Postgres databases/users instead of PVCs
- #54: Tenant provisioning — `CREATE DATABASE` + `CREATE USER` + deploy pod with `DATABASE_URL`
- #55: Rolling update rules — **dramatically simpler** (standard K8s `strategy: RollingUpdate`, no single-writer choreography)

**Phase 1 gate:** Two tenants, separate Postgres databases, data isolation verified, rolling update of one tenant while the other stays live.

### Phase 2: Auth (Keycloak) — *mostly unchanged*

### Phase 3: Ops Maturity — *simplified*
- Backup: `pg_dump` per tenant → Azure Blob Storage (cron job)
- Restore: `pg_restore` from Blob → target database
- #39 (WAL): Demoted from critical to nice-to-have (local dev optimization only)
- #40 (restore safety): Simpler — Postgres restore is a well-understood operation

---

## Risks Introduced by Postgres Pivot

| Risk | Severity | Mitigation |
|------|----------|------------|
| NoteStore migration scope (~2600 lines, sync → async) | Medium | Mechanical rewrite. Same SQL, different driver. Data owns it. Keep SQLite fallback for local dev. |
| Postgres operational cost | Low | Azure Flexible Server Burstable B1ms (~$13/month) is enough for early tenants. Scale tier later. |
| Connection pooling at scale | Low (deferred) | Not a concern until 50+ tenant databases. PgBouncer is the standard answer when needed. |
| Postgres itself needs a PVC + backup | Low | One PVC for one Postgres instance is dramatically simpler than N PVCs for N tenants. Azure-managed Postgres eliminates even this. |
| Testing parity (SQLite local vs Postgres CI) | Medium | Run API tests against both in CI. SQLite for fast local iteration, Postgres for truth. |

---

## Summary

Postgres is the right call. It eliminates the single hardest risk in the entire #42 plan (single-writer SQLite discipline on K8s) and replaces it with a well-understood, boring operational model. The trade-off — a NoteStore rewrite — is mechanical work with clear boundaries.

**Lock these five decisions. Start Phase 0.**
