-- Backup catalog, restore log, and control-plane audit log (#89).
--
-- Replaces the free-form `tenants.backup_metadata` text blob with first-class
-- run tables. The destructive drop of `backup_metadata` itself happens in a
-- separate destructive-tagged migration (0003) so this expand step can ship
-- against pods that still read the legacy column.

CREATE TABLE IF NOT EXISTS backup_catalog (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'completed', 'failed', 'canceled'
  )),
  format TEXT NOT NULL DEFAULT 'custom',
  location TEXT,
  size_bytes BIGINT,
  checksum TEXT,
  failure_reason TEXT,
  triggered_by TEXT NOT NULL,
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_verification_status TEXT CHECK (
    last_verification_status IS NULL
    OR last_verification_status IN ('passed', 'failed')
  ),
  last_verification_details TEXT,
  scratch_target TEXT,
  CHECK (
    status <> 'completed'
    OR (location IS NOT NULL AND completed_at IS NOT NULL)
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_backup_catalog_tenant_id
  ON backup_catalog(tenant_id);

CREATE INDEX IF NOT EXISTS idx_backup_catalog_tenant_completed_at
  ON backup_catalog(tenant_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_backup_catalog_status
  ON backup_catalog(status);

CREATE TABLE IF NOT EXISTS restore_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  backup_id TEXT REFERENCES backup_catalog(id) ON DELETE SET NULL,
  backup_location TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'completed', 'failed', 'canceled'
  )),
  failure_reason TEXT,
  safety_snapshot_id TEXT REFERENCES backup_catalog(id) ON DELETE SET NULL,
  triggered_by TEXT NOT NULL,
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_restore_log_tenant_id
  ON restore_log(tenant_id);

CREATE INDEX IF NOT EXISTS idx_restore_log_tenant_requested_at
  ON restore_log(tenant_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_restore_log_status
  ON restore_log(status);

CREATE TABLE IF NOT EXISTS control_plane_audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'requested', 'succeeded', 'failed'
  )),
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_control_plane_audit_log_tenant_id
  ON control_plane_audit_log(tenant_id);

CREATE INDEX IF NOT EXISTS idx_control_plane_audit_log_action_created_at
  ON control_plane_audit_log(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_control_plane_audit_log_created_at
  ON control_plane_audit_log(created_at DESC);
