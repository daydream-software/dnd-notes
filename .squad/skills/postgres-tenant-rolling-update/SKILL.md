---
name: "postgres-tenant-rolling-update"
description: "Make a single-replica tenant rollout boring by tying RollingUpdate settings to runtime drain behavior and Postgres pool overlap."
domain: "backend"
confidence: "high"
source: "earned"
---

## Context

Use this when a tenant workload already has readiness probes and graceful
shutdown, and the missing piece is an explicit hosted rollout contract for a
Postgres-backed deployment.

## Pattern

1. Reuse an existing control-plane or provisioning endpoint to apply the new
   tenant image/version.
2. Make the Deployment strategy explicit: single replica, `RollingUpdate`,
   `maxSurge: 1`, `maxUnavailable: 0`, plus a small `minReadySeconds`.
3. Mark control-plane state as `upgrading` only for real version rollouts, then
   return to `ready` after the new pod becomes Available.
4. Keep the runtime drain contract boring: `/ready` fails immediately on
   `SIGTERM`, new connections stop, in-flight requests drain, idle keep-alives
   close, then the Postgres pool closes.
5. Document the temporary database overlap budget explicitly:
   `2 × NOTES_DB_POOL_MAX` per actively upgrading tenant.
6. Keep exclusive maintenance/restore work as a separate path; do not overload
   the ordinary rolling-update flow with single-writer assumptions.

## Examples

- `apps/control-plane/src/provisioning.ts`
- `apps/control-plane/README.md`
- `RUNTIME.md`
