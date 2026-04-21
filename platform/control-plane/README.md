# Control-plane deployment artifacts

Issue `#43` now owns the committed deployment-artifact lane for the internal
control plane.

The goal is intentionally narrow:

- keep the fast `k3d:smoke` loop on a **local** control-plane process
- commit the **in-cluster** image + manifest set that future hosted rollouts need
- preserve the locked **same-origin per-tenant** production model

## Layout

- `base/` — service account, RBAC, runtime config, PVC, Service, Deployment
- `overlays/k3d/` — local-cluster values (`*.nip.io`, in-cluster Postgres, `:k3d` image tag)
- `overlays/hosted-reference/` — managed-cluster reference values (`https`, example base domain)

The control plane remains cluster-internal only. Tenant traffic still terminates
at each tenant host, where the app serves web + API from the same origin.
`TENANT_BASE_DOMAIN` plus `TENANT_PUBLIC_SCHEME` define that host model for the
resources the control plane provisions.

## Local k3d rehearsal

```bash
npm run k3d:bootstrap
npm run k3d:build-control-plane-image
kubectl apply -k platform/control-plane/overlays/k3d
kubectl -n dnd-notes-platform rollout status deployment/dnd-notes-control-plane
kubectl -n dnd-notes-platform port-forward svc/dnd-notes-control-plane 3101:3001
```

The k3d overlay points the control plane at the in-cluster platform Postgres
service and uses the `ghcr.io/daydream-software/dnd-notes-control-plane:k3d`
image tag.

## Hosted reference overlay

The hosted reference overlay is deliberately boring:

- same namespace (`dnd-notes-platform`)
- HTTPS tenant hosts by default
- placeholder admin/runtime Postgres URLs that operators must replace
- placeholder bearer token values that must be replaced before apply

Use it as the starting point for a managed-cluster rollout after image promotion.

## Validation

```bash
npm run platform:validate
```

That command renders both overlays via `kubectl kustomize`, which is the same
manifest validation wired into GitHub Actions.
