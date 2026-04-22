# Control Plane

Internal orchestration service for multi-tenant lifecycle management.

## Purpose

The control-plane service maintains the tenant registry and exposes internal APIs for:
- Provisioning new tenant instances
- Tracking tenant lifecycle state (7-state model)
- Recording state transitions for audit trails
- Managing storage references and backup metadata

This service is **cluster-internal only** and not exposed to end users.
All `/internal` routes require a bearer token. In static mode that is
`CONTROL_PLANE_ADMIN_TOKEN`; in Keycloak mode it must be a JWT from the
configured workforce/admin Keycloak client and realm.

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
- `initialAdminEmail`: Optional operator-supplied email to carry forward into a later tenant bootstrap slice
- `desiredState`: Target state for orchestration
- `currentState`: Actual state (observed from K8s API)
- `version`: Current app version running
- `storageReference`: Pointer to persistent volume (e.g., PVC name)
- `backupMetadata`: Opaque string for backup metadata (often JSON-serialized details such as locations and schedules)
- `createdAt`: Tenant creation timestamp
- `updatedAt`: Last modification timestamp

The live provisioning slice also creates a per-tenant Postgres database plus a
tenant-scoped runtime role/secret for newly provisioned tenants, but the
registry keeps `storageReference` focused on the Kubernetes storage handle so
the PVC lifecycle stays explicit in tenant metadata.

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
- `GET /healthz` — Kubernetes liveness probe
- `GET /readyz` — Kubernetes readiness probe
- `GET /ready` — Short readiness alias for cluster-internal callers

### Tenant Management

- `GET /internal/tenants` — List all tenants
- `GET /internal/tenants/:tenantId` — Get tenant details
- `POST /internal/tenants` — Create a new tenant
- `PATCH /internal/tenants/:tenantId/state` — Update current state (records transition)
- `PATCH /internal/tenants/:tenantId/desired-state` — Update desired state
- `PATCH /internal/tenants/:tenantId/storage` — Update storage reference
- `PATCH /internal/tenants/:tenantId/backup` — Update backup metadata
- `GET /internal/tenants/:tenantId/transitions` — Get state transition history

### Fleet status surface (`#57`)

- `GET /internal/fleet/status` — Read-only fleet summary for operators

The fleet-status response is meant to be the first internal observability surface,
not the full operator portal. It includes:

- control-plane health (`status`, `uptime`, `version`)
- key dependency state (tenant registry plus whether tenant provisioning is enabled)
- fleet summary counts by tenant state and version
- per-tenant status details, including current/desired state, latest recorded transition, and lifted backup fields when `backupMetadata` already contains parseable JSON

`backupMetadata` remains opaque in storage. The status endpoint only lifts known
fields such as `lastBackupAt`, `lastBackupStatus`, `lastRestoreDrillAt`,
`lastRestoreDrillStatus`, and `location` when they already exist in JSON
metadata; otherwise it preserves the raw string and reports the parsed fields as
`null`.

### Customer portal surface (`#70`)

- `GET /portal/catalog` — public landing-page catalog and portal capability flags
- `POST /portal/signup` — local email signup + first tenant request
- `POST /portal/login` — local email sign-in for an existing portal account
- `GET /portal/me` — owner-scoped customer dashboard
- `POST /portal/me/tenants` — create an additional tenant request for the signed-in owner
- `POST /portal/logout` — invalidate the current portal bearer session

This surface is intentionally separate from `/internal`:

- `/internal/*` stays operator/admin-only
- `/portal/*` is the customer-facing contract for landing, signup, and instance management

For this first slice, the portal stores a lightweight local customer account plus
opaque bearer session in the control-plane SQLite database. The payload shape is
already aligned with the future Keycloak migration plan:

- `portal_accounts.keycloak_sub` is reserved for the eventual OIDC reconciliation key
- local email-based auth remains the Phase 1 bootstrap path
- customer dashboards are always scoped by `ownerId = portalAccount.id`
- tenant creation still hands off to the same control-plane provisioning lane when
  provisioning is enabled

