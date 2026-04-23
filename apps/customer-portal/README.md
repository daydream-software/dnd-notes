# Customer Portal

Public landing and self-serve signup portal for customer onboarding.

## Current slice

- Marketing landing page with plan discovery and product framing
- Local email-based portal signup/login against the control-plane `/portal` API
- Self-serve tenant request flow with slug, plan, and payment-provider placeholder capture
- Customer dashboard showing owned instances, lifecycle state, backup summary, and quick links when an app URL is available
- Explicit placeholders for future billing management, team invites, and usage analytics

## Local development

```bash
npm install
npm run dev:customer-portal
```

The Vite dev server proxies `/portal-api/*` to `VITE_PORTAL_DEV_PROXY_TARGET`
(`http://localhost:3001` by default) so browser traffic stays same-origin during
development without adding a new CORS surface.

## Environment

Copy `.env.example` and override when needed:

- `VITE_PORTAL_API_BASE_PATH` — browser path for same-origin control-plane portal calls
- `VITE_PORTAL_DEV_PROXY_TARGET` — local dev proxy target for `/portal-api`
