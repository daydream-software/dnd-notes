# Control Plane

Internal orchestration service for multi-tenant lifecycle management.

## Purpose

The control-plane service maintains the tenant registry and exposes internal APIs for:
- Provisioning new tenant instances
- Tracking tenant lifecycle state (7-state model)
- Recording state transitions for audit trails
- Managing storage references and backup metadata

This service is **cluster-internal only** and not exposed to end users.
All `/internal` routes require a bearer token from `CONTROL_PLANE_ADMIN_TOKEN`.

## Tenant Lifecycle States

The 7-state model governs all tenant lifecycle operations:

```
provisioning → ready ⇄ maintenance ⇄ upgrading
                ↓          ↓           ↓
              ready    restoring    ready
                ↓          ↓
              failed    failed
                ↓
          deprovisioned
```

- `provisioning`: K8s resources + tenant storage being created
- `ready`: Normal operation, serving traffic
- `maintenance`: Drain mode initiated (read-only, probes grace)
- `upgrading`: Rolling update in progress (pod replaced, schema migrated)
- `restoring`: tenant restore workflow in progress (post-safety-snapshot)
- `failed`: Terminal error; requires operator action
- `deprovisioned`: Resources deleted, backup retained

## Data Model

### Tenant Registry

Each tenant record includes:
- `id`: Unique tenant identifier
- `slug`: DNS-safe subdomain slug (lowercase, alphanumeric + hyphens)
- `ownerId`: Reference to the tenant owner
- `desiredState`: Target state for orchestration
- `currentState`: Actual state (observed from K8s API)
- `version`: Current app version running
- `storageReference`: Pointer to persistent volume (e.g., PVC name)
- `backupMetadata`: Opaque string for backup metadata (often JSON-serialized details such as locations and schedules)
- `createdAt`: Tenant creation timestamp
- `updatedAt`: Last modification timestamp

The live provisioning slice also creates a per-tenant Postgres database, but the
registry keeps `storageReference` focused on the Kubernetes storage handle so the
PVC lifecycle stays explicit in tenant metadata.

### State Transitions

Every state change is logged with:
- `tenantId`: Which tenant transitioned
- `fromState`: Previous state
- `toState`: New state
- `triggeredBy`: Who/what initiated the change (system, operator, provisioner)
- `reason`: Optional human-readable explanation
- `createdAt`: When the transition occurred

## API Endpoints

### Health

- `GET /health` — Health check

### Tenant Management

- `GET /internal/tenants` — List all tenants
- `GET /internal/tenants/:tenantId` — Get tenant details
- `POST /internal/tenants` — Create a new tenant
- `PATCH /internal/tenants/:tenantId/state` — Update current state (records transition)
- `PATCH /internal/tenants/:tenantId/desired-state` — Update desired state
- `PATCH /internal/tenants/:tenantId/storage` — Update storage reference
- `PATCH /internal/tenants/:tenantId/backup` — Update backup metadata
- `GET /internal/tenants/:tenantId/transitions` — Get state transition history

## Configuration

Environment variables:

- `PORT` — HTTP port (default: 3001)
- `DATABASE_PATH` — SQLite database path (default: `data/control-plane.sqlite`; relative paths resolve from the app root)
- `CONTROL_PLANE_ADMIN_TOKEN` — Required bearer token for `/internal` routes
- `NODE_ENV` — Environment mode (development, production)

## Development

```bash
# Install dependencies
npm install

# Run in dev mode
npm run dev

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## Persistence

SQLite-backed for Phase 1. The database stores:
- Tenant registry (primary source of truth for tenant metadata)
- State transition audit log (full lifecycle history)

Future: Migrate to Postgres when fleet size justifies it.

## Design Constraints

- **Thin by design**: No business logic beyond registry CRUD and state tracking
- **Explicit states**: No implicit state inference; K8s API is observed truth
- **Single active transition (target)**: Transitions are intended to be serialized per tenant, but Phase 1 does not yet enforce this with locking or transactional guards
- **Audit-first**: Every state transition is logged

## Follow-Up Work

This skeleton is ready to drive:
- Issue #54: Provisioning (creates K8s resources, updates registry)
- Issue #55: Rolling updates (orchestrates upgrades, tracks state)
- Issue #40: Backup/restore (manages backup metadata, coordinates restore)
