# Control Plane

Internal orchestration service for multi-tenant lifecycle management.

## Purpose

The control-plane service maintains the tenant registry and exposes internal APIs for:
- Provisioning new tenant instances
- Tracking tenant lifecycle state (7-state model)
- Recording state transitions for audit trails
- Managing storage references and per-tenant backup lifecycle (catalog, restore log, audit log)

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
- `storageReference`: Current storage backing reference (legacy PVC name or tenant Postgres database name)
- `createdAt`: Tenant creation timestamp
- `updatedAt`: Last modification timestamp

Backup state used to live on the tenant row as the free-form
`backup_metadata` column. Issue `#89` replaced it with first-class catalog
tables (see below) and dropped the column in migration `0003`.

### Backup catalog, restore log, and audit log (`#89`)

- `backup_catalog` — one row per backup attempt with full lifecycle
  (`queued → running → completed/failed/canceled`), `format`, `location`,
  `size_bytes`, `checksum`, `failure_reason`, `triggered_by`, `reason`,
  verification fields (`last_verified_at`, `last_verification_status`,
  `last_verification_details`), and `scratch_target` for the artifact
  staging path. Latest successful row per tenant feeds the fleet/status
  and storage-readiness surfaces.
- `restore_log` — one row per restore attempt referencing the source
  `backup_id` plus an optional `safety_snapshot_id` recorded by the
  runner before the destructive restore step. Tracks the same lifecycle
  as `backup_catalog`.
- `control_plane_audit_log` — append-only audit trail for control-plane
  actions (`tenant.backup.create`, `tenant.restore.create`, …). Each
  entry captures `actor`, `action`, `resource_type`, `resource_id`,
  `outcome` (`requested`/`succeeded`/`failed`), and free-form
  `details`. Audit writes are best-effort; they never mask the original
  request outcome.

The live provisioning slice also creates a per-tenant Postgres database plus a
tenant-scoped runtime role/secret for newly provisioned tenants. Provisioned
tenants store that tenant database name in `storageReference`.

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
- `GET /internal/tenants/:tenantId/storage` — Inspect storage mode, migration status, and cutover readiness
- `POST /internal/tenants` — Create a new tenant
- `PATCH /internal/tenants/:tenantId/state` — Update current state (records transition)
- `PATCH /internal/tenants/:tenantId/desired-state` — Update desired state
- `PATCH /internal/tenants/:tenantId/storage` — Update storage reference
- `POST /internal/tenants/:tenantId/backup` — Trigger a backup via the configured backup dispatcher (records a `backup_catalog` row + audit log entry; `501` when no live dispatcher is wired)
- `GET /internal/tenants/:tenantId/backups` — List the tenant's `backup_catalog` history
- `POST /internal/tenants/:tenantId/restore` — Trigger a restore from a catalog row or explicit `backupLocation` (records a `restore_log` row, drives `ready/maintenance ↔ restoring` transitions, audit-logged; `501` when no live dispatcher is wired)
- `GET /internal/tenants/:tenantId/restores` — List the tenant's `restore_log` history
- `GET /internal/tenants/:tenantId/audit` — List the tenant's `control_plane_audit_log` entries
- `GET /internal/tenants/:tenantId/transitions` — Get state transition history

### Fleet status surface (`#57`)

- `GET /internal/fleet/status` — Read-only fleet summary for operators

The fleet-status response is meant to be the first internal observability surface,
not the full operator portal. It includes:

- control-plane health (`status`, `uptime`, `version`)
- key dependency state (tenant registry plus whether tenant provisioning is enabled)
- fleet summary counts by tenant state and version
- per-tenant status details, including current/desired state, latest recorded transition, and catalog-derived backup/restore fields (latest completed `backup_catalog` row per tenant plus the latest `restore_log` row)

`FleetTenantBackupStatus` is now derived directly from the catalog tables
(`backupId`, `location`, `lastBackupAt`, `lastBackupStatus`,
`lastVerifiedAt`, `lastVerificationStatus`, `sizeBytes`, `checksum`,
`lastRestoreAt`, `lastRestoreStatus`). The opaque `backupMetadata`
fall-back has been removed.

