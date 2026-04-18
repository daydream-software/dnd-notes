# Issue #42 — Tenant Postgres Backup / Restore Strategy (Phase 1)

**Author:** Data (Backend Dev)  
**Date:** 2026-04-18  
**Status:** Recommendation — pending team review  
**Context:** Clarification item from #42 epic: "Design the backup / restore strategy for tenant Postgres databases (continuous replication, point-in-time recovery, RPO/RTO targets)."

---

## Locked assumptions

These are already decided and not re-litigated here:

- One Postgres **database** per tenant (not one server per tenant).
- Live database state on managed block storage (e.g. AKS Managed Disks).
- Backup artifacts to Blob / object storage.
- AKS / managed Kubernetes is the target.
- Phase 0–1 uses Kubernetes Secrets for credentials.
- Control plane is a thin app-level service, not a custom operator.

---

## Phase 1 posture: boring and predictable

### Server topology

Use a **single managed Postgres instance** (Azure Flexible Server or equivalent) with one logical database per tenant. This is the cheapest starting shape. Tenant isolation is at the database level, not the server level. Move to per-tenant server instances only if a paying customer requires network-level isolation or dedicated resources.

### Two backup layers

| Layer | Mechanism | Scope | RPO | Purpose |
|-------|-----------|-------|-----|---------|
| **Managed continuous backup** | Provider-managed WAL archiving + daily base snapshots (built into Azure Flexible Server) | Entire Postgres server (all tenants) | ~5 min (WAL) | Disaster recovery — fleet-wide failures, storage corruption, accidental DROP DATABASE |
| **Per-tenant logical backup** | Scheduled `pg_dump --format=custom` per tenant database, uploaded to Blob storage | Single tenant database | ≤ 24 h (daily schedule) | Routine single-tenant restore, tenant offboarding export, migration safety net |

### Why both layers

Managed PITR is free with the server — it costs nothing to keep it on. But PITR restores the **entire server** to a single point in time. You cannot use PITR to roll back one tenant while leaving others untouched. Per-tenant logical backups fill that gap.

---

## Restore unit

**The primary restore unit is a single tenant database.**

Routine restore scenarios (customer requests rollback, data corruption in one tenant, failed migration on one tenant) all target a single database. Fleet-wide PITR is the escalation path, not the default.

### Restore procedure (single tenant)

1. Control plane sets tenant lifecycle state to `restoring` (read-only / connection-draining).
2. Control plane creates a **pre-restore safety backup** of the current tenant database (`pg_dump` → Blob).
3. Control plane terminates active connections to the target database (`pg_terminate_backend`).
4. Control plane runs `pg_restore` from the selected logical backup into the target database.
5. Control plane verifies restore integrity (row counts, schema version, basic read probes).
6. Control plane transitions tenant back to `ready`.
7. Restore event is logged in the backup catalog with full audit trail.

### Restore procedure (fleet — disaster recovery only)

1. Use managed Postgres PITR to restore entire server to a point in time (new server instance).
2. Validate all tenant databases on the restored server.
3. Swap DNS / connection strings from old server to new server.
4. Old server retained for investigation, then decommissioned.

This should be drilled at least once before accepting any paying customers.

---

## RPO / RTO targets (Phase 1)

| Scenario | RPO | RTO | Notes |
|----------|-----|-----|-------|
| Single tenant restore (from logical backup) | ≤ 24 hours | ≤ 30 minutes | Bounded by daily `pg_dump` schedule. Restore is `pg_restore` into an existing database — fast for small DBs. |
| Fleet disaster recovery (managed PITR) | ~5 minutes | ≤ 2 hours | Bounded by Azure Flexible Server restore time (provision new server + replay WAL). Includes DNS cutover. |
| Accidental tenant deletion | ≤ 24 hours | ≤ 1 hour | Requires logical backup exists. Control plane must refuse hard-delete without retention window. |

**These are internal engineering targets, not SLA promises.** Phase 1 has no paying customers. Revisit targets when defining a customer-facing SLA. At that point, bump logical backup frequency to hourly or implement WAL-level per-database archiving if the 24-hour RPO is too wide.

---

## PITR on day one?

**Yes, but only because managed Postgres gives it for free.** Do not build custom WAL archiving. Do not build custom continuous replication. Turn on the managed service's built-in backup and retention policy (7–35 day window, default 7 is fine for Phase 1).

PITR is the "oh shit" button for fleet-wide incidents. It is not the routine restore mechanism. Routine restores use logical backups.

---

## What the control plane must track

