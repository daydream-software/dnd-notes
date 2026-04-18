# Issue #42 — Control-Plane ↔ Tenant Contract (Platform Recommendation)

**Author:** Brand (Platform Dev)
**Date:** 2026-04-18
**Scope:** Minimum signals, coupling boundaries, and orchestration model for the thin control plane to operate tenant workloads safely on managed Kubernetes.
**Status:** Recommendation — needs Mikey + Data review before lock.

---

## Guiding principle

**Kubernetes is the orchestration layer; the control plane is a registry with opinions.**

The control plane writes Kubernetes resources and reads their status. Tenant pods expose a small `/internal/*` surface for app-level concerns that K8s can't observe natively. Everything else flows through standard K8s primitives (labels, annotations, readiness probes, pod phases). No custom operator, no sidecar, no CRD.

---

## 1. Minimum signals the platform needs from tenant workloads

The platform must be able to answer five questions per tenant without `kubectl exec` or log scraping:

| # | Question | Signal source | Implementation |
|---|----------|---------------|----------------|
| 1 | **Is this tenant alive?** | K8s liveness probe | `GET /healthz` — returns 200 if the process can serve requests. Fail → K8s restarts the pod. |
| 2 | **Is this tenant ready for traffic?** | K8s readiness probe | `GET /readyz` — returns 200 when the app has a working Postgres connection and has run startup migrations. Fail → K8s removes the pod from the Service (and therefore from ingress). |
| 3 | **What version is running?** | Pod annotation + `/internal/status` | Deployment sets annotation `dnd-notes.app/version: <image-tag>`. `/internal/status` confirms the running code version and last-applied migration version. Control plane compares desired vs actual. |
| 4 | **Is this tenant in maintenance mode?** | `/internal/status` field `"mode": "maintenance" \| "serving"` | Control plane checks before routing traffic or declaring upgrade complete. |
| 5 | **When was the last successful backup?** | Control-plane backup catalog (not the tenant) | The control plane owns `pg_dump` scheduling via CronJob. Tenant pod is not involved in backup execution — Postgres backups run against the database directly, not through the app. |

### What the tenant does NOT report

- **Disk usage, CPU, memory** — collected by node-level metrics (kubelet, Prometheus node exporter). Not the app's job.
- **Backup freshness** — the control plane's CronJob + backup catalog own this. Tenant app doesn't know or care.
- **Fleet position** — the control plane knows the fleet; the tenant knows itself.

---

## 2. How the control plane triggers work

### Rule: Kubernetes state first, direct app calls only for app-level state

