# Session Log: Epic #42 Planning Progress — Phase 0–1 Clarifications & Backup Decision

**Date:** 2026-04-18  
**Participants:** Mikey (Lead), Data, Brand, FFMikha (user)  
**Topic:** Issue #42 (multi-tenant K8s platform) Phase 0–1 scope and backup/restore strategy  
**Status:** Three Phase 0–1 clarifications locked; Phase 1 backup/restore posture finalized; Phase 0 sync in flight  

---

## Planning Milestones This Session

### ✅ 1. Phase 0–1 Clarifications Reviewed (Tier 1: Blockers, Tier 2: Phase 1 Decisions)

**Three independent parallel reviews completed:**
- Mikey: Grouped 9 clarification points into Phase 0 blockers, Phase 1 decisions, post-Phase-1 deferrals
- Data: Assessed persistence, control-plane contract, state machine, auth migration, versioning
- Brand: Evaluated k3d dev loop, ingress/DNS/TLS, CI scope, operational readiness

**Tier 1 Phase 0 Blockers (must decide this week):**
1. Local k3d/k3s dev loop + parity definition → **Locked:** k3d for daily fast iterations; k3s on VM for stateful rehearsals (PVCs, rolling restarts, backup/restore)
2. CI coverage scope → **Locked:** Phase 0 includes container build + smoke tests + manifest validation (no auto-GHCR push)
3. Phase 1 ingress/wildcard DNS/TLS spec → **Locked:** opaque wildcard subdomains + same-origin web + API

**Tier 2 Phase 1 Critical Decisions (resolve 1 week before Phase 1 kickoff, ~2026-04-25):**
1. Control-plane ↔ tenant API contract + internal APIs
2. Control-plane state machine + tenant lifecycle states
3. **Backup/restore strategy** → **DECIDED TODAY: Two-layer Postgres strategy (managed PITR + daily `pg_dump`)**
4. Version-skew policy (N / N-1 compat or coordinated upgrades only)

**Tier 3 Phase 2+ Deferrals (explicitly deferred):**
1. Auth migration path (OIDC/Keycloak cutover + coexistence)
2. Local Keycloak dev setup (Docker Compose + realm import)

---

### ✅ 2. Phase 1 Backup/Restore Posture Finalized

**Decision:** Two-layer backup strategy for tenant Postgres databases

| Layer | Mechanism | Scope | RPO | RTO | Purpose |
|-------|-----------|-------|-----|-----|---------|
| **Managed PITR** | Azure Flexible Server built-in continuous WAL archiving + daily snapshots | Entire server (all tenants) | ~5 min | 15–30 min | Fleet-wide disaster recovery (DRP escalation path) |
| **Logical backup** | Scheduled `pg_dump --format=custom` per tenant → Azure Blob Storage | Single tenant database | **1 day** (accepted by user) | 5–15 min | Routine single-tenant restore (primary path) |

**Phase 1 Build:**
- K8s CronJob: `pg_dump` per tenant per day to Blob Storage
- Blob lifecycle policy: 7-day retention (auto-expire older dumps)
- Backup catalog table: Control plane tracks metadata (tenant, timestamp, blob path, size, row counts, status)
- Manual restore runbook: 7-step operator procedure
- Backup health check: `/internal/status` includes `last_backup_age`; alert if >12h

**Phase 2+ Deferrals:**
- Automated restore API
- Backup verification CronJob (weekly test-restore)
- Per-tier backup frequency (premium: hourly, free: daily)
- Cross-region replication

**Rationale:**
- Managed PITR is free (included in Flexible Server); fleet sub-5-minute RPO is non-negotiable for disaster recovery.
- PITR cannot cherry-pick a single tenant; logical backups provide surgical restore without server-level disruption.
- Daily cadence acceptable for Phase 1 (no paying customers, <100 MB per tenant, ~$3/month storage cost).
- If customers demand tighter RPO later, upgrade to hourly or per-tenant Postgres instances.

---

### 📋 3. Mikey Phase 0 Sync (In Flight)

**Action:** Mikey updating GitHub issue #42 body to reflect locked architecture decisions
- Tenant persistence: Postgres (one DB per tenant)
- Live data storage: Managed block storage (AKS Managed Disks)
- Backup artifacts: Azure Blob Storage
- Infrastructure: AKS, ingress-nginx, cert-manager, wildcard DNS-01, K8s Secrets
- Deferred: OKE/ARM from current plan
- Added: Phase 0 includes NoteStore Postgres migration (#46)

**Status:** Sync comment to be added linking to `.squad/decisions.md` reference for all locked clarifications.

---

## Decisions Ready for Merge

1. **Issue #42 Phase 0–1 clarifications** (4 locked items):
   - Local dev loop: k3d + k3s
   - CI scope: container build + tests + manifest validation
   - Phase 1 ingress/TLS: opaque wildcard subdomains + same-origin
   - GHCR private images: imagePullSecrets pattern + package-read credentials

2. **Issue #42 Phase 1 backup/restore posture** (two-layer strategy, daily logical backup cadence):
   - Data recommendation: `.squad/decisions/inbox/data-42-backup-restore.md`
   - Brand recommendation: `.squad/decisions/inbox/brand-42-backup-restore.md`
   - **User acceptance:** Phase 1 logical backup cadence = once per day ✅

---

## Timing & Next Steps

- **2026-04-18:** Mikey sync + Scribe merge (today)
- **2026-04-25:** Phase 1 planning session (revisit Tier 2 decisions with full team)
- **2026-04-30:** Phase 2 planning session (revisit Tier 3 decisions with FFMikha + Data)

---

## Cross-Phase Context

**Phase 0 owner:** Brand (deployment + CI)  
**Phase 1 owners:** Data (control plane + backup), Brand (ingress/K8s operations)  
**Phase 2 owners:** Data (auth integration), Brand (Keycloak operations)  

All three Phase 0–1 architecture decisions now feed directly into Phase 1 kickoff and child issue scope (#43, #46, #52, #53, #54, #55).

---

**Artifacts:** 
- `.squad/decisions/inbox/mikey-42-phase0-sync-correction.md` — Four locked clarifications
- `.squad/decisions/inbox/data-42-backup-restore.md` — Full backend assessment
- `.squad/decisions/inbox/brand-42-backup-restore.md` — Full infrastructure assessment
- `.squad/orchestration-log/2026-04-18T15-18-25Z-issue-42-backup-restore-decision.md` — Decision details

**Status:** Ready for Scribe merge and GitHub sync.
