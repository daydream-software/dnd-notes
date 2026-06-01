-- Fleet rolling-update tables (#415)
-- Two new tables: fleet_rollouts (one row per rollout job) and
-- fleet_rollout_tenants (one row per tenant participating in the rollout).
-- Advisory-lock key (0, 1) is reserved for the fleet-rollout orchestrator.

CREATE TABLE fleet_rollouts (
  id              TEXT PRIMARY KEY,            -- prefix 'rl_'
  target_version  TEXT NOT NULL,
  status          TEXT NOT NULL,               -- 'running' | 'completed' | 'aborted' | 'failed'
  triggered_by    TEXT NOT NULL,               -- portal account / user id
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  abort_reason    TEXT,
  failed_tenant   TEXT,                        -- tenant_id where the rollout halted (status='failed')
  failed_error    TEXT
);

-- Partial index for the "is there already a running rollout?" lookup at rollout start.
-- NOTE: pg-mem's partial-index support is limited; the index is advisory in tests.
CREATE INDEX fleet_rollouts_status_running ON fleet_rollouts (status) WHERE status = 'running';

CREATE TABLE fleet_rollout_tenants (
  rollout_id   TEXT NOT NULL REFERENCES fleet_rollouts(id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL,
  status       TEXT NOT NULL,                  -- 'pending' | 'succeeded' | 'failed' | 'skipped'
  reason       TEXT,                           -- skip reason or error message
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  PRIMARY KEY (rollout_id, tenant_id)
);
