## 2026-04-14T15:52:31Z: Squad upgrade cleanup orchestration

**Agent:** Brand (Platform Dev)  
**Requested by:** FFMikha  
**Mode:** Background

**Work:** Audit `.github/workflows/` for floating refs and repo fit post-squad-upgrade. Restore SHA pinning on kept workflows. Remove upgrade-added workflows that don't fit repo topology. Validate build/test/lint.

**Decisions created:**
- `brand-fix-upgrade-pinning.md`: Squad upgrade workflow syncs audited; kept set SHA-pinned; wrong-fit workflows removed
- `brand-web-test-infra.md`: Web test CI fixed via root workspace scripts + focused smoke lane

**Status:** Delegated. Awaiting Brand completion.
