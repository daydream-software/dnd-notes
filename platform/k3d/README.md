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
- `ingress-nginx`
- a platform Postgres instance in `dnd-notes-platform`
- a seeded Keycloak instance in `dnd-notes-platform`

Keycloak is exposed at:

```text
http://keycloak.127.0.0.1.nip.io:8080
```

Keycloak now gets that full external URL injected during bootstrap so its own
redirects keep the mapped host port instead of collapsing back to plain
`http://keycloak.127.0.0.1.nip.io/`.

Seeded credentials:

| Account | Username | Password |
| --- | --- | --- |
| Admin console | `admin` | `admin` |
| Test realm user | `owner@example.com` | `password` |
| Test realm site admin | `site-admin@example.com` | `password` |

The imported realm is `dnd-notes-dev`. This keeps the local auth provider present in the standard k3d loop even though tenant/control-plane OIDC wiring itself still belongs to `#56`.

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

## Why the control plane still runs locally here

That is deliberate scope control, not a missing piece:

- `#63` formalizes the local **cluster dependencies** and a real provisioning rehearsal
- the repo does **not** yet have a committed control-plane container/deployment artifact lane
- that wider packaging/deployment shape still belongs with the deployment-artifact follow-up work, not this issue

So the daily k3d loop today is: **live cluster + local control-plane process**.

## Environment overrides

Both scripts honor a few env overrides when you need a different local shape:

| Variable | Default | Purpose |
| --- | --- | --- |
| `K3D_CLUSTER_NAME` | `dnd-notes` | k3d cluster name |
| `K3D_K3S_IMAGE` | `rancher/k3s:v1.35.3-k3s1` | pinned k3s image used by the local cluster |
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
