# Operator Portal

Read-only operator control portal for the platform control-plane.

## Current slice

- Keycloak admin/workforce auth gate
- Same-origin `/operator-api` reads into the existing control-plane fleet status contract
- Provision flow that creates a tenant record, then calls the existing
  `/internal/tenants/:id/provision` control-plane route after explicit review
- Provision form now records `initialAdminEmail` on the existing tenant-create
  contract so later bootstrap work has a stable handoff point
- Deprovision confirmation UX that requires a reason plus typed slug confirmation
- Rolling-update confirmation UX for ready tenants that keeps control-plane
  rollout failure guidance inline when the backend rejects or fails a rollout
- Dashboard for fleet health, tenant lifecycle state, backup coverage, and latest
  transition audit details

## Local development

```bash
npm install
npm run dev:operator-portal
```

The Vite dev server proxies `/operator-api/*` to `VITE_OPERATOR_DEV_PROXY_TARGET`
(`http://localhost:3001` by default) so local browser traffic stays same-origin
without adding a new CORS surface.

## Environment

Copy `.env.example` and override when needed:

- `VITE_OPERATOR_API_BASE_PATH` — browser path for same-origin control-plane calls
- `VITE_OPERATOR_DEV_PROXY_TARGET` — local dev proxy target for `/operator-api`
- `VITE_OPERATOR_KEYCLOAK_URL` — public Keycloak URL for operator login
- `VITE_OPERATOR_KEYCLOAK_REALM` — workforce/admin realm
- `VITE_OPERATOR_KEYCLOAK_CLIENT_ID` — public client accepted by the control-plane
