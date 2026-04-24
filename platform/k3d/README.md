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
npm run k3d:full-stack-smoke
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

The bootstrap now seeds two public Keycloak clients for runtime authentication:

| Client | ID | Purpose |
| --- | --- | --- |
| Tenant app | `dnd-notes-tenant-app` | Tenant app OIDC/JWT flows |
| Control-plane workforce/admin | `dnd-notes-control-plane` | Control-plane admin API |

Seeded user accounts in the `dnd-notes-dev` realm:

| Account | Username | Password | Role |
| --- | --- | --- | --- |
| Admin console | `admin` | `admin` | Keycloak admin |
| Test realm owner | `owner@example.com` | `password` | Tenant owner |
| Test realm workforce operator | `ops@example.com` | `password` | Control-plane workforce |
| Test realm site admin | `site-admin@example.com` | `password` | Tenant owner + control-plane admin |

These checked-in credentials are **development-only** for the local k3d lane.
Never reuse them outside this local environment.

#### Testing Keycloak Runtime Auth Locally

1. **Verify Keycloak is running:**
   ```bash
   curl -s http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev | jq .enabled
   ```
   Should return `true`.

2. **Test tenant runtime Keycloak flow (when control-plane + tenant are running):**
    - Obtain a tenant access token for `dnd-notes-tenant-app` from the seeded Keycloak realm
    - Call the tenant API with `Authorization: Bearer <token>`
    - The backend validates the JWT and looks up or links the owner account by `keycloak_sub`
    - Guest/share-link routes still use `X-Guest-Token` and do not require Keycloak

3. **Test control-plane admin auth (when control-plane is running):**
    - Obtain a workforce/admin token using the seeded `dnd-notes-control-plane` client and a seeded user
    - Tenant provisioning endpoints require this valid admin/workforce JWT

#### Local k3d Control-Plane Setup with Keycloak

Update the control-plane secret after applying the k3d overlay:

```bash
kubectl create secret generic dnd-notes-control-plane-secrets \
  -n dnd-notes-platform \
  --from-literal=CONTROL_PLANE_ADMIN_TOKEN='local-admin-token' \
  --from-literal=TENANT_DATABASE_ADMIN_URL='postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres' \
  --from-literal=TENANT_DATABASE_RUNTIME_URL='postgresql://runtime-template:placeholder@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable' \
  --dry-run=client -o yaml | kubectl apply -f -
```

The k3d overlay ConfigMap automatically injects:
- `CONTROL_PLANE_AUTH_MODE=keycloak`
- `CONTROL_PLANE_KEYCLOAK_URL=http://keycloak.127.0.0.1.nip.io:8080`
- `CONTROL_PLANE_KEYCLOAK_JWKS_URL=http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080/realms/dnd-notes-dev/protocol/openid-connect/certs`
- `CONTROL_PLANE_KEYCLOAK_REALM=dnd-notes-dev`
- `CONTROL_PLANE_KEYCLOAK_CLIENT_ID=dnd-notes-control-plane`
- `TENANT_AUTH_MODE=keycloak`
- `TENANT_KEYCLOAK_URL=http://keycloak.127.0.0.1.nip.io:8080`
- `TENANT_KEYCLOAK_JWKS_URL=http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080/realms/dnd-notes-dev/protocol/openid-connect/certs`
- `TENANT_KEYCLOAK_REALM=dnd-notes-dev`
- `TENANT_KEYCLOAK_CLIENT_ID=dnd-notes-tenant-app`

`CONTROL_PLANE_KEYCLOAK_JWKS_URL` and `TENANT_KEYCLOAK_JWKS_URL` are intentionally
different from their browser-facing Keycloak URLs in k3d: the public hostname
resolves to `127.0.0.1`, which in-cluster pods cannot use to fetch JWKS. The
in-cluster Service URL keeps bearer-token validation working
inside the workload while the frontend still points users at the public issuer URL.

## Supported workflows

### 1. Fast provisioning/debug lane — `k3d:smoke`

`k3d:smoke` reuses the bootstrap lane, then:

1. builds the tenant runtime image from the repo `Dockerfile`
2. imports that image into k3d as `ghcr.io/daydream-software/dnd-notes:k3d`
3. port-forwards the platform Postgres service to the host for the local control plane's admin connection
4. starts the control plane locally with provisioning enabled against the active k3d kube context
5. creates a tenant through `POST /internal/tenants`
6. provisions the tenant through `POST /internal/tenants/:tenantId/provision`
7. waits for the tenant deployment to become ready and verifies `GET /ready` through a service port-forward
8. fetches a Keycloak workforce/admin token and exercises the live control-plane `/internal/*` path with it
9. fetches a Keycloak tenant token and exercises tenant `/api/auth/session` and `/api/campaigns`

The tenant workload itself does **not** use the host port-forward. The smoke lane injects an in-cluster runtime URL that points at `platform-postgres.dnd-notes-platform.svc.cluster.local:5432`, while the local control-plane process keeps using the host-forwarded admin URL to create/drop per-tenant databases.

By default the smoke script deprovisions the tenant during cleanup. Set `KEEP_K3D_SMOKE_TENANT=true` if you want to keep the tenant namespace around for debugging.

That means the fast smoke lane proves the runtime JWT validation seam, not only
cluster boot and readiness.

### 2. Full-stack platform lane — `k3d:full-stack-smoke`

Issue `#79` adds a second lane for the full current platform shape.

`k3d:full-stack-smoke` reuses the same tenant image/bootstrap inputs, then:

1. builds/imports both the tenant and control-plane images
2. deploys the control plane in-cluster from `platform/control-plane/overlays/k3d`
3. provisions a tenant through the **operator portal** UI surface (via a small
   jsdom-based harness that drives the actual portal component instead of
   skipping straight to a raw manifest path)
4. waits for the tenant rollout to finish
5. verifies `GET /ready`, `GET /api/auth/session`, and `GET /api/campaigns`
   through the tenant ingress host (`http://<subdomain>.127.0.0.1.nip.io:8080`)

This lane is the supported answer for:

- “does the current k3d platform actually work end to end?”
- “did a change break the real operator → control-plane → tenant ingress path?”

The script honors `KEEP_K3D_SMOKE_TENANT=true` just like the fast lane, and
`K3D_SMOKE_OUTPUT=json` when another script needs a machine-readable tenant
summary.

### 3. Live component override lane — `k3d:tenant-api-override`

The supported component-level override today is **tenant-api only**:

1. start or reuse a tenant on k3d
2. read that tenant’s runtime Secret/ConfigMap from Kubernetes
3. run `apps/api` locally in watch mode against the live tenant database/runtime auth config
4. expose a local same-origin front proxy
5. keep browser/document traffic on the k3d tenant host while routing `/api/*`
    (plus probe paths) to the local API process

When that tenant ConfigMap carries an in-cluster `KEYCLOAK_JWKS_URL`
(`*.svc.cluster.local`), the override launcher intentionally drops it for the
host-side `apps/api` process so runtime auth falls back to
`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`.

The proxy adds `x-dnd-notes-override-target` so the workflow can prove which side
served each request:

| Path | Target |
| --- | --- |
| `/`, `/assets/*`, browser document routes | k3d tenant host |
| `/api/*`, `/ready`, `/readyz`, `/health`, `/healthz` | local `apps/api` |

The override launcher performs the proof automatically by comparing the proxied
root document against the live k3d tenant host and comparing proxied `/api/*`
responses against the local API process.

## Why the fast lane still keeps the control plane local

That is deliberate scope control, not a missing piece:

- `#63` formalizes the local **cluster dependencies** and a real provisioning rehearsal
- issue `#43` now carries the committed control-plane image + manifest lane under `platform/control-plane/`
- the daily smoke path still keeps the control plane local because that is the fastest feedback loop for provisioning/debugging

So the daily fast loop remains: **live cluster + local control-plane process**.
Use `k3d:full-stack-smoke` when you specifically need the in-cluster artifact set
plus ingress-backed tenant proof.

## Environment overrides

