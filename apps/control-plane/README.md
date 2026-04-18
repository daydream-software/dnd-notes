# Control Plane

Internal orchestration service for multi-tenant lifecycle management.

## Purpose

The control-plane service maintains the tenant registry and exposes internal APIs for:
- Provisioning new tenant instances
- Tracking tenant lifecycle state (7-state model)
- Recording state transitions for audit trails
- Managing storage references and backup metadata

This service is **cluster-internal only** and not exposed to end users.

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

- `provisioning`: K8s resources + Postgres DB being created
- `ready`: Normal operation, serving traffic
- `maintenance`: Drain mode initiated (read-only, probes grace)
- `upgrading`: Rolling update in progress (pod replaced, schema migrated)
- `restoring`: `pg_restore` in progress (post-safety-snapshot)
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
- `backupMetadata`: JSON metadata for backup locations and schedules
- `createdAt`: Tenant creation timestamp
- `updatedAt`: Last modification timestamp

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

- `GET /api/tenants` — List all tenants
- `GET /api/tenants/:tenantId` — Get tenant details
- `POST /api/tenants` — Create a new tenant
- `PATCH /api/tenants/:tenantId/state` — Update current state (records transition)
- `PATCH /api/tenants/:tenantId/desired-state` — Update desired state
- `PATCH /api/tenants/:tenantId/storage` — Update storage reference
- `PATCH /api/tenants/:tenantId/backup` — Update backup metadata
- `GET /api/tenants/:tenantId/transitions` — Get state transition history

## Configuration

Environment variables:

- `PORT` — HTTP port (default: 3001)
- `DATABASE_PATH` — SQLite database path (default: `data/control-plane.sqlite`)
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
- **Single active transition**: No concurrent state changes per tenant
- **Audit-first**: Every state transition is logged

## Follow-Up Work

This skeleton is ready to drive:
- Issue #54: Provisioning (creates K8s resources, updates registry)
- Issue #55: Rolling updates (orchestrates upgrades, tracks state)
- Issue #40: Backup/restore (manages backup metadata, coordinates restore)
