---
name: "postgres-tenant-rolling-update"
description: "Make a single-replica tenant rollout boring by tying RollingUpdate settings to runtime drain behavior and a drain-first, no-overlap Postgres shutdown contract."
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
   `maxSurge: 0`, `maxUnavailable: 1`, plus a small `minReadySeconds`. This
   drain-first replacement prevents pod overlap and avoids multi-attach issues
   while the tenant still mounts a RWO PVC.
3. Mark control-plane state as `upgrading` only for real version rollouts, then
   return to `ready` after the rollout is fully complete (`observedGeneration`
   matches, `updatedReplicas/availableReplicas` equal `spec.replicas`).
4. Keep the runtime drain contract boring: `/ready` fails immediately on
   `SIGTERM`, new connections stop, in-flight requests drain, idle keep-alives
   close, then the Postgres pool closes.
5. Document the no-overlap rollout: drain-first replacement means no temporary
   database pool overlap during normal rollouts.
6. Keep exclusive maintenance/restore work as a separate path; do not overload
   the ordinary rolling-update flow with single-writer assumptions.
7. **Future:** Once the PVC is removed or becomes RWX, switch to `maxSurge: 1` /
   `maxUnavailable: 0` for zero-downtime updates.

## Examples

- `apps/control-plane/src/provisioning.ts`
- `apps/control-plane/README.md`
- `RUNTIME.md`