### Backup runner seam (`#89` / `#100`)

The control-plane API owns the `backup_catalog`/`restore_log`/audit
lifecycle and tenant-state transitions, while the actual `pg_dump` /
`pg_restore` work is delegated to a `TenantBackupDispatcher` injected
into `createApp`. The default in-process dispatcher is
`ThrowingTenantBackupDispatcher`, which surfaces `501` from the API so
deploys that haven't wired a real runner stay safe. Issue `#100` is
expected to plug `PostgresTenantBackupRunner` into the seam via
`createPostgresTenantBackupDispatcher` once an artifact-store directory
is configured.

Issue `#100` now also has a direct Postgres runner seam in
`src/tenant-backup-runner.ts`: it can create `pg_dump --format=custom`
artifacts, require an exclusive no-traffic restore window, take a mandatory
pre-restore safety snapshot, and run `pg_restore --clean --if-exists` against
the tenant database. This first slice uses a filesystem-backed artifact store
for local/dev flows; the control-plane catalog/API dispatch owned by `#89`
remains a separate follow-up.

The dedicated tenant-storage endpoint adds the next cutover-focused layer on
top: it exposes the persisted storage mode, storage-migration status, the last
cutover failure reason when one exists, and a simple cutover-readiness gate that
checks tenant state plus backup metadata quality before a future cutover run is
allowed. A backup only counts as cutover-ready when the latest
`backup_catalog` row is `completed` and includes both `location` and a
non-null `lastBackupAt`.

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
opaque bearer session in the control-plane Postgres registry. The payload shape is
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
3. Kubernetes now performs an overlapping rollout (`RollingUpdate`,
   `maxSurge: 1`, `maxUnavailable: 0`) with `minReadySeconds: 5`,
   `terminationGracePeriodSeconds: 30`, and a per-tenant
   `PodDisruptionBudget` (`maxUnavailable: 1`) so single-replica tenants do not
   block voluntary disruptions such as node drains.
4. The old pod flips `/ready` to `503` on `SIGTERM`, drains in-flight HTTP
   work, closes idle keep-alives, and only then closes the Postgres pool.
5. When the new pod is fully rolled out (observedGeneration matches,
   updatedReplicas/availableReplicas equal spec.replicas), the control plane
   moves the tenant back to `ready`.

This path assumes tenant note traffic is Postgres-backed via `DATABASE_URL`.
New tenants receive least-privilege runtime credentials after the control plane
pre-initializes the note-store schema; already-deployed tenants that still use a
shared runtime Postgres user remain on that credential until an explicit
migration.

### Operator notes

