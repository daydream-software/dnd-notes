### 2026-04-21: Control-plane artifact hygiene for PR #66
**Decided by:** Brand (Platform Dev)  
**Date:** 2026-04-21

## Decision

For the control-plane deployment artifacts:

1. Keep the base Deployment image reference tagless (`ghcr.io/daydream-software/dnd-notes-control-plane`) so overlays must own the concrete promoted/local tag through Kustomize `images`.
2. Keep committed Secret manifests placeholder-only in source control; local k3d runs and hosted operators must inject real values out of band.

## Why

- Mutable tags like `:latest` make hosted rollouts and rollback audits harder to reason about.
- Local-default bearer tokens and DB credentials are too easy to cargo-cult into other environments once they live in committed Secret manifests.
- This keeps the fast k3d lane intact while making the artifact lane boring and reproducible.

## Impact

- `platform/control-plane/overlays/k3d` keeps the `k3d` image tag pin and now expects a local secret replacement step before rollout.
- `platform/control-plane/overlays/hosted-reference` stays a placeholder-only reference overlay until an operator supplies promoted image and secret values.
