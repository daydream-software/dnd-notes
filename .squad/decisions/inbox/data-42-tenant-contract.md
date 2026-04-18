# Issue #42 — Control-Plane ↔ Tenant Contract (Phase 1)

**Author:** Data (Backend Dev)
**Date:** 2026-04-18
**Status:** Recommendation — pending team review
**Context:** Clarification item from #42 epic: "Specify the control-plane ↔ tenant contract, including internal APIs and required state transitions."

---

## Locked assumptions (not re-litigated)

- Thin control plane, not a custom operator.
- One Postgres database per tenant, single managed server.
- Control plane DB starts simple (SQLite for low write volume).
- Opaque wildcard subdomain per tenant, same-origin web + API.
- Backup/restore posture locked (two-layer: managed PITR + daily `pg_dump`).
- Rolling updates are stateless container restarts.
- Phase 1 is internal users only — no customer-facing SLA.

---

## 1. Minimum internal API surface

The control plane needs exactly two things from a tenant app: **a health probe** and a **metadata endpoint**. Everything else is push-from-control-plane or infrastructure-level. The tenant app is not a collaborator — it is a workload that answers when asked.

### Tenant-side endpoints (exposed by the tenant app)

These are internal-only. They MUST NOT be routable from the public internet. Enforce via network policy or ingress rules (e.g., restrict to cluster-internal traffic on a separate port or path prefix).

#### `GET /_control/health`

Returns tenant readiness for traffic.

```json
// 200 OK — ready to serve
{
  "status": "ok",
  "schemaVersion": "2026.04.001",
  "startedAt": "2026-04-18T15:00:00Z"
}

// 503 Service Unavailable — not ready (starting up, draining, restoring)
{
  "status": "unavailable",
  "reason": "migrating"
}
```

**Contract:**
- Returns `200` only when the app has completed database migrations and is ready to accept user requests.
- Returns `503` during startup, migration, drain, or maintenance.
- Response MUST include `schemaVersion` when status is `ok`.
- Kubernetes liveness and readiness probes point here.
- No authentication required (cluster-internal only).

#### `GET /_control/info`

Returns tenant runtime truth.

```json
{
  "tenantId": "t_abc123",
  "appVersion": "1.4.0",
  "schemaVersion": "2026.04.001",
  "databaseName": "tenant_t_abc123",
  "maintenanceMode": false,
  "stats": {
    "campaigns": 12,
    "notes": 347,
    "accounts": 5
  }
}
```

**Contract:**
- Returns current runtime state, not cached or stale.
- `appVersion` is the deployed container image version.
- `schemaVersion` is the Postgres schema version the app is running against.
- `stats` is optional and best-effort (may be omitted under load). Control plane uses it for fleet dashboards, not for decisions.
- No authentication required (cluster-internal only).

#### `POST /_control/maintenance`

Signals the tenant app to enter or leave maintenance mode.

```json
// Request
{ "enabled": true, "reason": "backup" }

// Response 200 OK
{ "maintenanceMode": true, "drainedAt": "2026-04-18T15:30:00Z" }

// Request
{ "enabled": false }

// Response 200 OK
{ "maintenanceMode": false }
```

**Contract:**
- When `enabled: true`, the app must:
  1. Stop accepting new write requests (return `503` with `Retry-After` header to user-facing routes).
  2. Drain in-flight requests (wait up to 30s, then force-close).
  3. Respond `200` only after drain is complete.
- When `enabled: false`, the app resumes normal operation.
- Idempotent: calling `enabled: true` twice is fine; second call returns immediately.
- No authentication beyond cluster-internal network restriction.

**That's it.** Three endpoints. The tenant app does not phone home, does not push state, does not register itself. The control plane drives everything.

---

## 2. Push vs. pull model

The control plane is the single source of intent. The tenant app is the single source of runtime truth.

