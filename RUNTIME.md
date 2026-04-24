# Runtime Environment Contract

This document defines the environment variables and runtime expectations for the dnd-notes tenant container.

Issue #95 makes per-tenant Postgres the hosted steady-state target. The main
tenant runtime is now Postgres-only; SQLite remains only as the temporary
snapshot interchange format for admin backup/restore flows and helper tooling
during the cutover.

## Required Environment Variables

- **`DATABASE_URL`**  
  Postgres connection string for the tenant runtime database.  
  Format: `postgresql://user:pass@host:5432/dbname`  
  **Behavior:** Required by the main runtime entrypoint (`apps/api/src/index.ts`).

## Optional Environment Variables

### Application Configuration

- **`PORT`** (app default: `3001`; container image default: `3000`)  
  HTTP listener port for the combined web + API server.  
  **Note:** Local `apps/api/src/index.ts` defaults to `3001`; the container image sets `PORT=3000`.

- **`NODE_ENV`** (app default: unset; container image default: `production`)  
  Node.js environment mode.  
  **Note:** The application does not set `NODE_ENV`; container deployments set `NODE_ENV=production`.

### Database Configuration

- **`DATABASE_URL`**  
  Postgres connection string for tenant databases.  
  Format: `postgresql://user:pass@host:5432/dbname`  
  **Behavior:** When set, the API uses `node-postgres` with connection pooling. In control-plane provisioned environments this should be a tenant-scoped least-privilege role, not a shared fleet credential.

- **`NOTES_DB_PATH`**  
  Path to a SQLite snapshot file for helper tooling that intentionally targets
  the non-runtime SQLite bridge.  
  **Behavior:** Ignored by the main runtime entrypoint; still used by helper
  flows such as seed/reset against SQLite snapshots.

- **`NOTES_DB_POOL_MIN`** (default: `0`)  
  Minimum pooled Postgres connections.

- **`NOTES_DB_POOL_MAX`** (default: `20`)  
  Maximum pooled Postgres connections.

- **`NOTES_DB_IDLE_TIMEOUT_MS`** (default: `30000`)  
  Postgres pool idle timeout.

- **`NOTES_DB_CONNECTION_TIMEOUT_MS`** (default: `10000`)  
  Postgres connection acquisition timeout.

- **`NOTES_DB_STATEMENT_TIMEOUT_MS`** (default: `30000`)  
  Postgres statement timeout.

### Security & Access Control

- **`SITE_ADMIN_EMAILS`** (default: empty)  
  Comma-separated list of emails that receive site-admin privileges.  
  Example: `admin@example.com,ops@example.com`

- **`PUBLIC_WEB_URL`** (default: request-derived)  
  Canonical public web origin for share links and redirects.  
  Example: `https://tenant-abc123.dnd-notes.app`

- **`ALLOWED_ORIGINS`** (default: `http://localhost:5173,http://localhost:3000`)  
  Comma-separated CORS allowlist for cross-origin API access.  
  **Note:** In same-origin container deployments (recommended), this is mostly relevant for local development.

### Keycloak Runtime Authentication

When `AUTH_MODE=keycloak`, the tenant runtime validates Keycloak JWTs for authenticated requests. Guest/share-link flows remain local and anonymous. The control-plane uses its own prefixed variables (`CONTROL_PLANE_AUTH_MODE`, `CONTROL_PLANE_KEYCLOAK_*`, `TENANT_AUTH_MODE`, `TENANT_KEYCLOAK_*`) to keep admin auth and tenant-runtime injection separate.

- **`AUTH_MODE`** (default: `local`)  
  Authentication provider mode. Options: `local` (legacy email/password + sessions) or `keycloak` (OIDC/JWT).  
  **Note:** When set to `local`, all other `KEYCLOAK_*` variables are ignored and tenant apps use the traditional session-token flow.

- **`KEYCLOAK_URL`** (required when `AUTH_MODE=keycloak`)  
  Base URL of the Keycloak instance.  
  Example (k3d): `http://keycloak.127.0.0.1.nip.io:8080`  
  Example (hosted): `https://auth.example.com`

- **`KEYCLOAK_JWKS_URL`** (optional when `AUTH_MODE=keycloak`)  
  Server-side override for the JWKS endpoint used to validate bearer tokens. Leave it unset when the runtime can reach `{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs` directly.  
  Example (k3d tenant pod): `http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080/realms/dnd-notes-dev/protocol/openid-connect/certs`

- **`KEYCLOAK_REALM`** (required when `AUTH_MODE=keycloak`)  
  Keycloak realm name for tenant users and control-plane admins.  
  Example: `dnd-notes-dev` (k3d), `dnd-notes-prod` (hosted)

