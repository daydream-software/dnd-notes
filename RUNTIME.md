# Runtime Environment Contract

This document defines the environment variables and runtime expectations for the dnd-notes tenant container.

## Required Environment Variables

None. The application will start with defaults.

## Optional Environment Variables

### Application Configuration

- **`PORT`** (default: `3000`)  
  HTTP listener port for the combined web + API server.

- **`NODE_ENV`** (default: `production`)  
  Node.js environment mode. Set to `production` in container deployments.

### Database Configuration

- **`NOTES_DB_PATH`** (default: `/app/data/dnd-notes.sqlite`)  
  Path to the SQLite database file (Phase 0 local dev fallback).  
  **Production:** Will use Postgres connection string via `DATABASE_URL` after Phase 0.

- **`DATABASE_URL`** (not yet implemented)  
  Postgres connection string for production tenant databases.  
  Format: `postgresql://user:pass@host:5432/dbname`  
  **Status:** Reserved for Phase 0 Postgres adapter work (issue #46).

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

### Container Behavior

- **`SERVE_WEB`** (default: `false`)  
  When `true`, the API server also serves the built web app at `/` for same-origin deployments.  
  **Production containers should set this to `true`.**

## Health Endpoints

The application exposes three health check endpoints:

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

### `GET /readyz` (Readiness Probe)
**Purpose:** Ready-to-serve-traffic check for Kubernetes.  
**Response:**  
- `200 OK` with `{ "status": "ok", "service": "dnd-notes-api" }` when database is healthy  
- `503 Service Unavailable` with `{ "status": "unavailable", "service": "dnd-notes-api" }` when database connection fails

**Failure mode:** Returns 503 if the database is unreachable or locked.

**Kubernetes usage:**
```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2
```

### `GET /health` (Legacy)
**Purpose:** Backward compatibility for existing monitoring.  
**Response:** Same as `/healthz`  
**Status:** Maintained for continuity; prefer `/healthz` and `/readyz` for new deployments.

## Persistent Storage

### SQLite (Phase 0 local dev)
- **Mount point:** `/app/data`  
- **File:** `/app/data/dnd-notes.sqlite`  
- **Volume type:** Kubernetes `PersistentVolumeClaim` or local bind mount

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

### Postgres (Phase 1 target)
- **Connection:** Via `DATABASE_URL` environment variable  
- **Persistence:** Managed by Postgres (no container volume needed)  
- **Backup:** Control-plane orchestrated `pg_dump` to object storage

## Container Lifecycle

### Startup
1. Resolve environment variables
2. Initialize database connection (`NOTES_DB_PATH` or `DATABASE_URL`)
3. Run schema migrations (if needed)
4. Start HTTP server on `PORT`
5. Readiness probe begins succeeding

### Shutdown (SIGTERM)
1. Stop accepting new HTTP connections
2. Wait for in-flight requests to complete (default: 30s grace period)
3. Close database connection cleanly
4. Exit with code 0

### Graceful Termination
The container handles `SIGTERM` for zero-downtime rolling updates:
```javascript
process.on('SIGTERM', () => shutdown(0))
```

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
- Write access only to `/app/data` (database volume)
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

## Phase 0 ↔ Phase 1 Migration Notes

**Current (Phase 0):**
- SQLite database at `/app/data/dnd-notes.sqlite`
- Single-writer constraint enforced by file lock
- Backup via admin API (`GET /api/admin/backup`)

**Future (Phase 1):**
- Postgres via `DATABASE_URL`
- Stateless container (no volume mount needed)
- Rolling updates without single-writer handoff
- Backup via control-plane `pg_dump` CronJob

**Migration:**
1. Phase 0 proves container + health contract + Kubernetes lifecycle
2. Issue #46 ports `note-store.ts` to Postgres (`node-postgres`)
3. Phase 1 manifests (#43) reference `DATABASE_URL` instead of PVC
4. SQLite support retained as local dev fallback via env detection

## Maintenance Mode (Phase 1)

**Status:** Not yet implemented. Reserved for control-plane orchestration.

**Design intent (issue #42):**
- `POST /_control/maintenance` endpoint to enable drain mode
- Readiness probe fails during maintenance
- Kubernetes removes pod from load balancer
- Control plane executes maintenance operations (backup, restore, schema migration)
- `DELETE /_control/maintenance` to resume normal operation

## Control Plane Contract (Phase 1)

**Cluster-internal endpoints (not yet implemented):**
- `GET /_control/info` - Runtime state (version, database health, uptime)
- `POST /_control/maintenance` - Enter drain mode
- `DELETE /_control/maintenance` - Exit drain mode

These are reserved for Phase 1 control-plane orchestration and are **not** exposed via public ingress.

## Postgres Notes (Phase 1 preparation)

When `DATABASE_URL` is set, the application will:
1. Use `node-postgres` for async database access (issue #46)
2. Respect Postgres connection pooling and timeout settings
3. Gracefully handle connection loss (retry with exponential backoff)
4. Support schema migrations via control-plane orchestration

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
- **Phase 1:** NetworkPolicy restricts `/_control/*` to control-plane namespace

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
To be defined in issue #46 after Postgres adapter lands.

## References

- Issue #52 - Containerize dnd-notes for per-tenant Kubernetes deployment (this work)
- Issue #42 - Epic: build the multi-tenant Kubernetes platform
- Issue #46 - Migrate note-store backend from SQLite to Postgres
- Issue #43 - Track deployment artifacts (manifests, after Postgres)
- Epic 42 Phase 0 decisions - `.squad/decisions.md`
