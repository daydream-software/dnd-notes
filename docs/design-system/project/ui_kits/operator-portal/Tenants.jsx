/* eslint-disable */
const { useState: useStateTenant, useMemo: useMemoTenant, useEffect: useEffectTenant } = React;

const STATE_VARIANT = {
  ready: 'success',
  sleeping: 'muted',
  provisioning: 'warn',
  upgrading: 'warn',
  restoring: 'warn',
  maintenance: 'warn',
  failed: 'muted',
  deprovisioned: 'muted',
};

const STATE_FG = {
  ready: 'var(--success)',
  sleeping: 'var(--info)',
  provisioning: 'var(--warn)',
  upgrading: 'var(--warn)',
  restoring: 'var(--warn)',
  maintenance: 'var(--warn)',
  failed: 'var(--error)',
  deprovisioned: 'var(--fg-muted)',
};

function formatStateLabel(s) { return s.slice(0, 1).toUpperCase() + s.slice(1); }

// Per-tenant observability mock (#402). In production these are computed by
// the control-plane from state_transitions + tenant_activity + cluster metrics.
// Keyed by tenant.id so the seed in App.jsx stays untouched.
const TENANT_OBS = {
  't_2KqM91': { memoryMb: 312, memoryLimitMb: 512, restartCount: 0, uptimePct: 99.9,  lastWakeAt: '6d ago',  seenByActivator: true,  anomalies: [] },
  't_3PzN02': { memoryMb: null, memoryLimitMb: 512, restartCount: 0, uptimePct: null, lastWakeAt: null,      seenByActivator: false, anomalies: [] },
  't_4RxK77': { memoryMb: 12,   memoryLimitMb: 512, restartCount: 0, uptimePct: 95.2, lastWakeAt: '18d ago', seenByActivator: false, anomalies: ['stuck-sleeping'] },
  't_5SLk89': { memoryMb: 478,  memoryLimitMb: 512, restartCount: 4, uptimePct: 82.1, lastWakeAt: '11h ago', seenByActivator: true,  anomalies: ['oom-restart-cycle'] },
  't_6TmL45': { memoryMb: 220,  memoryLimitMb: 512, restartCount: 1, uptimePct: 99.4, lastWakeAt: '4h ago',  seenByActivator: true,  anomalies: ['flapping'] },
  't_7UmP12': { memoryMb: 8,    memoryLimitMb: 512, restartCount: 0, uptimePct: 99.7, lastWakeAt: '4h ago',  seenByActivator: true,  anomalies: [] },
};

const ANOMALY_LABELS = {
  'stuck-sleeping':    { label: 'Stuck sleeping',    tone: 'warn',  reason: 'Current state sleeping AND not seen by activator. Idle-scaler may have desynced.' },
  'oom-restart-cycle': { label: 'OOM restart cycle', tone: 'error', reason: 'Restart count climbing on this deployment. Inspect pod for OOMKilled events.' },
  'flapping':          { label: 'Flapping',          tone: 'warn',  reason: 'Frequent ready ↔ sleeping transitions in a short window.' },
  'never-woke':        { label: 'Never woke',        tone: 'warn',  reason: 'Tenant has slept without a wake since provisioning.' },
};

function formatMemory(mb, limit) {
  if (mb == null) return '—';
  const pct = limit ? Math.round((mb / limit) * 100) : null;
  return pct != null ? `${mb} / ${limit} MB · ${pct}%` : `${mb} MB`;
}

function memoryTone(mb, limit) {
  if (mb == null || !limit) return 'var(--fg-muted)';
  const pct = mb / limit;
  if (pct >= 0.85) return 'var(--error)';
  if (pct >= 0.65) return 'var(--warn)';
  return 'var(--fg-1)';
}

function ControlPlaneStatus({ fleet }) {
  const cp = fleet.controlPlane;
  return (
    <OperatorCard>
      <SectionHeader
        eyebrow="Control plane"
        title="Live fleet status"
        subtitle={`Generated ${fleet.generatedAt} · version ${cp.version} · uptime ${cp.uptime}`}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip variant="success">
          <span className="material-symbols-rounded" style={{ fontSize: 14, marginRight: 2 }}>check_circle</span>
          Control plane {cp.status}
        </Chip>
        <Chip variant={fleet.dependencies.tenantRegistry.status === 'healthy' ? 'success' : 'warn'}>
          Tenant registry {fleet.dependencies.tenantRegistry.status}
        </Chip>
        <Chip variant={fleet.dependencies.tenantProvisioning.status === 'healthy' ? 'success' : 'warn'}>
          Provisioning {fleet.dependencies.tenantProvisioning.status}
        </Chip>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 1,
        background: 'var(--brand-tint)',
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid var(--brand-line-soft)',
      }}>
        {Object.entries(fleet.summary.tenantsByCurrentState).map(([state, n]) => (
          <div key={state} style={{ background: 'var(--bg-paper-soft)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{state}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: STATE_FG[state] || 'var(--fg-1)', fontFeatureSettings: '"tnum"' }}>{n}</span>
          </div>
        ))}
      </div>
    </OperatorCard>
  );
}

