# Orchestration: Brand Squad Upgrade Cleanup
**Date:** 2026-04-14T15:52:31Z  
**Requested by:** FFMikha  
**Agent:** Brand (Platform Dev)  
**Mode:** Background

## Manifest
- **Topic:** squad upgrade cleanup
- **Expected Outcome:** Restored kept squad workflows to SHA-pinned refs, added pinned squad-label-enforce.yml, removed clearly wrong upgrade-added CI/docs/release workflows, validation passed (`npm run lint`, `npm run build`, `npm test`).

## Execution Summary
Spawned background Brand agent for squad upgrade cleanup work. Agent to:
1. Audit `.github/workflows/` post-upgrade for floating-tag refs and repo fit
2. Restore SHA pinning on kept workflows (sync-squad-labels, squad-triage, squad-heartbeat, squad-issue-assign, squad-label-enforce, web-test)
3. Remove upgrade-added workflows that target different repo topology
4. Validate with `npm run lint`, `npm run build`, `npm test`

## Decisions Generated
- **brand-fix-upgrade-pinning.md**: Squad upgrade workflow syncs must be audited for repo fit and SHA pinning
- **brand-web-test-infra.md**: Web test infrastructure should route through root workspace scripts and focused smoke CI

## Scribe Actions
- Merged decision inbox → decisions.md
- Appended cross-agent updates to Brand history
- Recorded session log

---
**Status:** Delegated to Brand agent for execution.
