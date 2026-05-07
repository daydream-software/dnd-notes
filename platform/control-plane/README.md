# Control-plane deployment artifacts

Issue `#43` now owns the committed deployment-artifact lane for the internal
control plane.

The goal is intentionally narrow:

- keep the fast `k3d:smoke` loop on a **local** control-plane process
- commit the **in-cluster** image + manifest set that future hosted rollouts need
- preserve the locked **same-origin per-tenant** production model

## Layout

- `base/` — service account, RBAC, runtime config, PVC, Service, Deployment
- `overlays/k3d/` — local-cluster values (`*.nip.io`, in-cluster Postgres, `:k3d` image tag)
- `overlays/hosted-reference/` — managed-cluster reference values (`https`, example base domain)

The control plane remains cluster-internal only. Tenant traffic still terminates
at each tenant host, where the app serves web + API from the same origin.
`TENANT_BASE_DOMAIN` plus `TENANT_PUBLIC_SCHEME` define that host model for the
resources the control plane provisions.

## Admin Authentication

The control-plane admin API can authenticate in two explicit runtime modes:

### Static Token Mode (`CONTROL_PLANE_AUTH_MODE=static`)

Uses `CONTROL_PLANE_ADMIN_TOKEN` from the Secret. The token is a hardcoded bearer token.

```bash
curl -H "Authorization: Bearer $CONTROL_PLANE_ADMIN_TOKEN" \
  http://localhost:3101/internal/tenants
```

### Keycloak Mode (`CONTROL_PLANE_AUTH_MODE=keycloak`)

The control-plane validates workforce/admin bearer JWTs from Keycloak.

- **Keycloak URL:** `CONTROL_PLANE_KEYCLOAK_URL`
- **Realm:** `CONTROL_PLANE_KEYCLOAK_REALM`
- **Client ID:** `CONTROL_PLANE_KEYCLOAK_CLIENT_ID` (for example `dnd-notes-control-plane`)
- **Accepted roles:** `CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES` (defaults to `control-plane-admin,control-plane-workforce`)
- **Token endpoint:** `{CONTROL_PLANE_KEYCLOAK_URL}/realms/{CONTROL_PLANE_KEYCLOAK_REALM}/protocol/openid-connect/token`
- **Local k3d flow:** password grant against seeded dev users for smoke/testing only

Example operator token fetch:

```bash
CONTROL_PLANE_TOKEN="$(curl -fsS \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode 'client_id=dnd-notes-control-plane' \
  --data-urlencode 'username=site-admin@example.com' \
  --data-urlencode 'password=password' \
  http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev/protocol/openid-connect/token \
  | jq -r '.access_token')"

curl -H "Authorization: Bearer ${CONTROL_PLANE_TOKEN}" \
  http://localhost:3101/internal/tenants
```

The control-plane service validates incoming bearer tokens against Keycloak JWKS. Set `CONTROL_PLANE_KEYCLOAK_JWKS_URL` when the control-plane pod needs a different network path to JWKS than the browser-facing issuer URL. Tenant runtime provisioning uses the separate `TENANT_AUTH_MODE` / `TENANT_KEYCLOAK_*` variables when it needs to inject Keycloak config into tenant pods. If tenant pods need a different network path for JWKS than the browser-facing issuer URL, set `TENANT_KEYCLOAK_JWKS_URL` as the server-side override.

## Local k3d rehearsal

```bash
npm run k3d:bootstrap
npm run k3d:build-control-plane-image
kubectl apply -k platform/control-plane/overlays/k3d
kubectl create secret generic dnd-notes-control-plane-secrets \
  -n dnd-notes-platform \
  --from-literal=CONTROL_PLANE_ADMIN_TOKEN='replace-with-local-token' \
  --from-literal=TENANT_DATABASE_ADMIN_URL='postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres' \
  --from-literal=TENANT_DATABASE_RUNTIME_URL='postgresql://runtime-template:placeholder@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n dnd-notes-platform rollout status deployment/dnd-notes-control-plane
kubectl -n dnd-notes-platform port-forward svc/dnd-notes-control-plane 3101:3001
```

The k3d overlay points the control plane at the in-cluster platform Postgres
service and uses the `ghcr.io/daydream-software/dnd-notes-control-plane:k3d`
image tag. Its committed Secret patch intentionally keeps placeholder values in
source control, so replace the Secret locally before expecting a healthy pod.
`TENANT_DATABASE_RUNTIME_URL` is only a connection template now: new tenants get
their own generated runtime role, password, and database name in the tenant pod
Secret.

The k3d overlay ConfigMap automatically sets:

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
- `TENANT_INGRESS_CLASS_NAME=nginx`

## Hosted reference overlay

The hosted reference overlay is deliberately boring:

- same namespace (`dnd-notes-platform`)
- HTTPS tenant hosts by default
- placeholder control-plane image tag via Kustomize `images`
- placeholder admin Postgres URL plus runtime-template URL that operators must replace
- placeholder bearer token values that must be replaced before apply
- placeholder Keycloak URL/realm/client env values for both control-plane and tenant runtime auth

Use it as the starting point for a managed-cluster rollout after image promotion.

For Keycloak integration in hosted environments:

1. Set `CONTROL_PLANE_KEYCLOAK_URL` / `TENANT_KEYCLOAK_URL` to your managed Keycloak instance (for example `https://auth.example.com`)
2. Configure a workforce/admin client (`dnd-notes-control-plane`) plus a tenant SPA client (`dnd-notes-tenant-app`) with the hosted redirect/web origins you need.
3. Ensure `CONTROL_PLANE_KEYCLOAK_REALM` / `TENANT_KEYCLOAK_REALM` match the intended workforce and tenant realms.
4. Set `CONTROL_PLANE_KEYCLOAK_JWKS_URL` and/or `TENANT_KEYCLOAK_JWKS_URL` only when in-cluster services cannot reach the public issuer host directly; otherwise leave them aligned with the default realm certs endpoints.
5. Override `TENANT_INGRESS_CLASS_NAME` if your cluster uses a controller other than `nginx` for tenant hosts.
6. Keep `CONTROL_PLANE_ADMIN_TOKEN` populated only if you intentionally want the static fallback mode available.

## Validation

```bash
npm run platform:validate
```

That command renders both overlays via `kubectl kustomize`, which is the same
manifest validation wired into GitHub Actions.
