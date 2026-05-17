---
name: k3d-smoke-triage
description: "Use when a k3d smoke run fails, to classify whether the failure is an app regression or cluster/bootstrap fragility."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Pattern

1. Start with `nodes.txt`, `events.txt`, and `all-resources.txt`.
2. If the agent node is `NotReady` or events show flannel / CNI sandbox failures (`subnet.env`, `CIDRAssignmentFailed`, `FailedCreatePodSandBox`), treat the run as cluster/bootstrap fragility first.
3. If tenant namespaces or pods never appear, do **not** jump to image-import or app-startup conclusions.
4. Only call it a likely PR regression when tenant resources were created and then failed for reasons tied to changed code (for example `ErrImagePull`, app crash loops, or readiness failures in the changed workload).

## Evidence checklist

- `nodes.txt`: node readiness, especially agents
- `events.txt`: `FailedCreatePodSandBox`, flannel, CNI, `ErrImagePull`, readiness failures
- `all-resources.txt`: whether tenant resources ever existed
- smoke workdir logs: control-plane timeout versus concrete workload failure

## PR #120 example

- Agent node: `NotReady`
- Events: flannel `subnet.env` failures and `CIDRAssignmentFailed`
- Tenant resources: absent from captured cluster resources
- Control plane: timed out waiting for tenant readiness after cluster instability

Verdict: likely CI/bootstrap fragility, not evidence of a persistent-lane code regression.
