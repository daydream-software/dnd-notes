# Issue #42 — Tenant Postgres Backup / Restore Strategy

**Author:** Brand (Platform Dev)  
**Date:** 2026-04-18  
**Status:** RECOMMENDATION — awaiting team acceptance  
**Scope:** Phase 1 hosted posture for per-tenant Postgres backup and restore on AKS + Azure Blob Storage  

---

## Executive Summary

Phase 1 should lean on **Azure Database for PostgreSQL Flexible Server built-in PITR** as the primary backup layer, supplemented by **scheduled `pg_dump` per tenant to Azure Blob Storage** for tenant-level granularity. This avoids custom replication infrastructure while giving us single-tenant restore capability from day one.

No WAL archiving pipeline. No pgBackRest. No custom continuous replication. Those are Phase 3+ concerns.

---

## Recommended Architecture

### Layer 1 — Managed PITR (Fleet-Level Safety Net)

**What:** Azure Flexible Server provides automatic daily backups with continuous WAL archiving under the hood. PITR is available for the configured retention window (default 7 days, configurable up to 35 days).

**RPO:** ~5 minutes (Azure guarantees WAL flush interval).  
**RTO:** 15–30 minutes (Azure provisions a new server instance from the backup).  
**Cost:** Included in Flexible Server pricing — backup storage ≤ 1× server storage is free.

**Limitation:** PITR restores the *entire server* to a point in time. You cannot restore a single tenant database without restoring the whole server instance, then extracting that tenant's data. This is the fleet-level safety net, not the surgical tool.

### Layer 2 — Scheduled `pg_dump` Per Tenant (Surgical Restore)

**What:** A CronJob (Kubernetes) runs `pg_dump --format=custom` against each tenant database on a fixed schedule, uploading the result to Azure Blob Storage with lifecycle management.

**Schedule:** Every 6 hours (Phase 1). Adjustable per tier later.  
**RPO:** ≤ 6 hours for logical restore. Tighter RPO uses Layer 1.  
**RTO (single tenant):** 5–15 minutes depending on database size. Restore is `pg_restore` into a fresh database, then update the control-plane registry to point the tenant at the new database.  
**Retention:** 7 days of dumps (28 snapshots per tenant). Blob lifecycle policy auto-expires older dumps.  
**Cost:** Blob Storage (cool tier) — negligible at Phase 1 scale. A D&D campaign database is unlikely to exceed 100 MB. 100 tenants × 100 MB × 28 snapshots ≈ 280 GB cool blob ≈ ~$3/month.

**Why `pg_dump` over volume snapshots:**
- Works with managed Postgres (no PVC to snapshot).
- Produces a portable, version-independent artifact.
- Single-tenant granularity without server-level restore.
- Simple to test: dump, drop, restore, verify.
- No CSI driver dependency or cloud-specific snapshot API.

---

## Single-Tenant Restore Workflow

This is the operational playbook for restoring one tenant without touching anyone else.

### Scenario: Tenant `acme-guild` requests data restore to yesterday's state.

1. **Operator identifies the dump.** List blobs: `az storage blob list --container-name tenant-backups --prefix acme-guild/ --query "[].name"`. Pick the desired timestamp.

2. **Download the dump.** `az storage blob download --container-name tenant-backups --name acme-guild/2026-04-17T12-00.dump -f restore.dump`

3. **Create a fresh database.** `CREATE DATABASE acme_guild_restore OWNER acme_guild;`

4. **Restore into the fresh database.** `pg_restore --dbname=acme_guild_restore --no-owner --role=acme_guild restore.dump`

5. **Validate.** Run a quick sanity check — row counts on campaigns, notes, users tables. Compare against the backup catalog metadata (row counts captured at dump time).

6. **Swap.** Update the control-plane tenant registry: set `acme-guild.database_name = acme_guild_restore`. The next API request from that tenant hits the restored database. Old database is retained for 48 hours, then dropped.

7. **Notify.** Tenant sees a brief connection blip (seconds). No other tenant is affected. No pod restart required — the app reads the database name from the control-plane registry on each connection (or on a short TTL cache).

### Blast radius: Zero cross-tenant impact.

The key design property: tenant database names are indirected through the control-plane registry, not hardcoded. Restore swaps the pointer, not the server.

---

## What to Automate Early (Phase 1) vs. Later

### Phase 1 — Build Now