## Operator-portal contract notes (`#68`)

- `POST /internal/tenants` now accepts an optional `initialAdminEmail` and
  persists it on the tenant record.
- The field is metadata only for now: it is visible through tenant reads and
  fleet status, but this slice does **not** create an in-tenant admin account.
- Custom-domain inputs remain deferred. Provisioning still assigns opaque
  subdomains under `TENANT_BASE_DOMAIN` until DNS/TLS choreography is designed.

## Future public status path

Issue `#57` stops at the internal authenticated surface. If we later need a
customer-facing `status.example.com`, the intended path is to publish a redacted,
read-only view derived from the same control-plane contract instead of creating a
separate scrape-only status pipeline. Issue `#68` remains the richer operator
portal and control surface.

## Customer-portal contract notes (`#70`)

- New self-serve tenants persist customer metadata on the existing tenant record:
  - `displayName` — customer-facing tenant name shown in the portal dashboard
  - `planTier` — selected catalog plan/tier
  - `initialAdminEmail` — seeded from the portal account email as bootstrap metadata
- `paymentProvider` is placeholder-only in this slice (`stripe`, `square`, or
  `manual-review`); no real payment gateway integration happens here.
- When provisioning is enabled, the portal route reuses the same provisioning port
  as operators. When provisioning is disabled, the tenant record still exists so
  customer intent and dashboard state are visible without pretending the runtime is
  live.
- `GET /portal/me` returns a customer-safe dashboard shape:
  - owner account details
  - plan catalog / placeholder roadmap flags
  - owned tenant summaries only
  - derived `appUrl` when a tenant subdomain exists and `TENANT_BASE_DOMAIN` is configured

## Postgres-backed rolling updates (`#55`)

The first supported tenant upgrade path reuses the existing provisioning route
with a version override:

1. `POST /internal/tenants/:tenantId/provision` with `{"triggeredBy":"...","version":"x.y.z"}`.
2. If the tenant is already `ready`, the control plane records `upgrading`,
   reapplies the tenant manifests, and updates the Deployment image tag while
   preserving any existing tenant runtime secret.
3. Kubernetes performs a single-replica drain-first rollout (`RollingUpdate`,
   `maxSurge: 0`, `maxUnavailable: 1`) with `minReadySeconds: 5` and
   `terminationGracePeriodSeconds: 30`. The old pod is terminated before the new
   pod becomes ready.
4. The old pod flips `/ready` to `503` on `SIGTERM`, drains in-flight HTTP
   work, closes idle keep-alives, and only then closes the Postgres pool.
5. When the new pod is fully rolled out (observedGeneration matches,
   updatedReplicas/availableReplicas equal spec.replicas), the control plane
   moves the tenant back to `ready`.

This path assumes tenant note traffic is Postgres-backed via `DATABASE_URL`.
New tenants receive least-privilege runtime credentials after the control plane
pre-initializes the note-store schema; already-deployed tenants that still use a
shared runtime Postgres user remain on that credential until an explicit
migration. The `/app/data` PVC remains mounted but causes no multi-attach
contention since the rollout strategy prevents pod overlap.

**Future:** Once the PVC is removed from the normal pod shape, the rollout
strategy can switch to `maxSurge: 1` / `maxUnavailable: 0` for zero-downtime
updates without drain windows.

### Operator notes

- Rolling updates use a drain-first replacement: one pod is terminated before
  the new one becomes ready. No connection overlap occurs.
- Use a separate maintenance window for exclusive operations such as restore
  drills or incompatible schema work. The future maintenance endpoints stay
  reserved for that narrower path; ordinary image rollouts should use the
  rolling-update flow above.