| Operation | Direction | Mechanism | Rationale |
|-----------|-----------|-----------|-----------|
| **Provisioning** | Control plane → K8s API | Control plane creates Deployment, Service, Ingress, DB | Tenant app doesn't exist yet; nothing to pull from |
| **Health check** | Control plane → tenant | `GET /_control/health` (poll) | Control plane decides polling frequency; tenant is passive |
| **Version reporting** | Control plane → tenant | `GET /_control/info` (poll) | Control plane asks after deploy; tenant reports what it is |
| **Maintenance mode** | Control plane → tenant | `POST /_control/maintenance` (push) | Control plane owns the orchestration sequence |
| **Backup trigger** | Control plane → Postgres | `pg_dump` via control plane job (no tenant involvement) | Logical backups run against the DB directly; tenant app stays out of the data path |
| **Restore** | Control plane → tenant + Postgres | Maintenance on → pg_restore → maintenance off | Tenant app cooperates by draining; control plane drives the sequence |
| **Rolling update** | Control plane → K8s API | Deployment spec change triggers rollout | Standard K8s rolling update; tenant app just needs clean shutdown |
| **Deprovisioning** | Control plane → K8s API + Postgres | Delete K8s resources, archive DB | Tenant app is stopped; no cooperation needed |
| **Fleet dashboard** | Control plane → tenant | `GET /_control/info` (poll) | Control plane aggregates; tenant answers |

**No pull/report from tenant to control plane.** The tenant app has zero outbound dependencies on the control plane. It doesn't know the control plane exists. It doesn't heartbeat. It doesn't register. It answers questions when asked.

**Why this matters:** If the control plane goes down, tenant apps keep serving users. The blast radius of a control plane failure is "no provisioning, no backups, no fleet visibility" — not "all tenants are down."

---

## 3. Metadata ownership

### Control plane owns (source of truth)

| Data | Lives in | Purpose |
|------|----------|---------|
| Tenant registry (id, slug, owner, created, desired state) | Control plane DB | Fleet inventory |
| Desired lifecycle state (`provisioning`, `ready`, `suspended`, etc.) | Control plane DB | Intent tracking |
| Subdomain assignment | Control plane DB | Routing |
| Database name/connection reference | Control plane DB | Provisioning wiring |
| Backup catalog (schedule, status, storage URI, retention) | Control plane DB | Backup policy |
| Restore log (who, when, result) | Control plane DB | Audit trail |
| Target app version (which image tag this tenant should run) | Control plane DB | Rollout control |
| Subscription/billing state (if/when added) | Control plane DB | Business logic |

### Tenant app owns (runtime truth)

| Data | Lives in | Purpose |
|------|----------|---------|
| Campaign, note, membership, share-link data | Tenant Postgres DB | Product domain |
| Current schema version | Tenant app memory + DB | Migration state |
| Current app version | Tenant app (container image label) | Deployment verification |
| Maintenance mode flag | Tenant app memory | Drain coordination |
| Session/auth state | Tenant app | User-facing behavior |
| Per-tenant admin overview (stats) | Tenant app | Dashboards (optional) |

### Neither side caches the other's truth

- The control plane does not store "current schema version" — it asks via `/_control/info`.
- The tenant app does not store "desired state" — it doesn't know what the control plane wants.
- If the control plane wants to know tenant health, it asks. If the answer is stale, the control plane polls again.

---

## 4. Failure model and idempotency

### Provisioning

**Happy path:**
1. Control plane writes tenant row: state = `provisioning`.
2. Control plane creates Postgres database (`CREATE DATABASE tenant_{id}`).
3. Control plane creates K8s Deployment, Service, IngressRule.
4. Control plane polls `/_control/health` until `200`.
5. Control plane writes tenant row: state = `ready`.

**Failure modes:**

