# k3d platform development lane

Issue `#63` formalizes the fast local Kubernetes loop for platform work.

This lane intentionally uses **k3d for daily iteration** and keeps the control plane running locally against the live kube context. That gives us a real cluster-backed provisioning rehearsal without widening into the still-separate in-cluster packaging work.

## Prerequisites

- Docker
- `k3d`
- `kubectl`
- Node `22.21.1`
- repo dependencies installed via `npm install`

## Quick start

```bash
npm run k3d:bootstrap
npm run k3d:smoke
```

The same smoke lane now runs in GitHub Actions via
`.github/workflows/k3d-smoke.yml`. That workflow installs `k3d` and `kubectl`,
executes `npm run k3d:smoke`, uploads cluster diagnostics, and tears the test
cluster down at the end of the job.

## What `k3d:bootstrap` provisions

- a k3d cluster pinned to `rancher/k3s:v1.35.3-k3s1` with Traefik disabled and host ports `8080`/`8443` mapped to the load balancer
- a vendored `ingress-nginx` controller manifest pinned to controller `v1.12.1`
- a platform Postgres instance in `dnd-notes-platform` pinned to `postgres:17.9-bookworm`
- a seeded Keycloak instance in `dnd-notes-platform`

Keycloak is exposed at:

```text
http://keycloak.127.0.0.1.nip.io:8080
```

Keycloak now gets that full external URL injected during bootstrap so its own
redirects keep the mapped host port instead of collapsing back to plain
`http://keycloak.127.0.0.1.nip.io/`.

### Keycloak Runtime Auth Setup

The bootstrap now seeds two Keycloak clients for runtime authentication:

| Client | ID | Secret | Purpose |
| --- | --- | --- | --- |
| Tenant app | `dnd-notes-tenant-app` | `dnd-notes-tenant-app-secret-k3d-dev-only` | Tenant app OIDC/JWT flows |
| Control-plane admin | `dnd-notes-control-plane` | `dnd-notes-control-plane-secret-k3d-dev-only` | Control-plane admin API |

Seeded user accounts in the `dnd-notes-dev` realm:

| Account | Username | Password | Role |
| --- | --- | --- | --- |
| Admin console | `admin` | `admin` | Keycloak admin |
| Test realm owner | `owner@example.com` | `password` | Tenant owner |
| Test realm site admin | `site-admin@example.com` | `password` | Tenant owner + control-plane admin |

These checked-in credentials are **development-only** for the local k3d lane.
Never reuse them outside this local environment.

#### Testing Keycloak Runtime Auth Locally

1. **Verify Keycloak is running:**
   ```bash
   curl -s http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev | jq .enabled
   ```
   Should return `true`.

2. **Test tenant app Keycloak flow (when control-plane + tenant are running):**
   - Navigate to your tenant app (e.g., `http://tenant-abc.127.0.0.1.nip.io:8080`)
   - If `AUTH_MODE=keycloak` is set, click "Log in with Keycloak"
   - Use `owner@example.com` / `password` to authenticate
   - The frontend receives ID + access tokens from Keycloak
   - The backend validates the JWT and looks up the owner account by `keycloak_sub`

3. **Test control-plane admin auth (when control-plane is running):**
   - The control-plane obtains an admin token using `dnd-notes-control-plane` service-account credentials
   - Tenant provisioning endpoints require this valid admin JWT

#### Local k3d Control-Plane Setup with Keycloak

Update the control-plane secret after applying the k3d overlay to use the seeded Keycloak secrets:

```bash
kubectl create secret generic dnd-notes-control-plane-secrets \
  -n dnd-notes-platform \
  --from-literal=CONTROL_PLANE_ADMIN_TOKEN='local-admin-token' \
  --from-literal=TENANT_DATABASE_ADMIN_URL='postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres' \
  --from-literal=TENANT_DATABASE_RUNTIME_URL='postgresql://runtime-template:placeholder@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable' \
  --from-literal=KEYCLOAK_TENANT_CLIENT_SECRET='dnd-notes-tenant-app-secret-k3d-dev-only' \
  --from-literal=KEYCLOAK_CONTROL_PLANE_CLIENT_SECRET='dnd-notes-control-plane-secret-k3d-dev-only' \
  --dry-run=client -o yaml | kubectl apply -f -
```

The k3d overlay ConfigMap automatically injects:
- `KEYCLOAK_URL=http://keycloak.127.0.0.1.nip.io:8080`
- `KEYCLOAK_REALM=dnd-notes-dev`
- `KEYCLOAK_TENANT_CLIENT_ID=dnd-notes-tenant-app`
- `KEYCLOAK_CONTROL_PLANE_CLIENT_ID=dnd-notes-control-plane`
- `AUTH_MODE=keycloak`

## What `k3d:smoke` proves

