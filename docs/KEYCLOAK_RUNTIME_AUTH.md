# Keycloak Runtime Authentication

This repo runs two Keycloak-backed auth paths:

- **Tenant runtime auth** inside `apps/api` + `apps/web`
- **Control-plane admin auth** inside `apps/control-plane`

As of the Phase 2 exit (#318) the tenant runtime is Keycloak-only — there is no `AUTH_MODE` toggle and no local username/password fallback. The control-plane keeps a `CONTROL_PLANE_AUTH_MODE=static|keycloak` switch for the admin API, but customer-portal account auth is also Keycloak-only.

## Tenant runtime

`apps/web` reads `GET /api/auth/config`, signs in through Keycloak, then calls the API with a Keycloak bearer token. Required env on every tenant pod:

- `KEYCLOAK_URL`
- optional `KEYCLOAK_JWKS_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_TENANT_CLIENT_ID`

Important behavior:

- the backend validates JWTs against the realm JWKS endpoint;
- the backend then reconciles the identity onto the local tenant database via `owner_accounts.keycloak_sub`;
- campaign membership, site-admin checks, and note authorization remain tenant-local;
- guest/share-link routes stay anonymous/local and continue to use `X-Guest-Token`.

## Control-plane runtime

The control-plane admin API switches with `CONTROL_PLANE_AUTH_MODE`:

- `static` — `/internal/*` expects `CONTROL_PLANE_ADMIN_TOKEN`
- `keycloak` — `/internal/*` expects a Keycloak workforce/admin bearer JWT

Required control-plane env when `CONTROL_PLANE_AUTH_MODE=keycloak`:

- `CONTROL_PLANE_KEYCLOAK_URL`
- `CONTROL_PLANE_KEYCLOAK_REALM`
- `CONTROL_PLANE_KEYCLOAK_CLIENT_ID`
- optional `CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES` (defaults to `control-plane-admin,control-plane-workforce`)

The customer portal (`/portal/*` routes) is Keycloak-only and requires:

- `CUSTOMER_PORTAL_KEYCLOAK_URL`
- `CUSTOMER_PORTAL_KEYCLOAK_REALM`
- `CUSTOMER_PORTAL_KEYCLOAK_CLIENT_ID`
- optional `CUSTOMER_PORTAL_KEYCLOAK_JWKS_URL`

The control-plane also decides how new tenant pods boot:

- `TENANT_KEYCLOAK_URL`
- optional `TENANT_KEYCLOAK_JWKS_URL`
- `TENANT_KEYCLOAK_REALM`
- The per-tenant Keycloak client ID is derived automatically as `dnd-notes-tenant-{tenantId}` — it is not a configurable env var.

## Local k3d contract

`platform/k3d/keycloak.yaml` seeds one dev realm, `dnd-notes-dev`, with:

- tenant web client: `dnd-notes-tenant-app`
- control-plane admin client: `dnd-notes-control-plane`
- customer-portal client: `dnd-notes-customer-portal`
- tenant user: `owner@example.com` / `password`
- workforce user: `ops@example.com` / `password`
- site admin: `site-admin@example.com` / `password`

The k3d control-plane overlay enables both runtime paths with:

- `CONTROL_PLANE_AUTH_MODE=keycloak`
- `CONTROL_PLANE_KEYCLOAK_URL=https://keycloak.127.0.0.1.nip.io`
- `CONTROL_PLANE_KEYCLOAK_REALM=dnd-notes-dev`
- `CONTROL_PLANE_KEYCLOAK_CLIENT_ID=dnd-notes-control-plane`
- `CUSTOMER_PORTAL_KEYCLOAK_URL=https://keycloak.127.0.0.1.nip.io`
- `CUSTOMER_PORTAL_KEYCLOAK_REALM=dnd-notes-dev`
- `CUSTOMER_PORTAL_KEYCLOAK_CLIENT_ID=dnd-notes-customer-portal`
- `TENANT_KEYCLOAK_URL=https://keycloak.127.0.0.1.nip.io`
- `TENANT_KEYCLOAK_JWKS_URL=http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080/realms/dnd-notes-dev/protocol/openid-connect/certs`
- `TENANT_KEYCLOAK_REALM=dnd-notes-dev`
- Per-tenant client: derived automatically as `dnd-notes-tenant-{tenantId}` at provisioning time

The split matters in k3d: browsers and the local control-plane use the public
issuer URL (`https://keycloak.127.0.0.1.nip.io`), but tenant pods cannot
resolve `127.0.0.1` back to the host. They must fetch JWKS through the in-cluster
`platform-keycloak` Service instead.

## Hosted contract

Use separate workforce and tenant realms if you want stricter separation, but the runtime contract stays the same:

- `CONTROL_PLANE_KEYCLOAK_*` controls admin/workforce JWT validation
- `CUSTOMER_PORTAL_KEYCLOAK_*` controls portal-user JWT validation
- `TENANT_KEYCLOAK_*` controls what tenant pods publish through `/api/auth/config`
- tenant clients must allow the hosted tenant origins as redirect/web origins

## Local verification

### Get a workforce/admin token

```bash
curl -fsS \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode 'client_id=dnd-notes-control-plane' \
  --data-urlencode 'username=site-admin@example.com' \
  --data-urlencode 'password=password' \
  https://keycloak.127.0.0.1.nip.io/realms/dnd-notes-dev/protocol/openid-connect/token
```

### Get a tenant token

```bash
curl -fsS \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode 'client_id=dnd-notes-tenant-app' \
  --data-urlencode 'username=owner@example.com' \
  --data-urlencode 'password=password' \
  https://keycloak.127.0.0.1.nip.io/realms/dnd-notes-dev/protocol/openid-connect/token
```

### Smoke lane

`npm run k3d:smoke` proves all of the following in one loop:

1. cluster dependencies boot;
2. control-plane `/internal/*` accepts a real Keycloak workforce/admin JWT;
3. a tenant provisions successfully;
4. tenant `/api/auth/session` and `/api/campaigns` accept a real Keycloak tenant JWT.

## Compatibility notes

- `CONTROL_PLANE_AUTH_MODE=static` remains the default for the control-plane admin API.
- Tenant runtime auth is Keycloak-only since #318 — there is no `AUTH_MODE` env var anymore.
- Customer-portal account auth is Keycloak-only since #318 — there is no `CUSTOMER_PORTAL_AUTH_MODE` env var anymore.
- Anonymous share-link behavior is unchanged: guest tokens via `X-Guest-Token` continue to work without Keycloak.
- Campaign membership and authorization stay tenant-local; Keycloak only provides identity.
