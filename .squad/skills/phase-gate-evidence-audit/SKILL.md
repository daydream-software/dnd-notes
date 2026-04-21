---
name: "phase-gate-evidence-audit"
description: "Validate a milestone by matching repo artifacts, executable checks, and workflow evidence, then name any false-green risk."
domain: "testing"
confidence: "high"
source: "earned"
---

## Context

Use this when an epic or phase is marked done in issues, but QA still needs to answer the harder question: does the repo actually prove the claim?

## Pattern

1. Treat issue closure as a lead, not as evidence.
2. Map each acceptance slice to concrete repo artifacts: runtime code, docs, manifests, tests, and workflows.
3. Run the repo's own validation entrypoints locally when possible.
4. If local infra smoke cannot run, use the most recent relevant CI/workflow run and say why you had to rely on it.
5. Separate **static proof** (files and tests exist) from **live proof** (a smoke lane actually executed).
6. Call out the remaining false-green risk explicitly, especially when smoke only proves readiness and not a real user workflow.

## Example

- Epic #42 Phase 0 was approvable only after the repo showed the tenant container/runtime contract, committed control-plane artifacts, Postgres-primary + SQLite-fallback wiring, green root validation, and a recent green k3d smoke run. The remaining yellow note was that the k3d smoke still stopped at readiness rather than note CRUD.