`k3d:smoke` reuses the bootstrap lane, then:

1. builds the tenant runtime image from the repo `Dockerfile`
2. imports that image into k3d as `ghcr.io/daydream-software/dnd-notes:k3d`
3. port-forwards the platform Postgres service to the host for the local control plane's admin connection
4. starts the control plane locally with provisioning enabled against the active k3d kube context
5. creates a tenant through `POST /internal/tenants`
6. provisions the tenant through `POST /internal/tenants/:tenantId/provision`
7. waits for the tenant deployment to become ready and verifies `GET /ready` through a service port-forward

The tenant workload itself does **not** use the host port-forward. The smoke lane injects an in-cluster runtime URL that points at `platform-postgres.dnd-notes-platform.svc.cluster.local:5432`, while the local control-plane process keeps using the host-forwarded admin URL to create/drop per-tenant databases.

By default the smoke script deprovisions the tenant during cleanup. Set `KEEP_K3D_SMOKE_TENANT=true` if you want to keep the tenant namespace around for debugging.

**Note:** The smoke lane does not currently exercise the full Keycloak runtime auth flow (JWT login + token validation); that is covered by end-to-end auth tests in the tenant app and control-plane test suites.

## Why the control plane still runs locally here

That is deliberate scope control, not a missing piece:

- `#63` formalizes the local **cluster dependencies** and a real provisioning rehearsal
- issue `#43` now carries the committed control-plane image + manifest lane under `platform/control-plane/`
- the daily smoke path still keeps the control plane local because that is the fastest feedback loop for provisioning/debugging

So the daily k3d loop today is still: **live cluster + local control-plane process**.
When you need to rehearse the in-cluster artifact set itself, use:

```bash
npm run k3d:build-control-plane-image
kubectl apply -k platform/control-plane/overlays/k3d
```

## Environment overrides

Both scripts honor a few env overrides when you need a different local shape:

| Variable | Default | Purpose |
| --- | --- | --- |
| `K3D_CLUSTER_NAME` | `dnd-notes` | k3d cluster name |
| `K3D_K3S_IMAGE` | `rancher/k3s:v1.35.3-k3s1` | pinned k3s image used by the local cluster |
| `INGRESS_NGINX_MANIFEST_PATH` | `platform/k3d/ingress-nginx-controller-v1.12.1.yaml` | local ingress-nginx manifest consumed by bootstrap |
| `K3D_IMAGE_IMPORT_MODE` | `direct` | k3d image import mode for the tenant image; `direct` avoids the flaky tarball-based tools-node path seen in CI |
| `K3D_HTTP_PORT` | `8080` | host HTTP port for ingress |
| `K3D_HTTPS_PORT` | `8443` | host HTTPS port for ingress |
| `TENANT_IMAGE_REPOSITORY` | `ghcr.io/daydream-software/dnd-notes` | tenant image repository |
| `TENANT_IMAGE_TAG` | `k3d` | tenant image tag used by the smoke lane |
| `CONTROL_PLANE_PORT` | `3101` | local smoke control-plane port |
| `POSTGRES_LOCAL_PORT` | `55432` | local port-forward for platform Postgres |
| `TENANT_DATABASE_RUNTIME_URL` | `postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres` | in-cluster Postgres URL injected into tenant pods |
| `TENANT_LOCAL_PORT` | `38080` | local port-forward for the smoke tenant |
| `KEEP_K3D_SMOKE_TENANT` | `false` | keep the provisioned tenant for debugging |

## k3d vs later k3s/stateful rehearsal scope

The daily k3d loop **covers**:

- cluster-backed provisioning through the real control-plane API
- tenant namespace/PVC/Service/Deployment creation in Kubernetes
- per-tenant Postgres database creation
- tenant readiness validation
- ingress-nginx availability
- local Keycloak availability and realm seeding

The later k3s / managed-cluster rehearsals still own:

- wildcard DNS + cert-manager / TLS choreography
- backup/restore drills and other heavy persistence rehearsals
- node restarts, PVC survival, and other stateful failure-mode testing
- full in-cluster control-plane packaging/deployment shape
- OIDC request flows and token validation once `#56` starts

## Kubernetes version policy for this lane

The k3d lane is now **explicitly pinned** instead of inheriting whatever default
Kubernetes version happens to ship with the installed `k3d` binary. The current
default is `rancher/k3s:v1.35.3-k3s1`, which keeps local workstations and the CI
smoke workflow on the same supported Kubernetes minor. When we advance the lane
again, update both `K3D_K3S_IMAGE` in `scripts/k3d/bootstrap.sh` and the
matching CI env in `.github/workflows/k3d-smoke.yml`.

The lane also vendors the ingress-nginx manifest in-repo and pins Postgres to a
specific patch tag so local and CI smoke runs do not drift on external defaults.