- **`KEYCLOAK_TENANT_CLIENT_ID`** (required when `AUTH_MODE=keycloak` for tenant apps)  
  Keycloak client ID for tenant app OIDC flows.  
  Example: `dnd-notes-tenant-app`

Tenant runtimes validate JWTs through the realm JWKS endpoint, so they do **not**
need a tenant client secret in the pod environment. In local k3d, the browser-facing
Keycloak URL resolves to `127.0.0.1`, which is not reachable from inside tenant pods,
so tenant workloads should use `KEYCLOAK_JWKS_URL` to point at the in-cluster
`platform-keycloak` Service while keeping `KEYCLOAK_URL` on the public issuer/origin.
Host-side override workflows such as `scripts/k3d/tenant-api-override.sh` should
leave `KEYCLOAK_JWKS_URL` unset when the tenant ConfigMap carries an in-cluster
Service hostname, so the local `apps/api` process falls back to the public
`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs` endpoint.

#### Runtime Auth Flow (Keycloak mode)

**Tenant apps:**
1. User logs in via Keycloak login form (redirects to tenant origin with auth code)
2. Tenant app exchanges code for ID token + access token
3. Frontend stores tokens and sends access token in API request `Authorization: Bearer <token>`
4. Backend (`requireAuthenticatedAccount`) validates JWT signature against the realm JWKS/public key
5. If valid, extracts user identity (`keycloak_sub`, email) and looks up owner account
6. Guest/share-link flows bypass auth and remain anonymous (no JWT required)

**Control-plane admin API:** see `platform/control-plane/README.md` for the prefixed `CONTROL_PLANE_*` and `TENANT_*` environment contract that the control-plane process uses.

#### Local Auth Flow (Legacy mode, `AUTH_MODE=local`)

When `AUTH_MODE=local`:
- Tenant app login uses traditional `/api/auth/register` and `/api/auth/login` endpoints
- Session tokens (database-backed) are used instead of JWTs
- Guest/share-link flows remain unchanged
- Control-plane uses static bearer token from `CONTROL_PLANE_ADMIN_TOKEN` environment variable
- No Keycloak instance required for local development

### Container Behavior

- **`SERVE_WEB`** (default: `false`)  
  When `true`, the API server also serves the built web app at `/` for same-origin deployments.  
  **Production containers should set this to `true`.**


## Health Endpoints

The application exposes four health and probe endpoints:

### `GET /healthz` (Liveness Probe)
**Purpose:** Process liveness check for Kubernetes.  
**Response:** `200 OK` with `{ "status": "ok", "service": "dnd-notes-api" }`  
**Failure mode:** Only fails if the Node.js process is dead or unresponsive.

**Kubernetes usage:**
```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
```

### `GET /ready` (Control-plane Readiness Contract)
**Purpose:** Cluster-internal readiness path used by the control plane and tenant
Deployment manifests.  
**Response:** Same behavior as `/readyz`.

### `GET /readyz` (Legacy Readiness Probe)
**Purpose:** Ready-to-serve-traffic check for Kubernetes.  
**Response:**  
- `200 OK` with `{ "status": "ok", "service": "dnd-notes-api" }` when database is healthy  
- `503 Service Unavailable` with `{ "error": "Database unavailable" }` when database connection fails
- `503 Service Unavailable` with `{ "error": "Shutting down" }` during SIGTERM drain / termination

**Failure mode:** Returns 503 if a lightweight database connectivity check fails or the container is draining for shutdown/maintenance.

**Kubernetes usage:**
```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2
```

### `GET /health` (Legacy)
**Purpose:** Backward compatibility for existing monitoring.  
**Response:** Same as `/healthz`  
**Status:** Maintained for continuity; prefer `/healthz` and `/ready` for new deployments.

## Persistent Storage

### SQLite-compatible snapshot scratch space
- **Mount point:** `/app/data`  
- **File:** `/app/data/dnd-notes.sqlite`  
- **Volume type:** Local bind mount, or in the current hosted transition a
  Kubernetes `PersistentVolumeClaim`

The control-plane provisioning slice for issue #54 kept this mount around during
the transition so the container could still materialize SQLite-compatible admin
snapshots and other temporary helper files. It is no longer the primary runtime
write path; issue #95 supersedes the PVC-backed tenant shape for hosted steady
state.

**Kubernetes example:**
```yaml
volumeMounts:
  - name: data
    mountPath: /app/data
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: tenant-abc123-data
```