| Operation | Mechanism | Rationale |
|-----------|-----------|-----------|
| **Provision tenant** | Control plane creates Namespace, Deployment, Service, Ingress, ConfigMap, Secrets via `kubectl apply`. Waits for readiness probe to pass. Then calls `POST /internal/bootstrap` once. | K8s handles scheduling, image pull, restart. Bootstrap is a one-time app-level init (seed admin, record tenant ID). |
| **Scale to zero / resume** | Control plane patches `replicas: 0` or `replicas: 1`. | Pure K8s. No app call needed. PVC persists. Postgres connection drops cleanly on SIGTERM. |
| **Rolling update** | Control plane patches Deployment image tag with `maxSurge: 0, maxUnavailable: 1` (recreate strategy for single-replica). Waits for new pod readiness. | Single replica per tenant means recreate, not rolling. K8s handles the pod lifecycle. App handles graceful shutdown (drain connections on SIGTERM, run migrations on startup). |
| **Enter maintenance mode** | Control plane calls `POST /internal/maintenance {"mode": "maintenance"}`. Confirms via `GET /internal/status`. | App-level concern — the app rejects writes, returns 503 to users, keeps readiness passing (so the pod isn't killed). |
| **Exit maintenance mode** | Control plane calls `POST /internal/maintenance {"mode": "serving"}`. | Inverse of above. |
| **Trigger backup** | CronJob runs `pg_dump` against the tenant's Postgres database directly. No app call. | Postgres logical backups don't need app cooperation. The backup tool connects to the database, not the app. |
| **Restore** | Control plane enters maintenance mode → drains connections → runs `pg_restore` against the database → verifies → exits maintenance mode. | App is alive but read-only during restore. No pod restart needed for pointer-swap (Postgres connection string doesn't change; the database contents do). |
| **Deprovision** | Control plane deletes the Namespace (cascades Deployment, Service, Ingress, ConfigMap, Secrets). Database cleanup is a separate retention-policy job. | K8s cascading delete is the safest cleanup. Database data outlives the workload for retention compliance. |

### Where NOT to couple

1. **Control plane must never import tenant app code.** The contract is HTTP + K8s resources. If the control plane needs a new signal, it's a new `/internal/*` endpoint or a new label/annotation — never a shared library.
2. **Tenant app must never call the control plane.** Information flows one direction: control plane → tenant. If the tenant needs config, it reads environment variables or ConfigMap mounts injected at deploy time. No runtime callbacks, no webhooks from tenant to control plane.
3. **Control plane must not manage Postgres schema.** The tenant app owns its own migrations (runs them on startup). The control plane knows the *expected* migration version (from the image manifest or a version map) and can compare it against what `/internal/status` reports, but never runs DDL.
4. **No shared state outside Kubernetes and Postgres.** No Redis, no message queue, no shared filesystem. Control plane state lives in its own database. Tenant state lives in the tenant's Postgres database. Kubernetes resource state is the coordination layer.

---

## 3. Contract details by concern

### 3a. Ingress assignment

**Owner:** Control plane.

- Control plane creates an `Ingress` resource per tenant in the tenant's namespace.
- Ingress uses the shared `ingress-nginx` IngressClass.
- Hostname: `{opaque-slug}.{domain}` (e.g., `a8f3k2.dnd-notes.app`).
- TLS: cert-manager annotation `cert-manager.io/cluster-issuer` on the Ingress triggers wildcard cert. One wildcard cert covers `*.dnd-notes.app`.
- **No DNS record per tenant.** Wildcard DNS (`*.dnd-notes.app → ingress LB IP`) means all subdomains resolve. Tenant identity is determined by hostname matching in the Ingress resource.
- The tenant app does NOT configure its own ingress, hostname, or TLS. It receives `PUBLIC_WEB_URL` via ConfigMap/env and trusts it.

### 3b. Version reporting

**Owner:** Shared (control plane sets desired; tenant reports actual).

- Deployment annotation: `dnd-notes.app/desired-version: <tag>`
- Pod annotation (set by Deployment template): `dnd-notes.app/version: <tag>`
- `/internal/status` response includes:
  ```json
  {
    "version": "1.2.3",
    "migrationVersion": "20260418001",
    "mode": "serving",
    "startedAt": "2026-04-18T12:00:00Z",
    "postgresConnected": true
  }
  ```
- Control plane polls `/internal/status` periodically (or on-demand after operations) and writes the result to the tenant registry. Version drift (desired ≠ actual) is an alert condition.

### 3c. Readiness

**Owner:** Tenant app (implements probe); K8s (enforces it); control plane (waits on it).

- `GET /readyz` returns 200 when:
  - Postgres connection pool is initialized.
  - Startup migrations have completed.
  - App is accepting requests (either serving or maintenance mode — both are "ready" from K8s perspective).
- `GET /readyz` returns 503 when:
  - Postgres is unreachable.
  - Migrations are running.
  - App is in a broken state.
- K8s readiness probe config: `periodSeconds: 5`, `failureThreshold: 3`, `initialDelaySeconds: 10`.
- The control plane never checks `/readyz` directly. It reads pod readiness condition from the K8s API (`kubectl get pod -o jsonpath='{.status.conditions[?(@.type=="Ready")]}'`).

### 3d. Maintenance mode

**Owner:** Control plane (triggers); tenant app (enforces).

- `POST /internal/maintenance` with body `{"mode": "maintenance"}`:
  - App finishes in-flight requests (30s grace period matching K8s `terminationGracePeriodSeconds`).
  - App starts returning 503 with `Retry-After` header to user-facing endpoints.
  - App continues responding to `/internal/*` and health probes.
  - Returns `{"mode": "maintenance", "drainingUntil": "<timestamp>"}`.
- `POST /internal/maintenance` with body `{"mode": "serving"}`:
  - App resumes normal operation.
  - Returns `{"mode": "serving"}`.
- Maintenance mode is NOT a pod restart. The pod stays up. This is important for restore (swap database contents under a running pod) and for pre-upgrade safety snapshots.
- If the pod restarts (crash, node eviction), it comes up in `serving` mode by default. The control plane re-enters maintenance if needed.

### 3e. Restore / drain orchestration

**Owner:** Control plane (orchestrates); tenant app (cooperates via maintenance mode); Postgres (receives the restore).

Restore sequence:

```
1. Control plane sets tenant state → "restoring" in registry
2. POST /internal/maintenance {"mode": "maintenance"}
3. Wait for drain confirmation (poll /internal/status until mode=maintenance)
4. Take pre-restore safety snapshot (pg_dump to blob, tagged "pre-restore")
5. Run pg_restore against tenant database from selected backup
6. POST /internal/maintenance {"mode": "serving"}
7. Poll /internal/status — confirm mode=serving, postgresConnected=true
8. Control plane sets tenant state → "ready" in registry
```

Failure handling:
- Step 5 fails → roll back using the pre-restore snapshot from step 4. Exit maintenance. Alert ops.
- Step 6 fails (app can't reconnect) → restart the pod (`kubectl delete pod`). K8s recreates it. If readiness passes, proceed. If not, leave in maintenance and alert.
- Any step times out → control plane marks tenant state "failed", leaves maintenance mode active, alerts ops. Manual intervention required.

**The tenant app is passive during restore.** It doesn't know a restore is happening. It just knows it's in maintenance mode and then it's not. If Postgres contents change underneath it, the app picks up the new data on the next query (connection pool reconnects are standard Postgres behavior).

### 3f. Bootstrap (one-time)

**Owner:** Control plane (calls); tenant app (executes once).

- `POST /internal/bootstrap` with body:
  ```json
  {
    "tenantId": "uuid",
    "adminSubject": "oidc-subject-id",
    "adminEmail": "admin@example.com"
  }
  ```
- App records tenantId (immutable), seeds initial admin user mapped to the OIDC subject, and returns `{"bootstrapped": true}`.
- Idempotent: calling again after bootstrap returns `{"bootstrapped": true, "alreadyBootstrapped": true}` with 200, not an error.
- If the app is already bootstrapped with a *different* tenantId, return 409 Conflict. This prevents accidental cross-tenant wiring.

---

## 4. Auth on `/internal/*` endpoints

- `/internal/*` routes are **not exposed through Ingress**. The Ingress resource only routes to the app's public paths. Internal endpoints are reachable only via the cluster-internal Service DNS (`<service>.<namespace>.svc.cluster.local`).
- For Phase 1, network-level isolation (K8s NetworkPolicy restricting `/internal/*` source to the control-plane namespace) is sufficient. No token auth on internal endpoints.
- Phase 2+: add a shared internal secret (mounted as a K8s Secret, passed as a bearer token) if the threat model requires it.

---

## 5. What the control plane stores per tenant (registry minimum)

| Field | Source | Updated by |
|-------|--------|------------|
| `tenant_id` | Control plane (generated at provision time) | Immutable |
| `slug` | Control plane (generated, opaque) | Immutable |
| `state` | Control plane (state machine) | Control-plane operations |
| `desired_version` | Control plane (set on rollout) | Rollout job |
| `actual_version` | `/internal/status` poll | Periodic sync |
| `migration_version` | `/internal/status` poll | Periodic sync |
| `namespace` | Control plane (matches K8s namespace) | Immutable |
| `public_url` | Derived from slug + domain | Immutable |
| `created_at` | Control plane | Immutable |
| `last_status_poll` | Control plane | Periodic sync |
| `last_backup_at` | Backup CronJob | After each backup |
| `last_backup_path` | Backup CronJob | After each backup |

---

## 6. Compatibility notes

- **Thin control plane**: This contract requires the control plane to make K8s API calls (create/patch/delete resources) and HTTP calls to `/internal/*`. No operator framework, no reconciliation loop, no watch/informer. A simple Express or Fastify app with `@kubernetes/client-node` is enough.
- **No operator**: All orchestration is imperative (control plane does X, then Y, then Z). No declarative reconciliation. This is simpler but means the control plane must handle partial failures explicitly (see restore failure handling above).
- **Phase 1 scope**: Bootstrap, maintenance mode, status polling, and K8s resource management. That's four `/internal/*` endpoints on the tenant side and standard K8s API calls on the control-plane side.
- **What we defer**: `/internal/reconcile-identity` (Phase 2, Keycloak), automated rollback on failed upgrade (Phase 2+), tenant-to-control-plane callbacks (never, by design).

---

## Summary: the contract in one sentence

The control plane manages tenant lifecycle through Kubernetes resources and four HTTP endpoints (`/internal/status`, `/internal/bootstrap`, `/internal/maintenance`, `/readyz`); the tenant app never calls back; all coordination flows one direction.
