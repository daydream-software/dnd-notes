# Keycloak Runtime Authentication

This repo supports two runtime auth paths:

- **Tenant runtime auth** inside `apps/api` + `apps/web`
- **Control-plane admin auth** inside `apps/control-plane`

## Tenant runtime

Tenant pods switch with `AUTH_MODE`:

- `AUTH_MODE=local` — legacy owner registration/login + database-backed owner sessions
- `AUTH_MODE=keycloak` — web reads `GET /api/auth/config`, signs in through Keycloak, then calls the API with a Keycloak bearer token

Required tenant env when `AUTH_MODE=keycloak`:

- `KEYCLOAK_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_TENANT_CLIENT_ID`

Important behavior:

- the backend validates JWTs against the realm JWKS endpoint;
- the backend then reconciles the identity onto the local tenant database via `owner_accounts.keycloak_sub`;
- campaign membership, site-admin checks, and note authorization remain tenant-local;
- guest/share-link routes stay anonymous/local and continue to use `X-Guest-Token`.

## Control-plane runtime

The control-plane switches with `CONTROL_PLANE_AUTH_MODE`:

- `static` — `/internal/*` expects `CONTROL_PLANE_ADMIN_TOKEN`
- `keycloak` — `/internal/*` expects a Keycloak workforce/admin bearer JWT

Required control-plane env when `CONTROL_PLANE_AUTH_MODE=keycloak`:

- `CONTROL_PLANE_KEYCLOAK_URL`
- `CONTROL_PLANE_KEYCLOAK_REALM`
- `CONTROL_PLANE_KEYCLOAK_CLIENT_ID`
- optional `CONTROL_PLANE_KEYCLOAK_REQUIRED_ROLES` (defaults to `control-plane-admin,control-plane-workforce`)

The control-plane also decides how new tenant pods boot:

- `TENANT_AUTH_MODE=local|keycloak`
- `TENANT_KEYCLOAK_URL`
- `TENANT_KEYCLOAK_REALM`
- `TENANT_KEYCLOAK_CLIENT_ID`

## Local k3d contract

`platform/k3d/keycloak.yaml` seeds one dev realm, `dnd-notes-dev`, with:

- tenant web client: `dnd-notes-tenant-app`
- control-plane admin client: `dnd-notes-control-plane`
- tenant user: `owner@example.com` / `password`
- workforce user: `ops@example.com` / `password`
- site admin: `site-admin@example.com` / `password`

The k3d control-plane overlay enables both runtime paths with:

- `CONTROL_PLANE_AUTH_MODE=keycloak`
- `CONTROL_PLANE_KEYCLOAK_URL=http://keycloak.127.0.0.1.nip.io:8080`
- `CONTROL_PLANE_KEYCLOAK_REALM=dnd-notes-dev`
- `CONTROL_PLANE_KEYCLOAK_CLIENT_ID=dnd-notes-control-plane`
- `TENANT_AUTH_MODE=keycloak`
- `TENANT_KEYCLOAK_URL=http://keycloak.127.0.0.1.nip.io:8080`
- `TENANT_KEYCLOAK_REALM=dnd-notes-dev`
- `TENANT_KEYCLOAK_CLIENT_ID=dnd-notes-tenant-app`

## Hosted contract

Use separate workforce and tenant realms if you want stricter separation, but the runtime contract stays the same:

- `CONTROL_PLANE_KEYCLOAK_*` controls admin/workforce JWT validation
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
  http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev/protocol/openid-connect/token
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
  http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev/protocol/openid-connect/token
```

### Smoke lane

`npm run k3d:smoke` now proves all of the following in one loop:

1. cluster dependencies boot;
2. control-plane `/internal/*` accepts a real Keycloak workforce/admin JWT;
3. a tenant provisions successfully;
4. tenant `/api/auth/session` and `/api/campaigns` accept a real Keycloak tenant JWT.

## Compatibility notes

- `AUTH_MODE=local` remains the default for tenant apps.
- `CONTROL_PLANE_AUTH_MODE=static` remains the default for the control-plane.
- Switching tenants to Keycloak does **not** remove anonymous share-link behavior.
- Switching tenants to Keycloak does **not** make campaign membership global; authorization still lives in each tenant database.