| Failure | Detection | Recovery | Idempotency |
|---------|-----------|----------|-------------|
| DB creation fails | `CREATE DATABASE` error | Retry. `CREATE DATABASE` is not idempotent — check `IF NOT EXISTS` or catch "already exists." | Check-before-create or catch duplicate. |
| K8s resource creation fails | K8s API error | Retry. Use `apply` semantics (create-or-update). K8s resources are declarative and naturally idempotent. | `kubectl apply` / server-side apply. |
| App never becomes healthy | Health poll timeout (e.g., 5 min) | Mark tenant state = `failed`. Control plane deletes K8s resources. DB retained for inspection. Manual intervention or retry from step 1. | Full retry is safe — step 2 is idempotent, step 3 uses apply. |
| Control plane crashes mid-provision | On restart, scan for tenants in `provisioning` state | Resume from step 2 — each step is idempotent. | Recovery scan is the idempotency mechanism. |

**Key rule:** Provisioning steps are ordered and each must be idempotent. If any step fails, the tenant stays in `provisioning` and the control plane retries on the next reconciliation loop. A stuck `provisioning` state for >N minutes raises an alert.

### Health checking

**Contract:**
- Control plane polls `/_control/health` on a fixed interval (e.g., 30s).
- Three consecutive `503` or timeout responses → mark tenant `degraded` in the control plane.
- If the tenant is `degraded` for >5 min → raise alert (log, webhook, whatever Phase 1 monitoring is).
- Tenant recovery to `200` → clear `degraded` flag.

**Idempotency:** Health checks are reads. No side effects. Always safe to retry.

**Failure isolation:** A tenant health poll failure MUST NOT block or delay health polling of other tenants. Use independent poll goroutines/timers per tenant, not a sequential loop.

### Version reporting

**Contract:**
- After a rolling update, the control plane polls `/_control/info` to confirm the new version.
- If `appVersion` in the response doesn't match the expected version within a timeout (e.g., 10 min), mark rollout `stalled`.
- A stalled rollout does not auto-rollback in Phase 1. It raises an alert for manual investigation.

**Idempotency:** Version checks are reads. Always safe.

### Maintenance mode

**Contract:**
- `POST /_control/maintenance` with `{ "enabled": true }` is idempotent. Calling it twice returns success both times.
- The control plane waits for the `200` response before proceeding (e.g., before starting `pg_restore`).
- If the maintenance request times out (e.g., 60s), the control plane retries up to 3 times.
- If the tenant never acknowledges maintenance after retries, the operation is aborted and the restore/upgrade is not attempted. The tenant stays in its current state.
- `POST /_control/maintenance` with `{ "enabled": false }` is also idempotent. Safe to call even if the tenant is not in maintenance.

**Why the tenant must cooperate:** `pg_restore` against a database with active connections will cause transaction aborts and partial reads. Maintenance mode drains connections first. This is the one place the control plane depends on tenant cooperation — and it has a timeout + abort if the tenant misbehaves.

### Backup

**Contract:**
- Backups are control-plane-only operations. The tenant app is not involved.
- `pg_dump` runs as a control plane job against the tenant database directly.
- No maintenance mode required for logical backup — `pg_dump` takes a consistent snapshot without blocking writes (Postgres MVCC).
- Backup status is tracked in the backup catalog. Failed backups are retried on the next schedule.
- A failed backup after N retries raises an alert.

**Idempotency:** Running `pg_dump` twice produces two independent backup files. Both are valid. No conflict.

### Restore

**Happy path:**
1. Control plane writes restore log: state = `pending`.
2. Control plane triggers pre-restore safety backup (`pg_dump` → blob).
3. Control plane sends `POST /_control/maintenance { "enabled": true }` to tenant.
4. Control plane waits for tenant drain confirmation (`200` response).
5. Control plane terminates remaining DB connections (`pg_terminate_backend`).
6. Control plane runs `pg_restore` into the tenant database.
7. Control plane verifies restore (schema version, row probe).
8. Control plane sends `POST /_control/maintenance { "enabled": false }`.
9. Control plane polls `/_control/health` until `200`.
10. Control plane writes restore log: state = `completed`.