All three scripts honor a few env overrides when you need a different local shape:

| Variable | Default | Purpose |
| --- | --- | --- |
| `K3D_CLUSTER_NAME` | `dnd-notes` | k3d cluster name |
| `K3D_K3S_IMAGE` | `rancher/k3s:v1.35.3-k3s1` | pinned k3s image used by the local cluster |
| `K3D_K3S_PULL_RETRIES` | `3` | retries for pre-pulling the pinned k3s image before `k3d cluster create` (`0` disables the pre-pull step) |
| `K3D_K3S_PULL_TIMEOUT_SECONDS` | `180` | timeout for each `docker pull` attempt of the k3s image |
| `K3D_K3S_PULL_RETRY_DELAY_SECONDS` | `5` | delay between failed k3s image pull attempts |
| `INGRESS_NGINX_MANIFEST_PATH` | `platform/k3d/ingress-nginx-controller-v1.12.1.yaml` | local ingress-nginx manifest consumed by bootstrap |
| `K3D_IMAGE_IMPORT_MODE` | `direct` | primary k3d image import mode for local image loads |
| `K3D_IMAGE_IMPORT_FALLBACK_MODE` | `tools` | retry mode used if the primary import stalls or fails |
| `K3D_IMAGE_IMPORT_TIMEOUT_SECONDS` | `180` | per-import timeout (when `timeout` is available) before the fallback mode is tried |
| `K3D_HTTP_PORT` | `8080` | host HTTP port for ingress |
| `K3D_HTTPS_PORT` | `8443` | host HTTPS port for ingress |
| `TENANT_IMAGE_REPOSITORY` | `ghcr.io/daydream-software/dnd-notes` | tenant image repository |
| `TENANT_IMAGE_TAG` | `k3d` | tenant image tag used by the smoke lane |
| `CONTROL_PLANE_PORT` | `3101` | local smoke control-plane port |
| `POSTGRES_LOCAL_PORT` | `55432` | local port-forward for platform Postgres |
| `TENANT_DATABASE_RUNTIME_URL` | `postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres` | in-cluster Postgres URL injected into tenant pods |
| `TENANT_LOCAL_PORT` | `38080` | local port-forward for the smoke tenant |
| `KEEP_K3D_SMOKE_TENANT` | `false` | keep the provisioned tenant for debugging |
| `K3D_SMOKE_OUTPUT` | `text` | set to `json` for machine-readable full-stack smoke output |
| `K3D_TENANT_OVERRIDE_LOCAL_API_PORT` | `3001` | local `apps/api` port for tenant override |
| `K3D_TENANT_OVERRIDE_LISTEN_PORT` | `38080` | public port for the tenant override front proxy |
| `K3D_TENANT_OVERRIDE_NAMESPACE` | derived | reuse an existing tenant namespace for the override lane |
| `K3D_TENANT_OVERRIDE_SUBDOMAIN` | derived | reuse an existing tenant subdomain for the override lane |

## k3d vs later k3s/stateful rehearsal scope

The k3d workflows in this repo now cover:

- fast local provisioning rehearsal through the real control-plane API
- full-stack operator-portal-driven provisioning against the in-cluster control plane
- tenant namespace/PVC/Service/Deployment creation in Kubernetes
- per-tenant Postgres database creation
- ingress-backed tenant request validation
- local Keycloak availability and realm seeding
- tenant-api local override while tenant web stays on k3d

## Supported vs unsupported override boundaries

**Supported today**

- `tenant-api` locally in watch mode while tenant web stays on k3d, using the
  front-proxy workflow above

**Not supported today**

- swapping `tenant-web` alone while keeping the in-cluster API as the only live backend
- hot-swapping arbitrary in-cluster services by editing ingress/controller state directly
- control-plane live overrides through the tenant ingress hostname

Those unsupported cases all hit the same current constraint: the shipped tenant
runtime is still one Kubernetes Service/Deployment backed by a single `web + api`
container image. The supported `tenant-api` override works because the front
proxy splits traffic **in front of** that runtime without pretending the cluster
topology has already been decomposed.

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
