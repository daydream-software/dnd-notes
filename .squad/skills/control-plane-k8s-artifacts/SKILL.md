---
name: "control-plane-k8s-artifacts"
description: "Package an internal control plane for Kubernetes without slowing the fast local provisioning loop."
domain: "platform"
confidence: "high"
source: "earned"
---

## Context

Use this when a repo already has a fast local control-plane/dev loop, but hosted deployment work now needs a committed image + manifest lane for the internal control plane.

## Pattern

1. Keep the fast smoke/provisioning loop local if that is still the shortest debug path.
2. Add a dedicated control-plane Dockerfile instead of overloading the tenant image.
3. Commit RBAC explicitly; control planes that create tenant namespaces and workloads usually need cluster-scoped access.
4. Use Kustomize overlays for at least:
   - a local-cluster lane (`k3d`, `kind`, etc.)
   - a boring hosted-reference lane with placeholder secrets/domains
5. Validate overlays in CI by rendering them (`kubectl kustomize`) and build the control-plane image alongside the tenant image.

## Examples

- `docker/control-plane/Dockerfile`
- `platform/control-plane/base/clusterrole.yaml`
- `platform/control-plane/overlays/k3d/`
- `.github/workflows/deployment-artifacts.yml`

## Anti-Patterns

- Reusing the tenant container image for the control plane
- Forcing the daily smoke lane to use the in-cluster control plane before the team actually needs that slower path
- Hiding provisioning permissions behind undocumented cluster-admin assumptions
