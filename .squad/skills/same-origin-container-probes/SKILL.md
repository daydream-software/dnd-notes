---
name: "same-origin-container-probes"
description: "Keep same-origin tenant containers cheap to probe, safe to route, and boring to package."
domain: "platform"
confidence: "high"
source: "earned"
---

## Context

Use this when a workspace app is being packaged into a single-origin container that serves both the SPA and the API.

## Pattern

1. Readiness probes should exercise the smallest real database health check available (`SELECT 1`, ping, or equivalent), not admin/reporting queries.
2. Liveness probes should stay process-only and independent from heavier readiness work.
3. SPA fallbacks must only answer `GET`/`HEAD` navigation requests; let invalid non-API verbs fall through to 404/route handlers.
4. In npm workspace images, prefer root production `node_modules` in the runtime stage unless a workspace has a proven runtime-only local module requirement.
5. Runtime docs must distinguish between application defaults and container-image overrides, especially for ports and shutdown behavior.
6. Do not document graceful drain unless the entrypoint actually closes the HTTP server and waits for in-flight requests before exiting.

## Example

- `noteStore.checkHealth()` backed by `SELECT 1` for `/readyz`
- `if (request.method !== "GET" && request.method !== "HEAD") next()` before `index.html` fallback
- Docker runtime stage copies `/app/node_modules` plus built artifacts, not speculative `apps/*/node_modules`

## Anti-Patterns

- Reusing admin overview or analytics queries for readiness probes
- Returning `index.html` for `POST /missing-route`
- Copying workspace-local `node_modules` from an `npm ci --omit=dev` stage without proving they exist
- Claiming a 30-second graceful shutdown when the process exits immediately on `SIGTERM`
