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

The control-plane admin API can authenticate in two modes:

### Static Token Mode (`AUTH_MODE=local`)

Uses `CONTROL_PLANE_ADMIN_TOKEN` from the Secret. The token is a hardcoded bearer token.

```bash
curl -H "Authorization: Bearer $CONTROL_PLANE_ADMIN_TOKEN" \
  http://localhost:3101/internal/tenants
```

### Keycloak Mode (`AUTH_MODE=keycloak`)

The control-plane obtains a bearer token from Keycloak using the `dnd-notes-control-plane` service-account credentials, then includes it in admin API requests.

- **Client ID:** `KEYCLOAK_CONTROL_PLANE_CLIENT_ID` (e.g., `dnd-notes-control-plane`)
- **Client Secret:** `KEYCLOAK_CONTROL_PLANE_CLIENT_SECRET` (from Kubernetes Secret)
- **Token endpoint:** `{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token`
- **Grant type:** `client_credentials`

The control-plane obtains the token automatically and validates incoming bearer tokens against the public key from Keycloak.

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
  --from-literal=KEYCLOAK_TENANT_CLIENT_SECRET='dnd-notes-tenant-app-secret-k3d-dev-only' \
  --from-literal=KEYCLOAK_CONTROL_PLANE_CLIENT_SECRET='dnd-notes-control-plane-secret-k3d-dev-only' \
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
- `AUTH_MODE=keycloak`
- `KEYCLOAK_URL=http://keycloak.127.0.0.1.nip.io:8080`
- `KEYCLOAK_REALM=dnd-notes-dev`
- `KEYCLOAK_CONTROL_PLANE_CLIENT_ID=dnd-notes-control-plane`

## Hosted reference overlay

The hosted reference overlay is deliberately boring:

- same namespace (`dnd-notes-platform`)
- HTTPS tenant hosts by default
- placeholder control-plane image tag via Kustomize `images`
- placeholder admin Postgres URL plus runtime-template URL that operators must replace
- placeholder bearer token values that must be replaced before apply
- placeholder Keycloak secrets that must be replaced if `AUTH_MODE=keycloak`

Use it as the starting point for a managed-cluster rollout after image promotion.

For Keycloak integration in hosted environments:
1. Set `KEYCLOAK_URL` to your managed Keycloak instance (e.g., `https://auth.example.com`)
2. Create client `dnd-notes-control-plane` in your Keycloak realm with service-account enabled
3. Update the Secret with the real client secret
4. Ensure `KEYCLOAK_REALM` matches your realm name (e.g., `dnd-notes-prod`)

## Validation

```bash
npm run platform:validate
```

That command renders both overlays via `kubectl kustomize`, which is the same
manifest validation wired into GitHub Actions.

