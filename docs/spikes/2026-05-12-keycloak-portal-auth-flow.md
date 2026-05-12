# Spike: Keycloak portal auth flow design

**Issue:** #148 (spike for epic #139)
**Date:** 2026-05-12
**Author:** Data (backend)
**Status:** Complete — most decisions implemented across #176–#201. Open questions listed in §9; two technical questions resolved in-spike (OQ-2, OQ-3).

---

## Overview

This document records the design decisions for the Keycloak OIDC auth flow powering the customer portal and operator portal. Issue #148 asked six specific questions; by 2026-05-09 all six were answered in decisions.md (entry 2026-05-09 "Keycloak portal auth flow design"). Subsequent implementation PRs (#176–#201) revised some points. This doc consolidates the decisions, grounds each one in current code, and surfaces what remains genuinely open.

Where a decision has already been implemented the relevant file:line is cited. Where implementation diverges from the original intent the divergence is called out explicitly.

---

## 1. Flow shapes

**Decision: authorization code with PKCE for both portals. No implicit flow, no device code.**

Both portals use `keycloak-js` in SPA mode with `pkceMethod: 'S256'`. Implicit flow was explicitly disabled in the realm seed (`"implicitFlowEnabled": false` for all clients at `platform/k3d/keycloak.yaml:94,128`). Device code is not applicable to a browser SPA.

**Customer portal** — `createCustomerKeycloakClient` in `apps/customer-portal/src/keycloak-client.ts:77-139` passes `pkceMethod: 'S256'` and `onLoad: 'check-sso'` to `client.init()` (line 93). The Keycloak client attribute `pkce.code.challenge.method: S256` is enforced server-side on `dnd-notes-customer-portal` (`platform/k3d/keycloak.yaml:141`).

**Operator portal** — `createRuntimeKeycloakClient` in `apps/operator-portal/src/keycloak-client.ts:69-110` also passes `pkceMethod: 'S256'` (line 82). The `dnd-notes-control-plane` client does NOT carry the server-side PKCE attribute in the realm seed (not present at `platform/k3d/keycloak.yaml:98-120`). The attribute only appears on the customer-portal client.

**Why not a BFF proxy?** The decision against a confidential client behind a control-plane BFF was made explicitly (decisions.md 2026-05-09): it adds deployment complexity and CSRF surface without meaningful XSS protection gain for our threat model. The PKCE binding already ties the token to the browser session that initiated the flow. Revisit if the customer portal evolves to require server-side session management for other reasons.

**Per-tenant client (tenant API)** — `directAccessGrantsEnabled: true` is set on per-tenant clients (provisioning.ts:469) to allow the k3d smoke test to fetch tokens without a browser. The SPA negotiates PKCE at runtime. Server-side PKCE enforcement (`pkce.code.challenge.method`) is absent from per-tenant clients pending issue #183, which tracks re-enabling it once the smoke switches to auth-code + PKCE.

---

## 2. Client model

**Decision: one dedicated public client per portal; one per-tenant public client per provisioned tenant.**

Three active client categories exist in the shared `dnd-notes-dev` realm:

