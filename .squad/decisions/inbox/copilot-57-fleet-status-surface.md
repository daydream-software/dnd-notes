# Issue #57 fleet status surface

- **Status:** decided
- **Issue:** #57
- **Decision:** The first shipped slice of `#57` is an authenticated, read-only control-plane endpoint at `GET /internal/fleet/status`, not a standalone UI. It returns control-plane health, dependency status, fleet summary counts, and per-tenant status details including lifted backup metadata fields when they already exist in JSON.
- **Why:** The repo already has an internal control-plane API surface, while issue `#68` owns the richer operator portal. Shipping the fleet-status contract first gives operators one canonical source of truth, keeps the slice thin, and creates a stable data source for both a later internal dashboard and any future redacted public status page.
- **Implications:** `backupMetadata` remains opaque in storage; the status surface only lifts known fields such as `lastBackupAt`, `lastBackupStatus`, `lastRestoreDrillAt`, `lastRestoreDrillStatus`, and `location` when present. Future UI work should consume this contract instead of inventing a parallel status aggregation path.
