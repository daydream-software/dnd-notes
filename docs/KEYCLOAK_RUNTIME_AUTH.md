# Keycloak Runtime Authentication Integration

This guide documents how Keycloak runtime authentication works across the dnd-notes platform: tenant app OIDC flows, control-plane admin API validation, and configuration for both local k3d and hosted environments.

## Overview

**Issue #76** implements the runtime Keycloak integration that issue #56 prepared the schema for. When enabled, tenant apps and the control-plane can authenticate using Keycloak JWTs instead of local session tokens.

### Two Authentication Modes

- **`AUTH_MODE=local`** (default, legacy)  
  Tenant apps use traditional email/password login + session tokens. Control-plane uses static bearer token. No Keycloak required.

- **`AUTH_MODE=keycloak`**  
  Tenant apps authenticate via Keycloak OIDC. Control-plane validates Keycloak admin/workforce JWTs. Requires Keycloak instance + client setup.

### Key Design Decisions

1. **Guest/share-link flows remain local and anonymous** — they do not require authentication and continue to work regardless of auth mode.
2. **Tenant app auth validates JWT, then looks up owner account by `keycloak_sub`** — the `keycloak_sub` column (from #56) enables mapping Keycloak identities to local owner accounts.
3. **Control-plane admin API validates bearer tokens from Keycloak** — using the `dnd-notes-control-plane` service-account client.
4. **Realm and client configuration is committed to k3d bootstrap** — making local dev reproducible without manual Keycloak setup.

---

## Architecture

### Tenant App OIDC Flow (Runtime)

When a tenant app has `AUTH_MODE=keycloak`:

```
User Browser                  Tenant App (Frontend)             Tenant App (Backend)              Keycloak
    |                               |                                   |                            |
    |---(1) "Log in with KC"------->|                                   |                            |
    |                               |---(2) Redirect to KC login--------|----(2) Redirect----->|
    |                               |                                   |                            |
    |                               |<----(3) User authenticates on KC console<----|
    |                               |                                   |                            |
    |                               |<---(4) Auth code + redirect back--|----(4) Redirect----|
    |                               |                                   |                            |
    |                               |---(5) Exchange code for JWT--->|                            |
    |                               |                   (using KEYCLOAK_TENANT_CLIENT_SECRET)    |
    |                               |<---(6) ID token + access token--|----(6) Return JWT-------|
    |                               |                                   |                            |
    |---(7) API call + JWT token--->|                                   |                            |
    |                               |---(8) GET /api/campaigns + JWT--->|                          |
    |                               |        (Authorization: Bearer JWT)                            |
    |                               |                                   |                          |
    |                               |                   (9) Backend validates JWT signature       |
    |                               |                       using KEYCLOAK_REALM public key       |
    |                               |                                   |                          |
    |                               |                   (10) Backend looks up owner_accounts      |
    |                               |                        row by keycloak_sub = <sub claim>    |
    |                               |                                   |                          |
    |                               |<---(11) If valid, return campaign data--|                |
```

**Key points:**
- Step 5–6: Frontend exchanges the auth code for an access token (containing `keycloak_sub`).
- Steps 9–10: Backend validates the JWT signature, extracts `keycloak_sub` claim, and looks up the owner account.
- If the owner account exists and is enabled, the request proceeds with that owner's identity.

### Control-Plane Admin API Authentication

When `AUTH_MODE=keycloak`:

```
Control-plane Process          Keycloak Token Endpoint              Keycloak Public Key Endpoint
    |                               |                                       |
    |---(1) Get admin token-------->|                                       |
    |   (client_credentials grant)  |                                       |
    |   Client ID: dnd-notes-control-plane                                  |
    |   Client Secret: KEYCLOAK_CONTROL_PLANE_CLIENT_SECRET                 |
    |                               |                                       |
    |<---(2) Return JWT token------|                                       |
    |       (with admin role claim)  |                                       |
    |                               |                                       |
    |---(3) Use token in request--->|                                       |
    |   Bearer <admin_jwt>           |                                       |
    |                               |                                       |
    |---(4) If needed, fetch public keys for rotation-->|                  |
    |                                                   |                  |
    |<---(5) Return JWKS (public keys)----|             |
    |       (can be cached locally)                     |
```

**Key points:**
- Control-plane uses service-account credentials (not user login).
- Token is obtained at startup or on refresh.
- Admin API endpoints validate the bearer token signature against cached public keys.

---

## Configuration

### Environment Variables

#### For Tenant Apps

When running a tenant pod with `AUTH_MODE=keycloak`:

| Variable | Example (k3d) | Example (hosted) | Purpose |
| --- | --- | --- | --- |
| `AUTH_MODE` | `keycloak` | `keycloak` | Enable Keycloak auth |
| `KEYCLOAK_URL` | `http://keycloak.127.0.0.1.nip.io:8080` | `https://auth.example.com` | Keycloak base URL |
| `KEYCLOAK_REALM` | `dnd-notes-dev` | `dnd-notes-prod` | Realm name |
| `KEYCLOAK_TENANT_CLIENT_ID` | `dnd-notes-tenant-app` | `dnd-notes-tenant-app` | Client ID for OIDC flows |
| `KEYCLOAK_TENANT_CLIENT_SECRET` | (in Secret) | (in Secret) | Backend JWT validation secret |

#### For Control-Plane

When running the control-plane with `AUTH_MODE=keycloak`:

| Variable | Example (k3d) | Example (hosted) | Purpose |
| --- | --- | --- | --- |
| `AUTH_MODE` | `keycloak` | `keycloak` | Enable Keycloak auth |
| `KEYCLOAK_URL` | `http://keycloak.127.0.0.1.nip.io:8080` | `https://auth.example.com` | Keycloak base URL |
| `KEYCLOAK_REALM` | `dnd-notes-dev` | `dnd-notes-prod` | Realm name |
| `KEYCLOAK_CONTROL_PLANE_CLIENT_ID` | `dnd-notes-control-plane` | `dnd-notes-control-plane` | Service account client ID |
| `KEYCLOAK_CONTROL_PLANE_CLIENT_SECRET` | (in Secret) | (in Secret) | Service account client secret |

### Local k3d Setup

The k3d bootstrap seeds the Keycloak realm with required clients and test users:

#### Realm: `dnd-notes-dev`

**Clients:**
- `dnd-notes-tenant-app` (public client)
  - Secret: `dnd-notes-tenant-app-secret-k3d-dev-only`
  - Enabled for OIDC code flow
  - Redirect URIs: `http://tenant-*.127.0.0.1.nip.io:8080/*`, `http://localhost:5173/*`, `http://localhost:3000/*`

- `dnd-notes-control-plane` (service-account client)
  - Secret: `dnd-notes-control-plane-secret-k3d-dev-only`
  - Service accounts enabled
  - Has `admin` role

**Test Users:**
- `owner@example.com` / `password` — regular tenant owner
- `site-admin@example.com` / `password` — tenant owner + control-plane admin (has `admin` role)

#### Control-Plane K3d ConfigMap

The k3d control-plane overlay (`platform/control-plane/overlays/k3d/configmap-patch.yaml`) automatically injects:

```yaml
KEYCLOAK_URL: http://keycloak.127.0.0.1.nip.io:8080
KEYCLOAK_REALM: dnd-notes-dev
KEYCLOAK_TENANT_CLIENT_ID: dnd-notes-tenant-app
KEYCLOAK_CONTROL_PLANE_CLIENT_ID: dnd-notes-control-plane
AUTH_MODE: keycloak
```

To use it locally, update the Secret with the k3d Keycloak secrets:

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

### Hosted/Managed Environment Setup

For a managed Keycloak instance (e.g., hosted on AWS Cognito, Auth0, or a managed Keycloak cluster):

1. **Create or use an existing realm** (e.g., `dnd-notes-prod`)

2. **Create the tenant app client:**
   - Client ID: `dnd-notes-tenant-app`
   - Type: Public (or Confidential with secret)
   - Enabled: Standard flow, authorization code grant
   - Redirect URIs: `https://tenant-*.example.com/*`, `https://tenant-*.example.com`
   - Web Origins: Allow CORS from tenant origins

3. **Create the control-plane service-account client:**
   - Client ID: `dnd-notes-control-plane`
   - Type: Confidential
   - Service accounts enabled
   - Assign admin/workforce role (varies by Keycloak setup)

4. **Update hosted control-plane overlay:**
   - `platform/control-plane/overlays/hosted-reference/configmap-patch.yaml`:
     ```yaml
     KEYCLOAK_URL: https://auth.example.com
     KEYCLOAK_REALM: dnd-notes-prod
     KEYCLOAK_TENANT_CLIENT_ID: dnd-notes-tenant-app
     KEYCLOAK_CONTROL_PLANE_CLIENT_ID: dnd-notes-control-plane
     AUTH_MODE: keycloak
     ```
   - `platform/control-plane/overlays/hosted-reference/secret-patch.yaml`:
     ```yaml
     KEYCLOAK_TENANT_CLIENT_SECRET: <your-tenant-client-secret>
     KEYCLOAK_CONTROL_PLANE_CLIENT_SECRET: <your-service-account-secret>
     ```

---

## Testing the Integration

### Local k3d Test Flow

1. **Start k3d with Keycloak:**
   ```bash
   npm run k3d:bootstrap
   ```

2. **Verify Keycloak is healthy:**
   ```bash
   curl -s http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev | jq .enabled
   # Should return: true
   ```

3. **Start the control-plane locally (or in-cluster):**
   ```bash
   npm run k3d:build-control-plane-image
   kubectl apply -k platform/control-plane/overlays/k3d
   ```
   (Update the Secret with k3d Keycloak credentials as shown above.)

4. **Provision a tenant:**
   ```bash
   # Create tenant
   curl -X POST http://localhost:3101/internal/tenants \
     -H "Authorization: Bearer $CONTROL_PLANE_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name": "Test Tenant", "databaseName": "test_tenant"}'
   
   # Provision it (Control-plane obtains Keycloak admin token internally)
   curl -X POST http://localhost:3101/internal/tenants/{tenantId}/provision \
     -H "Authorization: Bearer $CONTROL_PLANE_ADMIN_TOKEN"
   ```

5. **Test tenant app Keycloak login:**
   - Navigate to `http://tenant-{id}.127.0.0.1.nip.io:8080`
   - Click "Log in with Keycloak" (if frontend implements the Keycloak OIDC flow)
   - Use `owner@example.com` / `password` to authenticate
   - Verify the frontend receives and stores the JWT token

6. **Test API calls with JWT:**
   ```bash
   # Get access token from Keycloak
   TOKEN=$(curl -s -X POST \
     http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev/protocol/openid-connect/token \
     -d 'client_id=dnd-notes-tenant-app' \
     -d 'client_secret=dnd-notes-tenant-app-secret-k3d-dev-only' \
     -d 'grant_type=password' \
     -d 'username=owner@example.com' \
     -d 'password=password' | jq -r .access_token)
   
   # Call tenant API with JWT
   curl -H "Authorization: Bearer $TOKEN" \
     http://tenant-{id}.127.0.0.1.nip.io:8080/api/campaigns
   # Should return campaign list (if tenant is healthy)
   ```

### Fallback to Local Auth

If `AUTH_MODE=local` or `KEYCLOAK_URL` is unset:

```bash
# Tenant app uses traditional login endpoint
curl -X POST http://tenant-{id}.127.0.0.1.nip.io:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "owner@example.com", "password": "password"}'

# Returns session token in cookie
# Control-plane uses static bearer token
curl -X POST http://localhost:3101/internal/tenants \
  -H "Authorization: Bearer $CONTROL_PLANE_ADMIN_TOKEN"
```

---

## Backward Compatibility & Gradual Rollout

### Phase 1: Keycloak Runtime Auth Ready (Issue #76)

- Keycloak clients and realm are seeded in k3d.
- Config/documentation in place.
- Backend auth middleware can accept Keycloak JWTs (once Data implements validation).
- `AUTH_MODE=local` remains default; no breaking changes.

### Phase 2: Migration Path

In a future phase, operators can switch `AUTH_MODE=keycloak` without affecting:
- **Guest/share-link flows** — remain anonymous and local
- **Existing session tokens** — old logins continue until user logs out and re-authenticates with Keycloak
- **Backward compatibility** — `AUTH_MODE=local` still works for legacy setups

---

## Troubleshooting

### Keycloak Realm Not Found

**Symptom:** `curl` returns 404 for `/realms/dnd-notes-dev`

**Check:**
```bash
kubectl logs -n dnd-notes-platform deployment/platform-keycloak
```

**Resolution:**
- Ensure Keycloak pod is running: `kubectl get pods -n dnd-notes-platform`
- Check the ConfigMap was mounted: `kubectl describe pod -n dnd-notes-platform -l app.kubernetes.io/name=platform-keycloak`
- Verify realm import volume: `kubectl exec -it <keycloak-pod> -n dnd-notes-platform -- ls /opt/keycloak/data/import/`

### JWT Validation Failed

**Symptom:** Backend returns 401 "Invalid token"

**Check:**
1. Verify client secret matches:
   ```bash
   kubectl get secret -n dnd-notes-platform dnd-notes-control-plane-secrets \
     -o jsonpath='{.data.KEYCLOAK_TENANT_CLIENT_SECRET}' | base64 -d
   # Should match the secret in keycloak.yaml realm definition
   ```

2. Verify public key fetch works:
   ```bash
   curl -s http://keycloak.127.0.0.1.nip.io:8080/realms/dnd-notes-dev/protocol/openid-connect/certs | jq .
   ```

3. Verify token includes `keycloak_sub` claim:
   ```bash
   # Decode JWT (without verification, for inspection)
   TOKEN=<your-jwt>
   echo $TOKEN | cut -d. -f2 | base64 -d | jq .
   # Should include "sub": "<keycloak-user-id>"
   ```

### Owner Account Not Found

**Symptom:** JWT is valid but "Owner account not found" error

**Check:**
1. Verify the owner account was created with the matching `keycloak_sub`:
   ```bash
   # Connect to tenant database
   SELECT keycloak_sub, email FROM owner_accounts;
   # Should have a row with keycloak_sub matching the JWT "sub" claim
   ```

2. If not, the backend needs to either:
   - Auto-create the owner account on first Keycloak login (Data feature)
   - Or require pre-seeding owner accounts with `keycloak_sub` values

---

## References

- **Issue #56:** Auth seam & schema prep (keycloak_sub column, migration coverage)
- **Issue #76:** Runtime Keycloak auth integration (this work)
- **RUNTIME.md:** Full environment variable reference
- **platform/k3d/README.md:** Local k3d setup guide
- **platform/control-plane/README.md:** Control-plane deployment and admin auth
