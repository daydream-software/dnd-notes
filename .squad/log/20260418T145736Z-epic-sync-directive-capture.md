# Session Log: Epic Sync Directive Capture & GitHub Synchronization

**Date:** 2026-04-18T14:57:36Z  
**Actors:** FFMikha (user), Mikey (implementer), Copilot (directive logger)  
**Topic:** GitHub epic #42 synchronization to squad decisions; standing practice codified

---

## What Happened

1. **FFMikha directive:** Keep GitHub epics in sync with squad decisions so the visible source (GitHub issues) stays synchronized with the canonical decision log.
2. **Mikey implementation:** Updated GitHub issue #42 body to reflect locked platform direction post-Postgres-decision:
   - Tenant persistence: Postgres (one DB per tenant)
   - Live data: managed block storage
   - Backups: Blob/object storage
   - Infrastructure: ghcr.io, ingress-nginx, cert-manager (wildcard DNS-01), K8s Secrets
   - Dropped: OKE/ARM from current plan
   - Added: Phase 0 includes NoteStore Postgres migration (#46)
   - Added syncing comment linking to `.squad/decisions.md`

3. **Verification:** Issue body now reflects the locked decisions; child issues (#43, #46, #52, etc.) can reference the updated epic for current architecture.

## Decisions Made

- **Postgres direction locked:** User accepted post-review Postgres-based tenant persistence (one DB per tenant, managed block storage, Blob backups).
- **Standing practice codified:** GitHub epics stay synchronized with `.squad/decisions.md` on the same day decisions are made.

## Outcomes

✅ Epic #42 synchronized  
✅ Directive captured for team memory  
✅ Synchronization comment established (GitHub comments now link to `.squad/decisions.md`)  
✅ Standing practice: Epic sync becomes default behavior going forward

## Files Changed

- **External:** GitHub issue #42 (issue body + syncing comment)
- **Internal:** Directive captured to `.squad/decisions/inbox/copilot-directive-2026-04-18T14-54-06Z.md` (pending merge to `.squad/decisions.md`)
- **Orchestration:** This log + dedicated orchestration entry

---

## Next Steps

1. Scribe merges directive to `.squad/decisions.md`
2. Team practices epic synchronization on all future platform decisions
3. Epic #42 is now the public-facing source of truth (synchronized with squad decisions)