- Versioned `POST /internal/tenants/:tenantId/provision` failures now distinguish
  the highest-signal operator cases:
  - `400 unsupported_target_version` when a ready tenant is already on the
    requested version
  - `409 tenant_rollout_in_progress` / `tenant_rollout_disallowed` when another
    rollout is already active or the tenant is not in `ready`
  - `500 tenant_rollout_failed` with retry guidance instead of raw backend
    failure text when the rollout itself breaks mid-flight

## Configuration

Environment variables:

- `PORT` — HTTP port (default: 3001)
- `DATABASE_PATH` — SQLite database path (default: `data/control-plane.sqlite`; relative paths resolve from the app root)
- `CONTROL_PLANE_AUTH_MODE` — `static` (default) or `keycloak`
- `CONTROL_PLANE_ADMIN_TOKEN` — required bearer token for `/internal` routes when `CONTROL_PLANE_AUTH_MODE=static`
- `CONTROL_PLANE_KEYCLOAK_URL` — Keycloak base URL for workforce/admin JWT validation
- `CONTROL_PLANE_KEYCLOAK_REALM` — workforce/admin realm used for `/internal` JWT validation
- `CONTROL_PLANE_KEYCLOAK_CLIENT_ID` — Keycloak client ID accepted for `/internal` JWTs
- `CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES` — comma-separated allowed workforce/admin roles (defaults to `control-plane-admin,control-plane-workforce`)
- `CUSTOMER_PORTAL_AUTH_MODE` — `local` (default) or `keycloak` for the public `/portal` contract; only `local` is implemented in this slice
- `CUSTOMER_PORTAL_DEFAULT_TENANT_VERSION` — optional default version assigned to portal-created tenants (defaults to the control-plane package version)
- `CONTROL_PLANE_ENABLE_PROVISIONING` — enables live Kubernetes/Postgres provisioning
- `TENANT_AUTH_MODE` — `local` (default) or `keycloak` for provisioned tenant pods
- `TENANT_KEYCLOAK_URL` — Keycloak base URL injected into tenant pods when `TENANT_AUTH_MODE=keycloak`
- `TENANT_KEYCLOAK_REALM` — tenant realm injected into tenant pods when `TENANT_AUTH_MODE=keycloak`
- `TENANT_KEYCLOAK_CLIENT_ID` — tenant web client ID injected into tenant pods when `TENANT_AUTH_MODE=keycloak`
- `TENANT_BASE_DOMAIN` — base domain for generated tenant hosts
- `TENANT_IMAGE_REPOSITORY` — tenant image repository used in generated Deployments
- `TENANT_DATABASE_ADMIN_URL` — admin Postgres URL used to create/drop tenant databases, roles, and bootstrap schema
- `TENANT_DATABASE_RUNTIME_URL` — optional runtime URL template; host/port/SSL options come from here, but user/password/database are replaced with tenant-scoped values for new tenants
- `TENANT_IMAGE_PULL_SECRET` — optional imagePullSecret for tenant Deployments
- `TENANT_PUBLIC_SCHEME` — tenant public URL scheme (`https` by default)
- `TENANT_APP_PORT` — tenant container port (`3000` by default)
- `TENANT_READY_TIMEOUT_MS` — rollout readiness timeout for tenant Deployments
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
- Issue #55: Rolling updates (first Postgres-backed path documented + encoded; exclusive maintenance follow-up remains)
- Issue #40: Backup/restore (manages backup metadata, coordinates restore)

## Deployment Artifacts

Issue `#43` now carries the committed in-cluster packaging lane for this service:

- `docker/control-plane/Dockerfile` — production image for the internal control plane
- `platform/control-plane/overlays/k3d` — local k3d manifest overlay
- `platform/control-plane/overlays/hosted-reference` — hosted-cluster reference overlay

These artifacts keep the control plane internal-only while preserving the locked
same-origin tenant model through `TENANT_BASE_DOMAIN` + `TENANT_PUBLIC_SCHEME`.
