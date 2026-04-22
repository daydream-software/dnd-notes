---
name: "k3d-smoke-live-overrides"
description: "Scope local platform validation around one full-stack k3d smoke lane plus one proven live component override, with the operator surface as the preferred trigger."
domain: "planning"
confidence: "medium"
source: "earned"
---

## Context
Use this when a Kubernetes platform already boots locally, but developers still lack a trustworthy end-to-end validation path and a supported way to swap one service into live local development while the rest of the stack stays clustered.

## Patterns
- Treat the missing piece as a workflow contract, not just more bootstrap setup.
- Keep one issue that pairs: (a) full-stack smoke and (b) one concrete live override.
- Prove one high-value override end to end before promising a generic mechanism.
- Make the first override the API/backend component that gives the team the most leverage while clustered clients continue using the normal platform contract.
- Drive smoke through the highest-level operator surface available; fall back to lower-level control-plane APIs only as a temporary seam.
- Explicitly document supported versus unsupported overrides so the discovery slice closes with evidence.

## Examples
- Epic #42 child issue #79 pairs a k3d full-stack smoke lane with `tenant-api` running locally while `tenant-web` stays on k3d.
- #63 remains the earlier bootstrap/environment issue; the follow-up workflow contract belongs in a separate issue rather than being hand-waved as "more docs."

## Anti-Patterns
- Splitting smoke and live overrides into separate issues before either path is proven.
- Requiring raw manifest application as the permanent happy path.
- Promising that "any component can run live" without evidence for a first supported case.
- Blocking the workflow issue on a later UI surface when a control-plane seam already exists.
