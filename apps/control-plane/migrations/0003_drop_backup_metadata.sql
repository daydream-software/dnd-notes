-- @migration:destructive
-- Drop the legacy free-form `tenants.backup_metadata` TEXT column. Backup
-- state now lives in `backup_catalog` / `restore_log` (see 0002 and #89).
--
-- The legacy column was unstructured opaque text. It carried no committed
-- schema and no callers persisted it after #89 shipped, so dropping it
-- without a copy step is intentional — there is no structured value to
-- migrate. Operators who recorded ad-hoc notes there should retrieve them
-- from a database snapshot taken before this migration runs.

ALTER TABLE tenants DROP COLUMN IF EXISTS backup_metadata; -- @migration:destructive
