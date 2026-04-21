# Orchestration Log: Issue #42 Backup/Restore Decision Lock

**Date:** 2026-04-18T15:18:25Z  
**Participants:** Data, Brand, Mikey (lead), FFMikha (user)  
**Topic:** Phase 1 tenant Postgres backup/restore strategy finalization  
**Status:** User accepted cadence; decision ready for merge  

---

## Summary

Data and Brand independently recommended identical Phase 1 backup/restore posture: two-layer strategy combining managed Postgres PITR (fleet-level safety net) with daily per-tenant `pg_dump` to Azure Blob Storage (single-tenant surgical restore).

**User accepted:** Phase 1 logical backup cadence = once per day.

---

## Decision Details

### Locked Direction

| Layer | Mechanism | RPO | RTO | Purpose |
|-------|-----------|-----|-----|---------|
| **Managed PITR** | Azure Flexible Server built-in continuous backup | ~5 min | 15–30 min | Fleet-wide disaster recovery |
| **Logical backup** | Scheduled `pg_dump` per tenant → Blob Storage | **1 day** | 5–15 min | Single-tenant surgical restore |

### Phase 1 Scope — Build Now

- Backup CronJob: K8s CronJob iterating tenants, running `pg_dump --format=custom` per tenant to Blob
- Blob lifecycle policy: Auto-expire backups older than 7 days
- Backup catalog table: Track backup metadata (timestamp, blob path, size, row counts, status)
- Manual restore runbook: 7-step operator procedure (download dump, create fresh DB, restore, validate, swap, notify)
- Backup health check: Control-plane `/internal/status` includes `last_backup_age` per tenant; alert if >12h stale

### Phase 2+ Deferrals

- Automated restore API (`POST /internal/tenants/{id}/restore`)
- Backup verification CronJob (weekly test-restore)
- Per-tier backup frequency (premium: hourly, free: 6h)
- Cross-region replication

---

## Rationale

**Why both layers?**
- Managed PITR is free (included in Flexible Server). Fleet-wide sub-5-minute RPO is priceless for catastrophic failure.
- PITR cannot restore a single tenant without restoring the entire server. Logical backups fill the single-tenant gap.
- Two-layer approach balances simplicity (no custom WAL archiving), cost (Blob storage ~$3/month at Phase 1 scale), and operational confidence (tested restore workflow from day one).

**Why daily, not 6-hourly?**
- Phase 1 has no paying customers. Internal users accept 24-hour RPO.
- Free tier database < 100 MB. 100 tenants × 100 MB × 28 snapshots ≈ 280 GB cool blob ≈ $3/month.
- If customers demand tighter RPO, escalate to hourly or per-tenant Postgres instances (Phase 2+).

**Why not WAL archiving or pgBackRest?**
- Overkill at Phase 1 scale. Managed PITR already covers fleet-level needs.
- Adds custom replication infrastructure; testing burden multiplies.
- Clear upgrade path exists if needed post-Phase-1.

---

## Cross-Team Notes

- **Data:** Owning backup catalog schema + restore procedure (Phase 1)
- **Brand:** Owning K8s CronJob + Blob lifecycle policy (Phase 1)
- **Mikey:** Depends on both for issue #42 Phase 1 scope finalization

---

## Artifacts

- `.squad/decisions/inbox/data-42-backup-restore.md` — Full backend/schema assessment
- `.squad/decisions/inbox/brand-42-backup-restore.md` — Full infrastructure/operations details
- **User acceptance:** Phase 1 cadence = once per day ✅

---

**Next:** Scribe merges both recommendations into `.squad/decisions.md` under issue #42 section.
