-- Add location_deleted flag to backup_catalog (#333).
--
-- Tracks whether the blob at `location` has been removed by the retention
-- sweep. A completed backup row whose blob was deleted is kept in the catalog
-- for audit purposes; this flag marks it as no longer restorable so the
-- restore endpoint can surface a clear error instead of a 404 from Azure.
--
-- Design decision — Option 1 (location_deleted flag):
--   Adding a boolean column is lighter than a join against live blob names at
--   restore time (Option 2). The sweep already iterates blobs serially; it is
--   cheap to UPDATE the matching catalog row immediately after deleteBlob()
--   succeeds. If the DB write fails after the blob is deleted, the row stays
--   with location_deleted = false — a stale row rather than a crash. The
--   scheduler logs a warning and continues.
--
-- Default false: all existing rows have intact blobs (or are failed/canceled
-- rows with no location). Setting the default to false means no backfill is
-- needed.
--
-- Note: this ALTER TABLE rewrites the table on Postgres 12+ only when the
-- default is not a volatile expression; for a boolean constant the column is
-- added as a catalog-only change in Postgres 11+ (fast path). At control-plane
-- scale this is safe regardless of Postgres version.

ALTER TABLE backup_catalog
ADD COLUMN IF NOT EXISTS location_deleted BOOLEAN NOT NULL DEFAULT false;