- Provisioned tenants now surge a temporary second pod during rollouts; steady
  state remains 1 replica.
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
- `CONTROL_PLANE_DATABASE_URL` — required Postgres connection string for the control-plane registry pool
- `CONTROL_PLANE_DATABASE_POOL_MIN` — minimum Postgres connections kept in the control-plane registry pool (default: `0`)
- `CONTROL_PLANE_DATABASE_POOL_MAX` — maximum Postgres connections allowed in the control-plane registry pool (default: `10`)
- `CONTROL_PLANE_DATABASE_IDLE_TIMEOUT_MS` — idle Postgres connection timeout for the control-plane registry pool (default: `30000`)
- `CONTROL_PLANE_DATABASE_CONNECTION_TIMEOUT_MS` — connection acquisition timeout for the control-plane registry pool (default: `10000`)
- `CONTROL_PLANE_DATABASE_STATEMENT_TIMEOUT_MS` — statement timeout for control-plane registry queries (default: `30000`)
- `CONTROL_PLANE_AUTH_MODE` — `static` (default) or `keycloak`
- `CONTROL_PLANE_ADMIN_TOKEN` — required bearer token for `/internal` routes when `CONTROL_PLANE_AUTH_MODE=static`
- `CONTROL_PLANE_KEYCLOAK_URL` — Keycloak base URL for workforce/admin JWT validation
- `CONTROL_PLANE_KEYCLOAK_REALM` — workforce/admin realm used for `/internal` JWT validation
- `CONTROL_PLANE_KEYCLOAK_CLIENT_ID` — Keycloak client ID accepted for `/internal` JWTs
- `CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES` — comma-separated allowed workforce/admin roles (defaults to `control-plane-admin,control-plane-workforce`)
- `CONTROL_PLANE_TRUST_PROXY` — `true`, `false`, or a trusted hop count for Express `trust proxy`; set this when `/portal` traffic arrives through an ingress/load balancer so per-client rate limiting uses forwarded client IPs
- `CUSTOMER_PORTAL_AUTH_MODE` — `local` (default) or `keycloak` for the public `/portal` contract; only `local` is implemented in this slice
- `CUSTOMER_PORTAL_DEFAULT_TENANT_VERSION` — optional default version assigned to portal-created tenants (defaults to the control-plane package version)
- `CONTROL_PLANE_ENABLE_PROVISIONING` — enables live Kubernetes/Postgres provisioning
- `TENANT_AUTH_MODE` — `local` (default) or `keycloak` for provisioned tenant pods
- `TENANT_KEYCLOAK_URL` — Keycloak base URL injected into tenant pods when `TENANT_AUTH_MODE=keycloak`
- `TENANT_KEYCLOAK_REALM` — tenant realm injected into tenant pods when `TENANT_AUTH_MODE=keycloak`
- `TENANT_KEYCLOAK_CLIENT_ID` — tenant web client ID injected into tenant pods when `TENANT_AUTH_MODE=keycloak`
- `TENANT_BASE_DOMAIN` — base domain for generated tenant hosts
- `TENANT_INGRESS_CLASS_NAME` — ingress class used for generated tenant Ingress resources (`nginx` by default)
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

Postgres-backed for this slice. The registry stores:
- Tenant registry (primary source of truth for tenant metadata)
- State transition audit log (full lifecycle history)

Hosted rollouts assume a fresh control-plane Postgres bootstrap. This slice does
not include an automated SQLite-to-Postgres migration path for pre-existing
control-plane registries; local/dev SQLite metadata should be recreated or
manually migrated only if an older non-production environment needs to keep it.

## Database Migrations

Schema changes are applied through the migration runner in `src/migrate.ts`,
backed by [umzug](https://github.com/sequelize/umzug) and namespaced migration
ledger tables. The control-plane owns two migration responsibilities:

- `apps/control-plane/migrations/` — registry schema for the control-plane
  database itself; applied automatically on boot before the HTTP server starts
  listening, recorded in `schema_migrations_control_plane`, and guarded by the
  advisory-lock pair `(930, 1)` so concurrent pods wait for in-flight runs.
- `apps/api/migrations/` — the authoritative tenant API schema; invoked from
  the provisioning path on each tenant database before the runtime role loses
  `CREATE`/`ALTER` access, recorded in `schema_migrations_tenant_api`, and
  guarded by the tenant API advisory-lock pair `(931, 1)`.

### Adding a migration

1. Create a new file `NNNN_short_name.sql` in the matching directory using the
   next sequential prefix.
2. Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and idempotent
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` so reruns are safe.
3. Migrations are **roll-forward only**: never rename or drop existing columns
   or tables that production code still reads. Use the expand/contract pattern
   (add the new shape, ship code that writes both, then remove the old shape
   in a follow-up release).
4. Each migration runs inside its own transaction with the advisory lock held,
   so a crashed pod leaves the database fully migrated or unchanged.

### Running migrations manually

```bash
CONTROL_PLANE_DATABASE_URL=postgres://... npm run db:migrate
```

The control-plane registry migrations also run automatically as part of
`TenantRegistry`'s boot so a freshly deployed pod self-applies pending changes.
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
