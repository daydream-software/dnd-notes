# Orchestration Log: Epic Sync Directive to Team Practice

**Timestamp:** 2026-04-18T14:57:36Z  
**Context:** FFMikha directed that GitHub epics stay synchronized with squad decisions. Mikey implemented the sync on issue #42 (GitHub epic body + comment). Directive captured for standing team practice.

## What Happened

1. **User directive:** FFMikha — "Update the GitHub epic whenever the team makes decisions on that epic so the visible GitHub source stays in sync with squad decisions."
2. **Implementation:** Mikey synchronized GitHub issue #42 body to reflect locked platform direction (Postgres, ghcr.io, ingress-nginx, cert-manager, K8s Secrets, dropped OKE/ARM).
3. **Result verified:** Issue #42 now reflects the canonical squad decisions; syncing comment links to squad decisions log.

## Standing Practice

- GitHub epics (issues tagged `epic`) are the **public-facing source of truth** for architecture and planning.
- `.squad/decisions.md` is the **team-internal canonical decision log**.
- **Whenever squad makes a decision on an epic:** update the GitHub issue body the same day to stay synchronized.
- **Avoid stale architecture:** issue comments and child-issue understanding depend on up-to-date epic descriptions.

## Files Touched

- GitHub issue #42: Epic body + sync comment (external, synced with `.squad/decisions.md`)
- `.squad/decisions.md`: Postgres decision locked (internal)

## Impact

Team practice now includes standing directive: **GitHub epics stay synchronized with decisions.md**. FFMikha's request becomes operational policy.