### Postgres (hosted steady-state target)
- **Connection:** Via `DATABASE_URL` environment variable  
- **Least-privilege boundary:** Newly provisioned tenants receive a dedicated
  Postgres role and randomized password from the control plane. The control
  plane bootstraps the note-store schema before the tenant pod starts, so the
  runtime user does not need schema-creation rights.
- **Persistence:** Managed by Postgres for note data. During the current
  transition the control plane may still mount `/app/data` for
  runtime scratch/fallback storage, but #95 removes that tenant PVC from the
  normal hosted pod shape.  
- **Backup:** Control-plane orchestrated `pg_dump` to object storage

## Container Lifecycle

### Startup
1. Resolve environment variables
2. Initialize the Postgres connection from `DATABASE_URL`
3. Run compatible startup upgrades (if needed). Least-privilege Postgres runtime
   users verify the pre-initialized schema instead of creating it.
4. Start HTTP server on `PORT`
5. Readiness probe begins succeeding

### Shutdown (SIGTERM)
1. Stop accepting new HTTP connections
2. Flip readiness to `503` so the pod is removed from Endpoints during drain
3. Wait for in-flight requests to complete (default: 30s grace period)
4. Close idle keep-alive connections so shutdown is not blocked by unused sockets
5. Close database connection cleanly
6. Exit with code 0 (or force-exit after the 30s grace period)

### Graceful Termination
The container handles `SIGTERM` for controlled rolling updates today and future
overlapping zero-downtime updates once the tenant PVC leaves the normal hosted
pod shape:
```javascript
process.on('SIGTERM', () => shutdown(0))
```

`shutdown()` now marks the app unready immediately, closes the HTTP server first, drains in-flight requests for up to 30 seconds, closes idle keep-alive sockets, and only then closes the database handle.

**Kubernetes recommendation:**
```yaml
terminationGracePeriodSeconds: 30
```

## Network Ports

- **`3000`** - HTTP server (web + API)

No other ports are required or exposed.

## User & Permissions

The container runs as a non-root user (`appuser:appuser`, UID/GID assigned at build time).

**Security posture:**
- No root privileges required at runtime
- Write access only to `/app/data` when a deployment still mounts snapshot scratch storage
- Read-only for application code (`/app/apps/api`, `/app/apps/web`)

## Build & Deployment

### Build
```bash
docker build -t ghcr.io/daydream-software/dnd-notes:latest .
```

### Run (local test)
```bash
docker run -p 3000:3000 \
  -e SERVE_WEB=true \
  -e PUBLIC_WEB_URL=http://localhost:3000 \
  -v $(pwd)/data:/app/data \
  ghcr.io/daydream-software/dnd-notes:latest
```

### Kubernetes Deployment (Phase 1 shape)
See issue #43 for full manifest examples after Phase 0 validation.

## Hosted persistence transition notes

**Current state in code:**
- Hosted path: Postgres via `DATABASE_URL`
- Backup via admin API (`GET /api/admin/backup`) using SQLite-compatible snapshots

**Current hosted rollout contract:**
- Postgres via `DATABASE_URL`, with newly provisioned tenants using
  tenant-scoped runtime credentials
- PVC may stay mounted at `/app/data` for fallback/runtime files, but it is not
  the primary hosted write path
- Rolling updates use drain-first replacement (`maxSurge: 0`, `maxUnavailable: 1`)
  to prevent pod overlap while the RWO PVC remains, plus readiness + shutdown
  drain instead of SQLite single-writer handoff
- Backup via control-plane `pg_dump` CronJob remains a later slice

**Target hosted steady state (`#95`):**
- One Postgres database plus one least-privilege runtime role per tenant
- No tenant PVC in the normal hosted pod shape
- Rolling updates switch to overlapping `maxSurge: 1` / `maxUnavailable: 0`
  once the pod no longer depends on SQLite handoff semantics
- Backup/restore orchestration pivots to per-tenant `pg_dump` / `pg_restore`
  while the SQLite-compatible admin snapshot bridge is phased out deliberately

**Migration:**
1. Download a fresh SQLite-compatible admin backup from the old SQLite-backed tenant.
2. Create or provision the target Postgres tenant so the control plane can
   pre-initialize the schema and emit tenant-scoped runtime credentials.
3. Restore the backup through the admin restore flow; the API imports the snapshot into Postgres.
4. Keep SQLite-compatible snapshot tooling only for migration/helper flows, not
   for the main runtime server.

Existing hosted tenants that already run on a shared runtime Postgres user are a
deliberate migration boundary. This slice does not silently rotate those live
credentials during ordinary reprovisioning.

## Current Postgres-backed rolling-update choreography