**Failure modes:**

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Pre-restore backup fails | `pg_dump` error | Abort restore. Do not proceed without safety net. |
| Tenant won't enter maintenance | Timeout after retries | Abort restore. Tenant stays running. Log the failure. |
| `pg_restore` fails | Exit code / error output | Restore from pre-restore safety backup (repeat steps 5–7 with safety backup). Mark restore `failed`. |
| Schema version mismatch after restore | `/_control/info` shows old schema | Run forward-migrations. If migrations fail, restore from safety backup. |
| Tenant won't come back after maintenance off | Health poll timeout | Mark tenant `failed`. Safety backup is available. Manual intervention. |

**Idempotency:** Restore is NOT idempotent — it replaces database contents. The pre-restore safety backup is the idempotency escape hatch. If a restore fails, you can restore the safety backup to return to the previous state.

---

## 5. What this contract deliberately excludes (keep it boring)

- **No tenant → control plane callbacks.** The tenant app never phones home. This eliminates circular dependencies, retry storms, and authentication between services.
- **No event bus or message queue.** The control plane polls and pushes. Polling is boring and debuggable. Message queues are neither.
- **No webhook registration.** The control plane knows where every tenant lives. It doesn't need to be told.
- **No tenant-side configuration API.** The control plane configures tenants via environment variables and Kubernetes resource specs, not via an API call to the running app.
- **No shared state.** The control plane and tenant app share nothing in memory, on disk, or in a cache. The database connection string is the only coupling.
- **No auto-rollback.** Phase 1 rollouts do not automatically roll back on failure. They stall and alert. Automatic rollback is a Phase 3+ concern that requires deployment confidence we don't have yet.
- **No tenant self-registration.** Tenants are provisioned by the control plane. There is no "tenant app registers itself" flow.

---

## 6. Evolution path

This contract is designed to grow without breaking:

| Future need | How it fits |
|-------------|-------------|
| More /_control endpoints (e.g., cache flush, config reload) | Add to the /_control prefix. Same pattern. |
| Tenant → control plane heartbeat (if polling doesn't scale) | Add a `POST /_control/heartbeat` push from tenant to a control plane ingestion endpoint. But don't add it until polling is proven insufficient at >100 tenants. |
| Webhook events (tenant alerts control plane of errors) | Same pattern as heartbeat. Defer until the polling model breaks. |
| Per-tenant feature flags | Deliver via environment variables or a `/_control/config` endpoint. Not via shared database. |
| Customer-facing restore portal | Portal calls control plane API → control plane runs the same restore sequence above. No new tenant-side surface. |
| Hourly or continuous backups | Change the control plane backup schedule. No tenant-side changes. |

---

## 7. Implementation notes for #53 and #54

- The `/_control/*` endpoints should be registered in the tenant app behind a separate Express router with cluster-internal-only middleware (reject requests that don't come from the control plane's pod network or a known service account).
- `schemaVersion` should be a monotonic string derived from the latest migration filename or a version table in the tenant database. Do not use the app version — schema and app versions may diverge.
- Maintenance mode is an in-memory flag in the tenant app, not a database column. When the process restarts, maintenance mode is off by default — the control plane will re-assert it if needed.
- Health checks should verify database connectivity (a simple `SELECT 1` against the tenant DB) in addition to app readiness. A tenant that is running but can't reach its database is not healthy.

---

## Summary for the team

Three internal endpoints on the tenant app: health, info, maintenance. Everything else is driven by the control plane via the Kubernetes API and direct Postgres access. The tenant app doesn't know the control plane exists. Provisioning steps are idempotent and resumable. Restore is the one operation that requires tenant cooperation (maintenance mode drain), and it has a timeout-and-abort safety model with pre-restore backups as the escape hatch. No event bus, no callbacks, no shared state.

Nothing clever. The tenant app answers when spoken to and otherwise minds its own business.
