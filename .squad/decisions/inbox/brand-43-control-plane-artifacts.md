# 2026-04-21: Issue #43 execution slice — control-plane artifacts first

**Decided by:** Brand (Platform Dev)  
**Issue:** #43 — Track deployment artifacts after hosting target selection

## Decision

Treat the coherent non-overlapping implementation slice for `#43` as:

1. a committed **control-plane image** (`docker/control-plane/Dockerfile`)
2. committed **control-plane Kubernetes artifacts** (RBAC, PVC, Service, Deployment, Kustomize overlays)
3. a **build + manifest-validation workflow** in GitHub Actions

Do **not** re-open tenant containerization work from `#52`, and do **not** fold the fast `k3d:smoke` loop into an in-cluster control-plane deployment yet.

## Why

- The tenant app already has a production-minded Dockerfile, runtime contract, and k3d smoke rehearsal.
- The repo explicitly called out the missing control-plane container/deployment artifact lane as the next deployment-artifact gap.
- Keeping `k3d:smoke` local preserves the quickest provisioning debug loop while the newly committed artifacts cover the hosted packaging story.

## Impact

- Platform contributors now have a single committed path for control-plane image building and Kustomize-based manifest review.
- Same-origin tenant hosts remain the default through `TENANT_BASE_DOMAIN` + `TENANT_PUBLIC_SCHEME`; no split-origin deployment flow was introduced.
- CI can validate deployment artifacts without requiring registry push automation.