### Backup catalog table

```
tenant_id           TEXT NOT NULL
backup_id           TEXT PRIMARY KEY
backup_type         TEXT NOT NULL  -- 'logical' | 'pitr_snapshot'
initiated_by        TEXT NOT NULL  -- 'scheduled' | 'pre_restore' | 'manual' | 'pre_upgrade'
started_at          TIMESTAMP NOT NULL
completed_at        TIMESTAMP
status              TEXT NOT NULL  -- 'in_progress' | 'completed' | 'failed' | 'verified'
storage_uri         TEXT           -- blob storage path for logical backups
size_bytes          BIGINT
schema_version      TEXT           -- tenant app schema version at time of backup
retention_expires   TIMESTAMP NOT NULL
verified_at         TIMESTAMP      -- last successful test-restore
error_detail        TEXT
```

### Restore log table

```
restore_id          TEXT PRIMARY KEY
tenant_id           TEXT NOT NULL
restore_type        TEXT NOT NULL  -- 'logical' | 'pitr'
source_backup_id    TEXT           -- FK to backup catalog (null for PITR)
pre_restore_backup  TEXT           -- FK to safety backup taken before restore
requested_by        TEXT NOT NULL  -- admin user or system process
requested_at        TIMESTAMP NOT NULL
started_at          TIMESTAMP
completed_at        TIMESTAMP
status              TEXT NOT NULL  -- 'pending' | 'draining' | 'restoring' | 'verifying' | 'completed' | 'failed' | 'rolled_back'
error_detail        TEXT
```

### Tenant lifecycle integration

The tenant state machine must include a `restoring` state:
- Entry: control plane initiates restore → tenant transitions `ready` → `restoring`.
- During `restoring`: tenant app returns 503 to all requests. Connections are drained. No writes allowed.
- Exit on success: `restoring` → `ready`.
- Exit on failure: `restoring` → `failed` (with pre-restore backup available for manual recovery).

---

## Risks and preconditions

1. **Shared server PITR is all-or-nothing.** You cannot restore one tenant via PITR without restoring all of them. The workaround (PITR to temp server → dump one DB → restore into prod) is clunky. Logical backups are the real single-tenant safety net.

2. **Logical backup frequency sets the single-tenant RPO floor.** Daily is fine for Phase 1 (free tier, internal users). For paid customers, evaluate hourly or continuous logical backups, or move to per-tenant Postgres instances with independent PITR.

3. **Pre-restore safety backup is mandatory.** Never restore without first snapshotting the current state. If the restore itself is wrong (wrong backup, wrong tenant, corrupted dump), you need the ability to undo the undo.

4. **Connection draining before restore.** `pg_restore` into a live database with active connections is a recipe for partial reads and transaction aborts. The control plane must terminate and block connections before restoring.

5. **Schema version mismatch.** A backup from app version N restored into a database that has been migrated to N+1 will break. The control plane must compare `schema_version` in the backup catalog against the current tenant schema version and refuse incompatible restores (or run forward-migrations after restore).

6. **Backup verification must be automated.** A backup you haven't tested restoring is a hypothesis, not a backup. Phase 1 should include a weekly test-restore job: pick a tenant, restore to a scratch database, run schema validation, delete the scratch DB. Record the result in `verified_at`.

7. **Blob storage access and encryption.** Backup artifacts in Blob storage must be encrypted at rest (Azure default), access-controlled (control-plane identity only), and tenant-isolated by storage path prefix. Do not store multiple tenants' backups in a flat namespace.

---

## What this recommendation does NOT cover

- **Billing integration** with backup storage costs (Phase 3+).
- **Cross-region replication** or geo-redundant backups (Phase 3+, if multi-region).
- **Customer-initiated restore** via a self-service portal (Phase 3+).
- **Streaming replication / read replicas** for tenant databases (not needed until scale demands it).
- **Backup for the control-plane database itself** (separate concern — track in #53).

---

## Summary for the team

Phase 1 backup/restore is two layers: managed Postgres continuous backup for fleet-wide disaster recovery (free, always on, ~5 min RPO), plus daily per-tenant `pg_dump` to Blob storage for routine single-tenant restore (≤24h RPO, ≤30 min RTO). PITR on day one is free — take it. The control plane tracks a backup catalog and restore log with full audit trail. The tenant lifecycle state machine must include a `restoring` state with connection draining and mandatory pre-restore safety snapshots. Backup verification runs weekly from Phase 1 launch.

Nothing fancy. Nothing clever. Exactly boring enough to trust.