| Component | Description | Effort |
|---|---|---|
| **Backup CronJob** | K8s CronJob running `pg_dump` per tenant → Blob. Uses a service account with `pg_dump` access. Iterates tenant list from control-plane registry. | 1–2 days |
| **Blob lifecycle policy** | Azure Storage lifecycle rule: delete blobs older than 7 days in `tenant-backups` container. | 30 min |
| **Backup catalog table** | Control-plane DB table: `backup_catalog(tenant_id, timestamp, blob_path, size_bytes, row_counts_json, status)`. Written by the CronJob after each successful dump. | 1 hour |
| **Manual restore runbook** | Markdown doc with the 7-step procedure above. Operator runs it by hand. | 1 hour |
| **Backup health check** | Control-plane `/internal/status` includes `last_backup_age` per tenant. Alert if any tenant backup is older than 12 hours. | 1 hour |

### Phase 2 — Build When Needed

| Component | Description |
|---|---|
| **Automated restore API** | `POST /internal/tenants/{id}/restore?timestamp=...` — automates steps 1–6 above. |
| **Backup verification CronJob** | Weekly: pick a random tenant, restore to a scratch database, run sanity checks, drop it. Trust-but-verify. |
| **Per-tier backup frequency** | Premium tenants get hourly dumps; free tier stays at 6-hour. CronJob reads tier from registry. |
| **Cross-region backup replication** | Azure Blob geo-replication or explicit copy to a secondary region for DR. |

### Phase 3+ — Don't Touch Yet

| Component | Reason to defer |
|---|---|
| **pgBackRest / Barman** | Overkill until we have 100+ tenants or need sub-minute RPO. Managed PITR already covers fleet-level sub-5-minute RPO. |
| **Streaming replication / read replicas** | No read-heavy workload justification at this scale. |
| **Custom WAL archiving** | Azure Flexible Server handles this internally. Don't duplicate it. |

---

## RPO / RTO Summary

| Scenario | RPO | RTO | Method |
|---|---|---|---|
| Full server loss (catastrophic) | ~5 min | 15–30 min | Azure Managed PITR → new server |
| Single tenant restore (operator-initiated) | ≤ 6 hours | 5–15 min | `pg_dump` from Blob → `pg_restore` to fresh DB |
| Single tenant restore (tighter RPO needed) | ~5 min | 30–60 min | Azure PITR → temp server → extract tenant → `pg_restore` to prod |

**Phase 1 commitment:** 6-hour RPO / 15-minute RTO for routine single-tenant restores. Sub-5-minute RPO available via managed PITR but with higher RTO and manual extraction.

---

## Cost / Complexity Trade-Offs

| Choice | Pro | Con |
|---|---|---|
| **Managed PITR only** (no `pg_dump`) | Zero custom infra. Cheapest. | Can't restore a single tenant without restoring the whole server. Useless for "undo this tenant's last 2 hours." |
| **`pg_dump` only** (no managed PITR) | Full tenant-level granularity. Portable. | 6-hour RPO gap. No sub-minute recovery for catastrophic failure. |
| **Both layers (recommended)** | Fleet safety net + surgical tenant restore. | Two things to monitor instead of one. Marginal complexity. |
| **pgBackRest + WAL archiving** | Sub-minute RPO, incremental backups, parallel restore. | Significant operational overhead. Needs dedicated storage, config, monitoring. Wrong scale for Phase 1. |
| **Volume snapshots (CSI)** | Cloud-native, fast for large DBs. | Tied to managed Postgres internals (not applicable with Flexible Server). Only useful if we self-host Postgres on PVCs, which we shouldn't in Phase 1. |

**Recommendation:** The two-layer approach (managed PITR + scheduled `pg_dump`) hits the sweet spot — minimal custom infra, good RPO/RTO, single-tenant surgical restore, and a clear upgrade path.

---

## Assumptions

1. **One Postgres Flexible Server instance per environment** (not per tenant). Tenants are isolated by database within the server, not by separate server instances. This is the cost-efficient Phase 1 model.
2. **Control-plane registry owns the tenant → database mapping.** This indirection is what makes pointer-swap restore work.
3. **`pg_dump` runs from inside the cluster** (CronJob pod with network access to the Postgres server). No external backup agent.
4. **Blob Storage is in the same Azure region** as the AKS cluster. Cross-region comes in Phase 2.

---

## Open Questions for Team

1. **Tenant database isolation model:** One database per tenant on a shared Flexible Server? Or schemas within a single database? (Recommendation: separate databases — cleaner isolation, simpler `pg_dump`, no schema-prefix gymnastics.)
2. **Backup encryption:** Azure Blob supports encryption at rest by default. Do we need client-side encryption before upload? (Recommendation: no, for Phase 1. Server-side encryption is sufficient.)
3. **Who triggers restore?** Phase 1: platform operator only. Phase 2: tenant admin self-service?

---

*This recommendation fits the locked direction: AKS + Postgres per-tenant + Blob object storage. It avoids over-engineering while keeping the upgrade path to tighter RPO and automated restore clean.*