function ProvisionPanel({ suggestedVersion, disabledReason, onSubmit, isSubmitting }) {
  const [open, setOpen] = useStateTenant(false);
  const [draft, setDraft] = useStateTenant({
    slug: '', ownerId: '', initialAdminEmail: '', version: suggestedVersion || '1.4.2', reason: '',
  });
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const disabled = Boolean(disabledReason) || isSubmitting;

  const headerAction = (
    <Button
      variant={open ? 'outlined' : 'contained'}
      icon={open ? 'close' : 'add_circle'}
      onClick={() => setOpen((v) => !v)}
      disabled={Boolean(disabledReason)}
    >
      {open ? 'Cancel' : 'Provision new tenant'}
    </Button>
  );

  return (
    <OperatorCard>
      <SectionHeader
        eyebrow="Tenant lifecycle"
        title="Provision tenant"
        subtitle="Creates a tenant record then calls /internal/tenants/:id/provision after explicit review. The portal records initialAdminEmail on the create contract for downstream bootstrap."
        action={headerAction}
      />
      {disabledReason ? (
        <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.24)', color: 'var(--warn)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>warning</span>
          <span>{disabledReason}</span>
        </div>
      ) : null}
      {open ? (
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(draft); setOpen(false); }} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <Field label="Tenant slug" help="Lowercase, hyphenated. Becomes the subdomain.">
            <Input icon="badge" value={draft.slug} onChange={(v) => set('slug', v)} placeholder="crimson-court" />
          </Field>
          <Field label="Owner ID" help="Customer-portal account that owns this tenant.">
            <Input icon="person" value={draft.ownerId} onChange={(v) => set('ownerId', v)} placeholder="usr_2K9pVx" />
          </Field>
          <Field label="Initial admin email" help="Recorded for downstream bootstrap.">
            <Input icon="mail" value={draft.initialAdminEmail} onChange={(v) => set('initialAdminEmail', v)} placeholder="dm@table.example" />
          </Field>
          <Field label="Version" help={`Suggested from majority fleet version (${suggestedVersion}).`}>
            <Input icon="sell" value={draft.version} onChange={(v) => set('version', v)} placeholder="1.4.2" />
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Reason (audit trail)">
              <Input icon="edit_note" value={draft.reason} onChange={(v) => set('reason', v)} placeholder="Onboard new guild customer" />
            </Field>
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <Button variant="outlined" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" icon="rocket_launch" disabled={disabled}>
              {isSubmitting ? 'Provisioning…' : 'Review & provision'}
            </Button>
          </div>
        </form>
      ) : null}
    </OperatorCard>
  );
}

function HealthDot({ healthy }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: healthy ? 'var(--success)' : 'var(--warn)',
      boxShadow: `0 0 0 3px ${healthy ? 'rgba(74,222,128,0.18)' : 'rgba(245,158,11,0.18)'}`,
      display: 'inline-block',
    }} />
  );
}

