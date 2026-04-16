---
name: "public-web-origin"
description: "Separate canonical public web URLs from API origins when backend responses emit user-facing links."
domain: "api-design"
confidence: "high"
source: "observed"
---

## Context
Use this when a backend returns URLs that users will open in the browser, especially shared links. The API host that handled the request is not always the canonical public web host, and the caller `Origin` header is not a durable source of truth in production.

## Patterns
- Keep frontend API fetch configuration separate from backend-generated public URLs.
- Put the canonical browser entrypoint behind an explicit server-side env such as `PUBLIC_WEB_URL`.
- Use that env for user-facing links like `/share/:token`.
- Keep request-derived host/origin fallback only for local development or backwards-compatible transition periods.
- Prefer same-origin deployments first; only introduce CORS allowlists when browser traffic is intentionally cross-origin.

## Examples
- `apps/web/src/api.ts` uses `VITE_API_BASE_URL` for browser-to-API fetches.
- `apps/api/src/app.ts` currently builds share URLs in `buildSharedUrl()` for create/reveal responses; this is the seam to move to explicit public-web config.

## Anti-Patterns
- Building production share links from the incoming request `Origin` header.
- Assuming the API host is the same thing as the public web host.
- Tightening CORS before deciding whether the product is actually deploying cross-origin.