| Client ID pattern | Portal | Public | PKCE attribute | Notes |
|---|---|---|---|---|
| `dnd-notes-customer-portal` | Customer portal | yes | S256 (server) | Created in realm seed |
| `dnd-notes-control-plane` | Operator portal | yes | no | Created in realm seed |
| `dnd-notes-tenant-{tenantId}` | Tenant SPA | yes | no (pending #183) | Created at provisioning time |
| `dnd-notes-keycloak-admin` | Internal | no (service acct) | — | Client credentials for admin API |
| `dnd-notes-tenant-app` | (tombstoned) | — | — | Disabled; shared wildcard client replaced |

**Why separate clients instead of a multi-tenant single client?** Keycloak does not support wildcard hostnames in redirect URIs — only path wildcards. A single client for all tenants would require enumerating every tenant subdomain explicitly, which is not viable for dynamic provisioning. Issue #170 (closed) documents this root cause. The per-tenant client pattern gives exact-match redirect URIs and per-tenant OAuth surface isolation.

**Redirect URI shape** — customer portal uses `${window.location.origin}/` (apps/customer-portal/src/config.ts:28-30). The realm seed registers explicit URIs for the dev nip.io hostname plus localhost variants (`platform/k3d/keycloak.yaml:130-144`). Per-tenant clients register `https://${hostname}/*` and `http://${hostname}/*` at provisioning time (apps/control-plane/src/provisioning.ts:470-477).

**Per-tenant client ID formula** — `dnd-notes-tenant-${tenantId}` where `tenantId` is the UUID from the `tenants` table (provisioning.ts:454). Not configurable externally. The control-plane injects `KEYCLOAK_TENANT_CLIENT_ID` into the tenant pod configmap at provisioning time (app.ts:1157).

**Production (non-k3d) redirect URIs** — see open question OQ-4.

---

## 3. Token lifecycle

### Access token

`keycloak-js` defaults to 5-minute access token TTL configured in the Keycloak realm. Neither portal overrides this — no custom session settings are applied in the realm seed. The verifier in `platform/keycloak-jwt/src/index.ts:401` enforces `exp` strictly with a `notBeforeSkewSec: 30` tolerance applied at call sites (`apps/control-plane/src/keycloak-auth.ts:117,197`).

### Refresh tokens

`keycloak-js` handles refresh internally. Both portal clients call `client.updateToken(minValidity)` (`apps/customer-portal/src/keycloak-client.ts:123`, `apps/operator-portal/src/keycloak-client.ts:96`). `minValidity` defaults to 30 seconds, meaning a refresh is requested if the access token expires within 30 seconds of the next use. Refresh token rotation policy (forced vs standard) is not set in the realm seed — Keycloak default (rotate on use) applies.

### Storage

Token storage diverges between portals:

- **Customer portal** — `sessionStorage`, key `dnd-notes:customer-portal:keycloak-tokens` (`apps/customer-portal/src/keycloak-client.ts:26`, 41). Tokens are cleared on tab close.
- **Operator portal** — `localStorage`, key `dnd-notes:operator-portal:keycloak-tokens` (`apps/operator-portal/src/keycloak-client.ts:18`, 33). Tokens persist across browser sessions.

The divergence was implicit in implementation (decisions.md 2026-05-09 records "Keycloak tokens stored in sessionStorage" for the customer portal only). See OQ-2 in §9 (decided in-spike).

### Silent refresh

`checkLoginIframe: false` is set in both `keycloak-client.ts` implementations (customer-portal:95, operator-portal:82). Silent SSO via hidden iframe is therefore disabled. Refresh is driven entirely by the `updateToken` call at the moment a protected request is about to be issued. For the customer portal this happens in `freshToken()` (keycloak-client.ts:122-138), called at dashboard hydration and before each polling tick. For the operator portal, `refresh()` is called explicitly by the app before fleet API calls.

The practical implication: if a tab is left open and the refresh token expires (Keycloak default is 30 minutes for offline sessions, check realm settings), the next API call will fail to refresh and the user will see an error. No background timer refreshes tokens proactively. See OQ-3 in §9 (decided in-spike).

---

## 4. Tenant claims propagation

### Customer portal → control-plane API

The customer portal attaches the raw Keycloak access token as `Authorization: Bearer <token>` to all control-plane requests (`apps/customer-portal/src/control-plane-api.ts` — bearer header on each fetch). The control-plane middleware at `apps/control-plane/src/app.ts:1108-1259` extracts and verifies the token:

1. `verifyToken` (platform/keycloak-jwt/src/index.ts:344) validates signature (RS256), issuer, audience (`dnd-notes-customer-portal`), and expiry.
2. `sub` and `email` claims are extracted (`keycloak-auth.ts:210-223`). `email` is required for the first-login paths.
3. Fast path — `getPortalAccountByKeycloakSub(sub)` resolves the portal account if already linked (app.ts:1143).
4. First-login path — if no row found by sub, attempt email-match auto-link (`linkPortalAccountKeycloakSub`) or auto-create (`createPortalAccountFromKeycloak`). Both paths set `role_sync_status = 'pending'` so the background sweep can assign per-tenant roles (app.ts:1161-1252).

The `portal_accounts` table's `keycloak_sub` column is the stable identity anchor. Email is used only for the first-login transition.

### Operator portal → control-plane API

The operator portal similarly attaches the Keycloak access token as `Authorization: Bearer`. The control-plane verifies it against `dnd-notes-control-plane` client and checks `resource_access[dnd-notes-control-plane].roles` plus `realm_access.roles` for `control-plane-admin` or `control-plane-workforce` (`apps/control-plane/src/keycloak-auth.ts:126-133`).

### Customer portal → tenant API

The tenant SPA (separate app, not part of this epic) receives a Keycloak access token issued for the per-tenant client (`dnd-notes-tenant-{tenantId}`). The tenant API verifies via `createTenantRuntimeAuth` (`apps/api/src/keycloak-auth.ts:110-190`) and additionally enforces the `tenant-member` role under `resource_access[tenantClientId].roles` (api/keycloak-auth.ts:178-181). Role assignment happens at provisioning and at auto-link time via `assignClientRoleToUser`.

### Claims used

| Claim | Where used | Notes |
|---|---|---|
| `sub` | `portal_accounts.keycloak_sub`, `keycloakSub` for role assignment | Stable UUID, never reused by Keycloak |
| `email` | First-login lookup and auto-create display name | Required to be present on first login |
| `name`, `preferred_username` | `deriveDisplayName` for display name | Fallback chain in app.ts |
| `resource_access[clientId].roles` | Operator portal role gate, tenant member gate | Both verified server-side |
| `realm_access.roles` | Operator portal role gate only | Checked in union with client roles |

The `aud` / `azp` matching in `audienceMatches` (`platform/keycloak-jwt/src/index.ts:314-327`) requires the `aud` array or the `azp` claim to match the configured `clientId`. Keycloak 26 includes `azp` on all tokens, so the `azp` branch takes precedence when present.

---

## 5. Failure modes

### Keycloak unreachable at control-plane startup

`createPortalKeycloakAuth` fails hard at startup if required env vars are missing (keycloak-auth.ts:168-184). However, `apps/control-plane/src/index.ts:55-56` falls back to `local` mode when `CUSTOMER_PORTAL_AUTH_MODE` is not set to `'keycloak'`, so startup is safe in environments that have not enabled Keycloak portal auth. The admin client (`KeycloakAdminClient`) is initialized with soft-failure: if Keycloak is unreachable at startup the `ensureClient` call for the customer-portal client is logged and swallowed (decisions.md 2026-05-09, implementation decision §1).

### JWKS fetch failure during request processing

`getPublicKeyForKid` (`platform/keycloak-jwt/src/index.ts:255-297`) throws `KeycloakJwtVerificationError` with code `jwks_fetch_failed`. The middleware catches `KeycloakJwtVerificationError` and returns HTTP 401 (`keycloak-auth.ts:119-124,202-208`). The in-flight fetch deduplication (`inflightJwksFetches` map at index.ts:87) prevents thundering herd on cold start. JWKS TTL is 5 seconds (`JWKS_CACHE_TTL_MS = 5_000`, index.ts:88); a sustained Keycloak outage will cause all token verifications to fail with 401.

### Refresh token expired (session expired mid-flow)

`updateToken` in keycloak-js throws if the refresh token is expired or the session no longer exists in Keycloak. The customer portal catches this in `freshToken()` (keycloak-client.ts:125-127): it clears sessionStorage, sets `keycloakToken = null`, and surfaces the error to the user via the `error` state. The user must sign in again. The operator portal surfaces the same error via the app's error state.

No proactive expiry warning exists today — the user discovers the session is expired at the next attempted action. See OQ-3 in §9 (decided in-spike).

### Role missing (403 from tenant API)

The tenant API returns HTTP 403 with the message `'Your account is not authorized for this tenant. The tenant owner must grant you access.'` (`apps/api/src/keycloak-auth.ts:31`). The tenant SPA is expected to render an access-denied state and not a generic error. The control-plane's role-sync retry loop (`apps/control-plane/src/role-sync-retry.ts`) ensures eventual consistency for tenants created before the owner's first Keycloak login.

### Role sync failure (pending state)

If the per-tenant role assignment sweep fails at auto-link time, `role_sync_status = 'pending'` is persisted atomically (linkPortalAccountKeycloakSub sets it in the same UPDATE, decisions.md 2026-05-11). The background retry loop in `role-sync-retry.ts` runs on a 60-second base interval with exponential backoff up to 5 minutes. A `KeycloakAdminError(404)` on a tenant client is treated as a resolved slot — the slot is not retried (role-sync-retry.ts:131-139). Risk: if a tenant-client name is changed or the role is renamed, 404s silently mark the account complete.

### Session expired mid-form-submit (customer portal)

`freshToken()` is called just before each mutation (handleCreateTenant at app.tsx:590). If the token cannot be refreshed, `freshToken` throws and the form handler catches it, setting `error` state. The in-progress form draft is preserved in React state; the user can re-authenticate and resume. However the redirect to Keycloak loses the draft unless the SPA explicitly saves it to sessionStorage before redirecting. This is not currently done. See open question OQ-5.

### Keycloak login theme drift

The `platform/k3d/keycloak.yaml` ConfigMap defines login theme assets inline. If theme assets fall out of sync with the deployed Keycloak version, the login page may render incorrectly. Documented as a known side-effect in decisions.md 2026-05-12.

---

## 6. Local dev

The k3d local loop runs a single Keycloak pod against the `dnd-notes-dev` realm (`platform/k3d/keycloak.yaml`). The realm is seeded from a JSON ConfigMap on pod start. All three portal clients are present in the seed.

**Customer portal** — reaches Keycloak at `https://keycloak.127.0.0.1.nip.io` via the nip.io TLS ingress. `VITE_PORTAL_KEYCLOAK_URL` defaults to this value in `apps/customer-portal/src/config.ts:19`. The realm ConfigMap registers `https://portal.127.0.0.1.nip.io/*` and `http://localhost:5175/*` as valid redirect URIs (keycloak.yaml:130-133).

**Operator portal** — same Keycloak instance, client `dnd-notes-control-plane`, redirect URIs cover `operator.127.0.0.1.nip.io` and `localhost:5173-5174` (keycloak.yaml:106-110).

**Per-tenant clients** — created dynamically by the control-plane provisioner at `helm`/`kubectl apply` time. The control-plane admin client (`dnd-notes-keycloak-admin`) holds `manage-clients` and `manage-users` realm-management roles (keycloak.yaml:75-84) and authenticates via `client_credentials` grant (`KeycloakAdminClient.getAccessToken`, keycloak-admin-client.ts:108-160).

**Keycloak must use Postgres in any cluster deployment** — H2 fallback (Keycloak default in-memory database) destroys per-tenant clients on pod restart. `KC_DB*` env vars must be set. Absence causes silent H2 fallback. Documented in decisions.md 2026-05-10 §2.

**PKCE re-enable (tenant clients)** — the k3d smoke test (`scripts/k3d/smoke.sh`) currently uses `grant_type=password` (direct-grant) to acquire a tenant access token without a browser, which is incompatible with the server-side `pkce.code.challenge.method: S256` attribute. Issue #183 tracks switching the smoke to auth-code + PKCE so the attribute can be re-enabled (provisioning.ts:463-468).

---

## 7. Migration path

The control-plane runs in dual-auth mode — `local` or `keycloak` — controlled by the `CUSTOMER_PORTAL_AUTH_MODE` environment variable (`apps/control-plane/src/index.ts:55-56`). This allows incremental cutover per environment.

**Stage 1 — Keycloak enabled, local auth still works** — current state in the k3d cluster. `CUSTOMER_PORTAL_AUTH_MODE=keycloak` switches the `/portal/me` middleware to `createPortalKeycloakSessionMiddleware`. Local email/password routes (`/portal/login`, `/portal/signup`) remain active; `/portal/logout` returns 501 in Keycloak mode (app.ts:1700-1706) since Keycloak logout is handled front-channel by the SPA.

**Stage 2 — Auto-link on first Keycloak login** — any existing `portal_accounts` row with a matching `email` gets `keycloak_sub` set at the first successful Keycloak login (app.ts:1155-1173). The `role_sync_status = 'pending'` marker is set atomically and the background sweep assigns per-tenant `tenant-member` roles. Idempotent — running the link a second time is a no-op (COALESCE condition in `linkPortalAccountKeycloakSub`, tenant-registry-postgres.ts:1019-1020).

**Stage 3 — Auto-create for new Keycloak users** — users with no pre-existing `portal_accounts` row get one created on first login (app.ts:1246-1251). The Keycloak realm's own registration policy is the gate (decisions.md 2026-05-09 "auto-create path"). The realm seed has `"registrationAllowed": false` (keycloak.yaml:13) — operators control who can sign up by creating Keycloak users directly or enabling self-registration.

**Hard cutover** — when local auth is fully retired: disable `/portal/login` and `/portal/signup` routes, remove `CUSTOMER_PORTAL_AUTH_MODE=local` support, and clean up `password_hash` columns in `portal_accounts`. No timeline set. See open question OQ-1.

**Per-tenant migration** — tenants created in local auth mode have no per-tenant Keycloak client. Switching a tenant environment to Keycloak mode requires provisioning re-run or a one-off migration script. `ensureClient` is idempotent — calling it against an existing client is a no-op if the spec matches. The migration script shape described in #170 still applies.

---

## 8. Implementation outline

Follow-up features required to complete the epic scope tied to #139. Items are sequenced by dependency; each maps to the code artifacts where the work lands.

**Item 1 — Operator-portal PKCE server-side enforcement**
Add `pkce.code.challenge.method: S256` to the `dnd-notes-control-plane` client in `platform/k3d/keycloak.yaml` (currently absent at lines 98–120). Extend `ensureClient` in `apps/control-plane/src/keycloak-admin-client.ts` to set the attribute for the operator-portal client on startup (currently only applied to the customer-portal client). No dependency on other items.
Owner: data. Issue: TBD.

**Item 2 — Operator-portal sessionStorage migration (implements OQ-2 decision)**
Migrate `apps/operator-portal/src/keycloak-client.ts` storage adapter from `localStorage` (keys at lines 18, 33) to `sessionStorage`, matching the customer-portal pattern. Storage key remains `dnd-notes:operator-portal:keycloak-tokens`. No other files change; the read/write surface is encapsulated in that file. Can ship independently of item 1. Implements the OQ-2 decision (see §9).
Owner: data + stef. Issue: TBD.

**Item 3 — Background token-refresh timer (implements OQ-3 decision)**
Add a `setInterval`-based proactive refresh to both `keycloak-client.ts` wrappers. Customer portal: extend the existing `freshToken()` wrapper (`apps/customer-portal/src/keycloak-client.ts:122-138`) to schedule a call to `client.updateToken(300)` roughly 60 seconds before the access token's `exp`. Operator portal: same pattern in `apps/operator-portal/src/keycloak-client.ts` using the existing `refresh()` call path. `checkLoginIframe` stays `false`; no iframe is introduced. Schedule item 2 first so both files are touched in a single pass. Implements the OQ-3 decision (see §9).
Owner: data + stef. Issue: TBD.

**Item 4 — Per-tenant PKCE re-enable and smoke harness migration**
Switch `scripts/k3d/smoke.sh` from `grant_type=password` to auth-code + PKCE so the server-side `pkce.code.challenge.method: S256` attribute can be re-enabled on per-tenant clients in `apps/control-plane/src/provisioning.ts:463-468`. Tracked in issue #183. Depends on the smoke rewrite being validated in CI before the attribute is activated — sequence after items 1–3 to avoid blocking the other work.
Owner: brand + data. Issue: #183.

**Item 5 — Portal client role lifecycle hardening**
Tighten the `KeycloakAdminError(404)` swallow in `apps/control-plane/src/role-sync-retry.ts:131-139`. A 404 on a tenant client currently silently marks the account as done; it should distinguish "client deleted" (log + skip) from "role renamed" (alert + do not mark complete). Related: audit `ensureClientRole` and `assignClientRoleToUser` in `apps/control-plane/src/provisioning.ts` and `apps/control-plane/src/keycloak-admin-client.ts` for idempotency under concurrent provisioning. No dependency on items 1–4.
Owner: data. Issue: TBD.

**Item 6 — Production redirect URI provisioning**
Extend startup-time `ensureClient` (`apps/control-plane/src/keycloak-admin-client.ts`) to register production-hostname redirect URIs for the operator-portal client alongside the customer-portal client — currently only the customer-portal client is handled. Coordinate with the OQ-4 product decision on URI authority (Terraform vs realm seed override). Can be scoped independently of item 1 but is lower priority until production deployment is planned.
Owner: data + brand. Issue: TBD (blocked on OQ-4 product input).

**Dependency order:** Items 1 and 5 are independent and can ship in parallel. Item 2 before item 3 (avoid double-touching operator keycloak-client.ts). Item 4 separate track (#183). Item 6 after OQ-4 is answered.

---

## 9. Open questions

These require a product or architecture decision before implementation can proceed. OQ-2 and OQ-3 were resolved in-spike and are marked decided below. The remaining five require stakeholder input.

**OQ-1 — Hard-cutover timeline for local portal auth.** Local email/password auth (`/portal/login`, `/portal/signup`) is still active. When does the local path become unsupported? This determines whether `portal_accounts.password_hash` can be dropped from the schema and whether the dual-mode support code (`ensurePortalLocalAuthEnabled`) needs a sunset date baked in.

**OQ-2 — Token storage: decided.** Recommendation: the operator portal should migrate from `localStorage` to `sessionStorage`, matching the customer portal. The trade-off: `sessionStorage` limits the exposure window to the browser session (tokens evicted on tab close) at the cost of requiring re-authentication after a browser restart. For the operator surface, this is the right balance — operator sessions are short-lived by policy, and the workforce user cohort is disciplined enough to handle a daily login. Persisting tokens in `localStorage` across browser restarts is not worth the extended exposure window for a portal that controls tenant provisioning. Implementation: change the storage adapter in `apps/operator-portal/src/keycloak-client.ts` (lines 18, 33) from `localStorage` to `sessionStorage` and rename the storage key if the old key should be invalidated at rollout. See implementation outline item 2.

**OQ-3 — Token refresh strategy: decided.** Recommendation: keep `checkLoginIframe: false` and add a background refresh timer to both portal SPAs. The timer should call `client.updateToken(300)` (i.e. refresh if the access token expires within 5 minutes) on a `setInterval` that fires roughly every 60 seconds — or equivalently hook into keycloak-js's `onTokenExpired` callback. This keeps the silent-iframe opt-out intact (avoiding the complexity and cross-origin iframe restrictions that caused `checkLoginIframe: false` in the first place) while preventing the "idle tab hits an expired session with no warning" failure mode described in §5. The customer portal reuses the existing `freshToken()` plumbing (`apps/customer-portal/src/keycloak-client.ts:122-138`); the operator portal uses its `refresh()` call path. See implementation outline item 3.

**OQ-4 — Production redirect URI registration.** The realm seed covers k3d nip.io and localhost. For production deployments with real hostnames (`portal.dnd-notes.app`, `operator.daydream.software`) the redirect URIs must be registered either in a production realm seed or via the admin API. The `ensureClient` call at startup only handles the customer-portal client; there is no analogous code for the operator-portal client. Who is responsible for registering production redirect URIs and how (Terraform, manual, realm seed override)?

**OQ-5 — Draft state loss on auth redirect.** When `freshToken()` fails mid-form-submit (session expired), the SPA redirects to Keycloak. React state is lost and the user returns to a blank form. Acceptable UX trade-off for a B2B portal, or should draft state be persisted to sessionStorage before redirecting?

**OQ-6 — Refresh token rotation policy.** The realm seed does not configure `refreshTokenMaxReuse`, `offlineSessionMaxLifespanEnabled`, or related settings — Keycloak defaults apply. The default refresh token lifetime and rotation policy are not documented in any decision. Should forced rotation be enabled (prevents stolen refresh token reuse but invalidates all copies immediately on use)?

**OQ-7 — Same-realm SSO between customer and operator portals.** Both portals share the `dnd-notes-dev` realm. A Keycloak session established in the operator portal would satisfy a customer-portal SSO check if the user happens to navigate there (Keycloak shares the session cookie). The `onLoad: 'check-sso'` on the customer portal would pick up the operator session. Is cross-portal SSO intentional behavior or a gap that should be guarded against (e.g., by verifying required roles before granting portal access)?

---

## Referenced files

- `platform/k3d/keycloak.yaml` — realm seed, client definitions, theme ConfigMaps
- `platform/keycloak-jwt/src/index.ts` — JWT verification, JWKS caching
- `apps/customer-portal/src/keycloak-client.ts` — keycloak-js wrapper, sessionStorage, freshToken
- `apps/customer-portal/src/config.ts` — Keycloak URL/realm/clientId resolution, redirect URI builder
- `apps/customer-portal/src/App.tsx` — Keycloak bootstrap, auth-mode dispatch, dashboard hydration
- `apps/operator-portal/src/keycloak-client.ts` — keycloak-js wrapper, localStorage
- `apps/operator-portal/src/config.ts` — operator Keycloak config resolution
- `apps/control-plane/src/keycloak-auth.ts` — `createControlPlaneAdminAuth`, `createPortalKeycloakAuth`
- `apps/control-plane/src/keycloak-admin-client.ts` — admin REST client, `ensureClient`, `assignClientRoleToUser`
- `apps/control-plane/src/provisioning.ts` — per-tenant client lifecycle, `ensureClientRole`
- `apps/control-plane/src/tenant-registry-postgres.ts` — `createPortalAccountFromKeycloak`, `linkPortalAccountKeycloakSub`, `getPortalAccountsPendingRoleSync`
- `apps/control-plane/src/role-sync-retry.ts` — background role-sync loop with backoff
- `apps/control-plane/src/app.ts` — `createPortalKeycloakSessionMiddleware`, portal route definitions, `/portal/logout` gate
- `apps/control-plane/src/index.ts` — env var resolution, `CUSTOMER_PORTAL_AUTH_MODE` default
- `apps/api/src/keycloak-auth.ts` — `createTenantRuntimeAuth`, `tenant-member` role gate