// MetaRow is declared here but called from Dialogs.jsx via the babel-standalone
// shared global scope (no module imports in this kit). The TypeScript "unused"
// warning is a false positive — cross-file usage is invisible to tsc.
function MetaRow({ icon, label, value, mono }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 13 }}>{icon}</span>
        {label}
      </span>
      <span style={{
        fontSize: 13,
        color: 'var(--fg-1)',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}

// ----- #402 — Anomaly banner -----

function AnomalyBanner({ tenants }) {
  const items = useMemoTenant(() => {
    const out = [];
    tenants.forEach((s) => {
      const obs = TENANT_OBS[s.tenant.id];
      if (!obs) return;
      obs.anomalies.forEach((a) => {
        const meta = ANOMALY_LABELS[a];
        if (meta) out.push({ slug: s.tenant.slug, id: s.tenant.id, kind: a, ...meta });
      });
    });
    return out;
  }, [tenants]);

  if (items.length === 0) return null;

  const errCount = items.filter((i) => i.tone === 'error').length;
  const warnCount = items.length - errCount;

  return (
    <div style={{
      borderRadius: 18,
      background: errCount > 0 ? 'rgba(248,113,113,0.08)' : 'rgba(245,158,11,0.08)',
      border: `1px solid ${errCount > 0 ? 'rgba(248,113,113,0.28)' : 'rgba(245,158,11,0.28)'}`,
      padding: '14px 18px',
      display: 'flex',
      gap: 14,
      alignItems: 'flex-start',
    }}>
      <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: 22, color: errCount > 0 ? 'var(--error)' : 'var(--warn)', marginTop: 1 }}>
        {errCount > 0 ? 'error' : 'warning'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-1)' }}>
          {items.length} anomal{items.length === 1 ? 'y' : 'ies'} detected
          {errCount > 0 && warnCount > 0 ? ` · ${errCount} critical, ${warnCount} warning` : ''}
          {errCount > 0 && warnCount === 0 ? ` · ${errCount} critical` : ''}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {items.map((i) => (
            <Chip key={`${i.id}-${i.kind}`} variant={i.tone === 'error' ? 'muted' : 'warn'}>
              <span className="material-symbols-rounded" style={{ fontSize: 13, marginRight: 4, color: i.tone === 'error' ? 'var(--error)' : 'var(--warn)' }}>
                {i.tone === 'error' ? 'error' : 'warning'}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{i.slug}</span>
              <span style={{ marginLeft: 6, opacity: 0.8 }}>{i.label}</span>
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----- #404 — Fleet rolling-update panel -----

const ROLLOUT_DEMO_STATES = ['idle', 'running', 'completed', 'aborted', 'failed'];

function mockRollout(kind, total) {
  if (kind === 'idle') return null;
  const base = { id: 'rl_demo', targetVersion: '1.4.3', triggeredBy: 'mikha@daydream.software', total, startedAt: '14:32:08 UTC', endedAt: null };
  if (kind === 'running')   return { ...base, status: 'running',   completed: 2, failed: 0, skipped: 1, currentTenant: 'iron-vault',   elapsed: '4m 12s' };
  if (kind === 'completed') return { ...base, status: 'completed', completed: total - 1, failed: 0, skipped: 1, currentTenant: null, elapsed: '12m 03s', endedAt: '14:44:11 UTC' };
  if (kind === 'aborted')   return { ...base, status: 'aborted',   completed: 2, failed: 0, skipped: 1, currentTenant: null, elapsed: '5m 47s', endedAt: '14:37:55 UTC', abortReason: 'Pausing — investigating arcane-archives flapping before continuing.' };
  if (kind === 'failed')    return { ...base, status: 'failed',    completed: 2, failed: 1, skipped: 1, currentTenant: null, failedTenant: 'pale-watch', failedError: 'PVC migration failed: insufficient block storage in eu-west-1b.', elapsed: '8m 21s', endedAt: '14:40:29 UTC' };
  return null;
}

function FleetRolloutPanel({ rollout, setRollout, suggestedVersion, totalTenants, mutationDisabled }) {
  const [demoKind, setDemoKind] = useStateTenant('idle');
  const [composeOpen, setComposeOpen] = useStateTenant(false);
  const [targetVersion, setTargetVersion] = useStateTenant(suggestedVersion || '1.4.3');

  // Demo toggle: in production rollout state comes from the control-plane API.
  // The chip row at the bottom of this panel cycles through visual states so
  // reviewers can constate each one without seeding fake data per state.
  useEffectTenant(() => {
    setRollout(mockRollout(demoKind, totalTenants));
  }, [demoKind, totalTenants, setRollout]);

  const isRunning = rollout?.status === 'running';
  const progressPct = rollout && rollout.total
    ? Math.round(((rollout.completed + rollout.failed + rollout.skipped) / rollout.total) * 100)
    : 0;

  return (
    <OperatorCard>
      <SectionHeader
        eyebrow="Fleet lifecycle"
        title="Fleet rolling update"
        subtitle="Roll a new version progressively across every eligible tenant — one at a time, serialized server-side. Closing the tab does not stop the rollout; the portal can abort it at any time."
        action={
          !rollout && !composeOpen ? (
            <Button
              icon="rocket_launch"
              onClick={() => setComposeOpen(true)}
              disabled={Boolean(mutationDisabled)}
            >
              Roll fleet to version…
            </Button>
          ) : null
        }
      />

      {composeOpen && !rollout ? (
        <div style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          padding: 14,
          borderRadius: 14,
          background: 'var(--bg-paper-soft)',
          border: '1px solid var(--brand-line-soft)',
        }}>
          <div style={{ flex: '1 1 240px', minWidth: 200 }}>
            <Field label="Target version" help={`Suggested from majority fleet version (${suggestedVersion}).`}>
              <Input icon="sell" value={targetVersion} onChange={setTargetVersion} placeholder="1.4.3" />
            </Field>
          </div>
          <Button variant="outlined" onClick={() => setComposeOpen(false)}>Cancel</Button>
          <Button
            icon="rocket_launch"
            disabled={!targetVersion.trim() || Boolean(mutationDisabled)}
            onClick={() => { setComposeOpen(false); setDemoKind('running'); }}
          >
            Start rollout
          </Button>
        </div>
      ) : null}

      {rollout ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-1)' }}>
                Rolling to{' '}
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{rollout.targetVersion}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
                Started {rollout.startedAt} by{' '}
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-1)' }}>{rollout.triggeredBy}</span>
                {rollout.endedAt ? ` · ended ${rollout.endedAt}` : ''}
                {' · elapsed '}{rollout.elapsed}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {isRunning ? (
                <Button danger icon="cancel" onClick={() => setDemoKind('aborted')}>Abort rollout</Button>
              ) : (
                <Button variant="text" icon="close" onClick={() => setDemoKind('idle')}>Dismiss</Button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div style={{
              height: 6,
              borderRadius: 999,
              background: 'var(--brand-tint)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${progressPct}%`,
                height: '100%',
                background: rollout.status === 'failed' ? 'var(--error)'
                  : rollout.status === 'aborted' ? 'var(--warn)'
                  : rollout.status === 'completed' ? 'var(--success)'
                  : 'var(--accent)',
                transition: 'width 300ms ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12.5, color: 'var(--fg-3)' }}>
              <span>
                {rollout.completed + rollout.failed + rollout.skipped} / {rollout.total} tenants processed
                {' · '}
                <span style={{ color: 'var(--success)' }}>{rollout.completed} succeeded</span>
                {rollout.skipped > 0 ? <> · <span style={{ color: 'var(--fg-muted)' }}>{rollout.skipped} skipped</span></> : null}
                {rollout.failed > 0 ? <> · <span style={{ color: 'var(--error)' }}>{rollout.failed} failed</span></> : null}
              </span>
              {isRunning && rollout.currentTenant ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 14, color: 'var(--accent)' }}>autorenew</span>
                  Currently rolling{' '}
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-1)' }}>{rollout.currentTenant}</span>
                </span>
              ) : null}
            </div>
          </div>

          {/* Terminal-state callouts */}
          {rollout.status === 'failed' ? (
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.28)', color: 'var(--error)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>error</span>
              <span>
                Halted at <span style={{ fontFamily: 'var(--font-mono)' }}>{rollout.failedTenant}</span>. {rollout.failedError} Already-upgraded tenants are left as-is — no rollback.
              </span>
            </div>
          ) : null}
          {rollout.status === 'aborted' ? (
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.28)', color: 'var(--warn)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>cancel</span>
              <span>
                Rollout aborted. The tenant mid-provision was allowed to finish; remaining tenants were not started. {rollout.abortReason}
              </span>
            </div>
          ) : null}
          {rollout.status === 'completed' ? (
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.28)', color: 'var(--success)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>check_circle</span>
              <span>Rolled {rollout.completed} tenant{rollout.completed === 1 ? '' : 's'} to {rollout.targetVersion}. {rollout.skipped} skipped (sleeping or deprovisioned).</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Mock demo toggle — not present in production */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px dashed var(--brand-line-faint)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          Demo state
        </span>
        {ROLLOUT_DEMO_STATES.map((k) => (
          <Chip
            key={k}
            variant={demoKind === k ? 'brand-solid' : 'muted'}
            onClick={() => setDemoKind(k)}
          >
            {k}
          </Chip>
        ))}
      </div>
    </OperatorCard>
  );
}

