# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Copilot enabled as autonomous coding agent for squad via auto-assignment to squad:copilot issues.

## Recent Updates

📌 Team update (2026-04-18T02:25:33Z): Epic #42 clarification backlog added to GitHub issue #42. Platform gaps tracked for next discussion: local k3d/k3s dev loop, ingress/DNS/TLS, SQLite backup, single-writer choreography, control-plane/tenant contract, lifecycle state machine, auth migration to OIDC, version-skew policy, CI coverage. — Scribe
📌 Team update (2026-04-18T14:57:36Z): EPIC SYNC DIRECTIVE CODIFIED — User directive: when the team makes decisions on an epic, update the GitHub epic so the visible GitHub source stays synchronized with squad decisions. Standing practice established. Mikey synchronized GitHub issue #42 (body + syncing comment) to reflect locked platform direction (Postgres, ghcr.io, ingress-nginx, cert-manager wildcard DNS-01, K8s Secrets, dropped OKE/ARM). Directive merged to `.squad/decisions.md` and captured in orchestration/session logs. — Scribe
📌 Team update (2026-04-18T14:57:36Z): EPIC SYNC DIRECTIVE CODIFIED — User directive: when the team makes decisions on an epic, update the GitHub epic so the visible GitHub source stays synchronized with squad decisions. Standing practice established. Mikey synchronized GitHub issue #42 (body + syncing comment) to reflect locked platform direction (Postgres, ghcr.io, ingress-nginx, cert-manager wildcard DNS-01, K8s Secrets, dropped OKE/ARM). Directive merged to `.squad/decisions.md` and captured in orchestration/session logs. — Scribe

**[8 older updates archived to decisions.md/orchestration-log]**

## 2026-04-21
- Picked up issue #55 in worktree `.worktrees/55-rolling-update-choreography`; target slice is Postgres-backed tenant rolling-update choreography plus explicit drain semantics, with stale squad branch/worktree cleanup checked first.
- Completed issue #55 thin slice as an implementation-backed docs update: tenant provisioning now encodes explicit RollingUpdate settings, rollout docs were updated in README/RUNTIME/control-plane docs, issue #55 body was rewritten to the Postgres-backed scope, and focused control-plane/API validation passed.