The first supported hosted upgrade path assumes the tenant is already using
`DATABASE_URL`.

1. The control plane calls `POST /internal/tenants/:tenantId/provision` with a
   new `version`.
2. If the tenant is already serving traffic, the registry records
   `currentState = upgrading` while the target remains `desiredState = ready`.
3. The tenant Deployment uses single-replica drain-first rollout semantics
   (`RollingUpdate`, `maxSurge: 0`, `maxUnavailable: 1`, `minReadySeconds: 5`).
   The old pod is terminated before the new pod becomes ready.
4. On `SIGTERM`, the old pod immediately returns `503` from `/ready`, stops
   accepting new connections, drains in-flight requests for up to 30 seconds,
   closes idle keep-alive sockets, and only then closes the Postgres pool.
5. The control plane marks the tenant back to `ready` after the rollout is
   fully complete (`observedGeneration` matches, `updatedReplicas` and
   `availableReplicas` equal `spec.replicas`, no unavailable replicas remain).

The `/app/data` PVC remains mounted but causes no multi-attach contention since
the rollout strategy prevents pod overlap.

**Target under #95:** Once the tenant PVC leaves the normal pod shape, the
rollout strategy can switch to `maxSurge: 1` / `maxUnavailable: 0` for
overlapping zero-downtime updates without drain windows.

## Exclusive maintenance work

**Status:** Not yet implemented. Reserved for restore drills, incompatible
schema steps, and other flows that need exclusive access instead of an ordinary
rolling image update.

## Control Plane Contract (future exclusive-maintenance follow-up)

**Cluster-internal endpoints (not yet implemented):**
- `GET /internal/status` - Runtime state (version, database health, uptime)
- `POST /internal/bootstrap` - Initial tenant bootstrap and migrations
- `POST /internal/maintenance` - Enter drain mode
- `DELETE /internal/maintenance` - Exit drain mode

These are reserved for Phase 1 control-plane orchestration and are **not** exposed via public ingress.

## Postgres Notes (Phase 1 preparation)

When `DATABASE_URL` is set, the application will:
1. Use `node-postgres` for async database access (issue #58)
2. Respect Postgres connection pooling and timeout settings
3. Drain the pool on shutdown before process exit
4. Keep exporting/importing SQLite-compatible admin snapshots for backup + migration workflows

**Connection pool defaults (to be tuned in Phase 1):**
- Max connections: 20
- Idle timeout: 30s
- Connection timeout: 10s
- Statement timeout: 30s

## Observability (Future)

Phase 0 scope: health endpoints only.

**Deferred to Phase 2+:**
- Structured logging (JSON output)
- OpenTelemetry tracing
- Prometheus `/metrics` endpoint
- Application performance monitoring (APM)

## Security Considerations

### Secrets Management
- **Phase 0:** Environment variables via Kubernetes Secrets
- **Phase 1+:** Sealed Secrets or Vault integration

### Network Policies
- **Phase 0:** No network policy enforcement
- **Phase 1:** NetworkPolicy restricts `/internal/*` to control-plane namespace

### Database Credentials
- **SQLite:** No credentials (file-based)
- **Postgres:** Connection string via `DATABASE_URL` (Kubernetes Secret)

### TLS
- **Ingress:** Handled by ingress-nginx + cert-manager (wildcard DNS-01)
- **Backend:** HTTP only (TLS terminated at ingress)

## Testing the Container

### Smoke test
```bash
# Build
docker build -t dnd-notes:test .

# Run
docker run -d -p 3000:3000 \
  -e SERVE_WEB=true \
  -e ALLOWED_ORIGINS=http://localhost:3000 \
  --name dnd-notes-test \
  dnd-notes:test

# Wait for startup
sleep 3

# Liveness check
curl -f http://localhost:3000/healthz || echo "FAIL: liveness"

# Readiness check
curl -f http://localhost:3000/readyz || echo "FAIL: readiness"

# Web app served
curl -f http://localhost:3000/ | grep -q "dnd-notes" || echo "FAIL: web"

# Cleanup
docker stop dnd-notes-test
docker rm dnd-notes-test
```

### Integration test (with Postgres, Phase 1)
To be defined in issue #58 after the Postgres adapter lands.

## References

- Issue #52 - Containerize dnd-notes for per-tenant Kubernetes deployment (this work)
- Issue #42 - Epic: build the multi-tenant Kubernetes platform
- Issue #58 - Port NoteStore adapter from SQLite to Postgres
- Issue #43 - Track deployment artifacts (manifests, after Postgres)
- Epic 42 Phase 0 decisions - `.squad/decisions.md`