// ----- #403 — Sortable tenant table -----

function SortHeader({ label, sortKey, sortBy, sortDir, onSort, align = 'left' }) {
  const active = sortBy === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        textAlign: align,
        padding: '12px 14px',
        fontSize: 11.5,
        fontWeight: 600,
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
        background: 'var(--bg-paper-soft)',
        borderBottom: '1px solid var(--brand-line-soft)',
        position: 'sticky',
        top: 0,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {active ? (
          <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: 14 }}>
            {sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
          </span>
        ) : null}
      </span>
    </th>
  );
}

const TD_BASE = {
  padding: '12px 14px',
  fontSize: 13,
  color: 'var(--fg-1)',
  borderBottom: '1px solid var(--brand-line-faint)',
  verticalAlign: 'top',
};

function TenantTable({ tenants, mutationDisabled, onUpgrade, onDeprovision }) {
  const [stateFilter, setStateFilter] = useStateTenant('all');
  const [query, setQuery] = useStateTenant('');
  const [sortBy, setSortBy] = useStateTenant('slug');
  const [sortDir, setSortDir] = useStateTenant('asc');

  const filtered = useMemoTenant(() => {
    return tenants.filter((s) => {
      if (stateFilter !== 'all' && s.tenant.currentState !== stateFilter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return s.tenant.slug.includes(q) || s.tenant.id.includes(q) || (s.tenant.ownerId || '').includes(q);
    });
  }, [tenants, stateFilter, query]);

  const sorted = useMemoTenant(() => {
    const list = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const oa = TENANT_OBS[a.tenant.id] || {};
      const ob = TENANT_OBS[b.tenant.id] || {};
      const getVal = (s, obs) => {
        if (sortBy === 'slug') return s.tenant.slug;
        if (sortBy === 'state') return s.tenant.currentState;
        if (sortBy === 'version') return s.tenant.version;
        if (sortBy === 'memory') return obs.memoryMb ?? -1;
        if (sortBy === 'uptime') return obs.uptimePct ?? -1;
        if (sortBy === 'restarts') return obs.restartCount ?? -1;
        return s.tenant.slug;
      };
      const va = getVal(a, oa); const vb = getVal(b, ob);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  }, [filtered, sortBy, sortDir]);

  const toggleSort = (key) => {
    if (key === sortBy) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  const states = ['all', 'ready', 'sleeping', 'provisioning', 'upgrading', 'restoring', 'maintenance', 'failed', 'deprovisioned'];

  return (
    <OperatorCard>
      <SectionHeader
        eyebrow="Tenant fleet"
        title={`${tenants.length} tenant${tenants.length === 1 ? '' : 's'}`}
        subtitle="Sortable. Memory, uptime, and last wake come from the per-tenant observability slice (#402). Use the row actions for per-tenant upgrade or deprovision."
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {states.map((s) => (
            <Chip key={s} active={stateFilter === s} variant="muted" onClick={() => setStateFilter(s)}>
              {s === 'all' ? 'All states' : formatStateLabel(s)}
            </Chip>
          ))}
        </div>
        <div style={{ width: 280 }}>
          <Input icon="search" value={query} onChange={setQuery} placeholder="Filter by slug, id, owner…" onClear={() => setQuery('')} />
        </div>
      </div>

      <div style={{
        overflowX: 'auto',
        borderRadius: 14,
        border: '1px solid var(--brand-line-soft)',
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          background: 'var(--bg-paper-soft)',
          fontFamily: 'inherit',
        }}>
          <thead>
            <tr>
              <SortHeader label="Tenant"   sortKey="slug"     sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="State"    sortKey="state"    sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Version"  sortKey="version"  sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Memory"   sortKey="memory"   sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              <SortHeader label="Restarts" sortKey="restarts" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" />
              <SortHeader label="Uptime"   sortKey="uptime"   sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" />
              <th style={{ ...TD_BASE, fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', background: 'var(--bg-paper-soft)', borderBottom: '1px solid var(--brand-line-soft)', position: 'sticky', top: 0, whiteSpace: 'nowrap' }}>Last transition</th>
              <th style={{ ...TD_BASE, fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', background: 'var(--bg-paper-soft)', borderBottom: '1px solid var(--brand-line-soft)', position: 'sticky', top: 0, whiteSpace: 'nowrap', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...TD_BASE, padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>
                  No tenants match this filter.
                </td>
              </tr>
            ) : sorted.map((s) => (
              <TenantTableRow
                key={s.tenant.id}
                status={s}
                obs={TENANT_OBS[s.tenant.id]}
                mutationDisabled={mutationDisabled}
                onUpgrade={onUpgrade}
                onDeprovision={onDeprovision}
              />
            ))}
          </tbody>
        </table>
      </div>
    </OperatorCard>
  );
}

function TenantTableRow({ status, obs, mutationDisabled, onUpgrade, onDeprovision }) {
  const [hover, setHover] = useStateTenant(false);
  const t = status.tenant;
  const isDeprovisioned = t.currentState === 'deprovisioned';
  const canRoll = t.currentState === 'ready' || t.currentState === 'sleeping';
  const o = obs || {};

  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ background: hover ? 'var(--action-hover)' : 'transparent', transition: 'background 150ms' }}
    >
      {/* Tenant */}
      <td style={{ ...TD_BASE, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <HealthDot healthy={status.health === 'healthy'} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-1)' }}>{t.slug}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg-muted)' }}>{t.id}</span>
          </div>
        </div>
        {o.anomalies && o.anomalies.length > 0 ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {o.anomalies.map((a) => {
              const meta = ANOMALY_LABELS[a];
              if (!meta) return null;
              return (
                <span
                  key={a}
                  title={meta.reason}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    background: meta.tone === 'error' ? 'rgba(248,113,113,0.14)' : 'rgba(245,158,11,0.14)',
                    color: meta.tone === 'error' ? 'var(--error)' : 'var(--warn)',
                    border: `1px solid ${meta.tone === 'error' ? 'rgba(248,113,113,0.32)' : 'rgba(245,158,11,0.32)'}`,
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                    {meta.tone === 'error' ? 'error' : 'warning'}
                  </span>
                  {meta.label}
                </span>
              );
            })}
          </div>
        ) : null}
      </td>

      {/* State */}
      <td style={TD_BASE}>
        <Chip variant={STATE_VARIANT[t.currentState] || 'muted'}>{formatStateLabel(t.currentState)}</Chip>
        {t.desiredState !== t.currentState ? (
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
            desired {formatStateLabel(t.desiredState)}
          </div>
        ) : null}
      </td>

      {/* Version */}
      <td style={{ ...TD_BASE, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
        {t.version}
      </td>

      {/* Memory */}
      <td style={{ ...TD_BASE, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: memoryTone(o.memoryMb, o.memoryLimitMb), whiteSpace: 'nowrap' }}>
        {formatMemory(o.memoryMb, o.memoryLimitMb)}
      </td>

      {/* Restarts */}
      <td style={{ ...TD_BASE, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: o.restartCount > 1 ? 'var(--error)' : 'var(--fg-1)', textAlign: 'right' }}>
        {o.restartCount != null ? o.restartCount : '—'}
      </td>

      {/* Uptime */}
      <td style={{ ...TD_BASE, fontFamily: 'var(--font-mono)', fontSize: 12.5, textAlign: 'right', color: 'var(--fg-1)' }}>
        {o.uptimePct != null ? `${o.uptimePct.toFixed(1)}%` : '—'}
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
          last wake {o.lastWakeAt || '—'}
        </div>
      </td>

      {/* Last transition */}
      <td style={{ ...TD_BASE, minWidth: 220 }}>
        {status.latestTransition ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--fg-3)' }}>
              <Chip variant="muted">{formatStateLabel(status.latestTransition.fromState)}</Chip>
              <span className="material-symbols-rounded" style={{ fontSize: 14, color: 'var(--fg-muted)' }}>arrow_forward</span>
              <Chip variant={STATE_VARIANT[status.latestTransition.toState] || 'muted'}>{formatStateLabel(status.latestTransition.toState)}</Chip>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
              {status.latestTransition.createdAt}
            </div>
          </div>
        ) : (
          <span style={{ color: 'var(--fg-muted)', fontSize: 12.5, fontStyle: 'italic' }}>None recorded</span>
        )}
      </td>

      {/* Actions */}
      <td style={{ ...TD_BASE, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {!isDeprovisioned && !mutationDisabled ? (
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {canRoll ? (
              <IconButton name="refresh" label={`Roll ${t.slug} to new version`} onClick={() => onUpgrade(status)} />
            ) : null}
            <IconButton name="delete_forever" label={`Deprovision ${t.slug}`} onClick={() => onDeprovision(status)} />
          </div>
        ) : (
          <span style={{ color: 'var(--fg-muted)', fontSize: 11.5 }}>—</span>
        )}
      </td>
    </tr>
  );
}

Object.assign(window, {
  ControlPlaneStatus, ProvisionPanel, TenantTable, AnomalyBanner, FleetRolloutPanel, formatStateLabel,
});
