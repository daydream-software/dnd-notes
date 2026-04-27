---
name: "kubectl-explicit-context"
description: "Keep helper scripts from mutating the caller's kube context when they only need to target a specific cluster."
domain: "tooling"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Audit helper scripts for `kubectl config use-context` and validate behavior with focused script tests."
    when: "A local helper targets one Kubernetes cluster but should not leave developers in a different current context."
---

## Context
Use this when a contributor-facing shell helper only needs to run a handful of
`kubectl` commands against a known cluster. Prefer explicit per-command targeting
over mutating global kubeconfig state.

## Patterns
- For read-only or one-shot helpers, prefer `kubectl --context "k3d-${CLUSTER_NAME}" ...`.
- Apply the explicit context consistently, including helper functions and
  process substitutions that call `kubectl get ...`.
- If a longer flow truly must call `kubectl config use-context`, capture the
  previous context best-effort and restore it in an `EXIT` trap.
- Treat unexpected kube-context persistence as a developer-experience bug, not
  an acceptable implementation detail.
- Add a focused regression or script-level assertion when a helper previously
  leaked context.

## Anti-Patterns
- Switching context in a status or teardown helper and leaving the developer in
  that cluster afterward.
- Relying on "users can switch it back manually" as the only mitigation.
