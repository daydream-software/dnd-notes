/* eslint-disable */
const { useState: useStateTenant, useMemo: useMemoTenant } = React;

const STATE_VARIANT = {
  ready: 'success',
  provisioning: 'warn',
  upgrading: 'warn',
  restoring: 'warn',
  maintenance: 'warn',
  failed: 'muted',
  deprovisioned: 'muted',
};

const STATE_FG = {
  ready: '#4ade80',
  provisioning: '#f59e0b',
  upgrading: '#f59e0b',
  restoring: '#f59e0b',
  maintenance: '#f59e0b',
  failed: '#f87171',
  deprovisioned: 'var(--fg-muted)',
};

function formatStateLabel(s) { return s.slice(0, 1).toUpperCase() + s.slice(1); }

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
        background: 'rgba(167,139,250,0.16)',
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid rgba(167,139,250,0.18)',
      }}>
        {Object.entries(fleet.summary.tenantsByCurrentState).map(([state, n]) => (
          <div key={state} style={{ background: 'rgba(15,23,42,0.7)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
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
        <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.24)', color: '#fbbf24', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
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
      background: healthy ? '#4ade80' : '#f59e0b',
      boxShadow: `0 0 0 3px ${healthy ? 'rgba(74,222,128,0.18)' : 'rgba(245,158,11,0.18)'}`,
      display: 'inline-block',
    }} />
  );
}

function TransitionRow({ transition }) {
  if (!transition) return (
    <div style={{ color: 'var(--fg-muted)', fontSize: 12.5, fontStyle: 'italic' }}>No transition recorded yet.</div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg-3)', flexWrap: 'wrap' }}>
      <Chip variant="muted">{formatStateLabel(transition.fromState)}</Chip>
      <span className="material-symbols-rounded" style={{ fontSize: 14, color: 'var(--fg-muted)' }}>arrow_forward</span>
      <Chip variant={STATE_VARIANT[transition.toState] || 'muted'}>{formatStateLabel(transition.toState)}</Chip>
      <span style={{ color: 'var(--fg-muted)' }}>at {transition.createdAt}</span>
      <span style={{ color: 'var(--fg-muted)' }}>by</span>
      <span style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{transition.triggeredBy}</span>
    </div>
  );
}

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

function TenantRow({ status, onUpgrade, onDeprovision, mutationDisabled }) {
  const t = status.tenant;
  const isReady = t.currentState === 'ready';
  const isDeprovisioned = t.currentState === 'deprovisioned';

  return (
    <div style={{
      borderRadius: 18,
      background: 'rgba(15,23,42,0.6)',
      border: `1px solid ${status.health === 'healthy' ? 'rgba(167,139,250,0.16)' : 'rgba(245,158,11,0.28)'}`,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HealthDot healthy={status.health === 'healthy'} />
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-1)', letterSpacing: '-0.01em' }}>{t.slug}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>{t.id}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
            owner <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-1)' }}>{t.ownerId}</span>
            {t.initialAdminEmail ? (
              <> · admin <span style={{ color: 'var(--fg-1)' }}>{t.initialAdminEmail}</span></>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Chip variant={STATE_VARIANT[t.currentState] || 'muted'}>
            current {formatStateLabel(t.currentState)}
          </Chip>
          <Chip variant="muted">desired {formatStateLabel(t.desiredState)}</Chip>
          <Chip variant={status.health === 'healthy' ? 'success' : 'warn'}>
            {status.health === 'healthy' ? 'Healthy' : 'Needs attention'}
          </Chip>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 16,
        padding: '14px 16px',
        borderRadius: 14,
        background: 'rgba(2,6,23,0.4)',
        border: '1px solid rgba(167,139,250,0.10)',
      }}>
        <MetaRow icon="sell" label="Version" value={t.version} mono />
        <MetaRow icon="public" label="Subdomain" value={t.subdomain || 'pending'} mono />
        <MetaRow icon="storage" label="Storage" value={t.storageReference || 'pending'} mono />
        <MetaRow icon="backup" label="Backup" value={status.backup.lastBackupStatus || (status.backup.rawMetadata ? 'recorded' : 'missing')} />
        <MetaRow icon="schedule" label="Last backup" value={status.backup.lastBackupAt || '—'} />
        <MetaRow icon="science" label="Last drill" value={status.backup.lastRestoreDrillAt || '—'} />
      </div>

      <TransitionRow transition={status.latestTransition} />

      {status.latestTransition?.reason ? (
        <div style={{
          display: 'flex',
          gap: 10,
          padding: '10px 14px',
          borderRadius: 12,
          background: status.health === 'healthy' ? 'rgba(96,165,250,0.10)' : 'rgba(245,158,11,0.10)',
          border: `1px solid ${status.health === 'healthy' ? 'rgba(96,165,250,0.24)' : 'rgba(245,158,11,0.24)'}`,
          color: status.health === 'healthy' ? '#bfdbfe' : '#fbbf24',
          fontSize: 12.5,
          alignItems: 'flex-start',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
            {status.health === 'healthy' ? 'info' : 'error'}
          </span>
          <span>{status.latestTransition.reason}</span>
        </div>
      ) : null}

      {!isDeprovisioned ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderTop: '1px solid rgba(167,139,250,0.10)', paddingTop: 14 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)', maxWidth: 480, lineHeight: 1.5 }}>
            {isReady
              ? 'Rolling updates reuse the live provision route with a version override. Deprovision removes live tenant resources and keeps the record for audit/history.'
              : 'Deprovision removes live tenant resources and keeps the tenant record visible for audit/history.'}
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isReady ? (
              <Button variant="outlined" icon="refresh" disabled={mutationDisabled} onClick={() => onUpgrade(status)}>
                Roll to new version
              </Button>
            ) : null}
            <Button danger icon="delete_forever" disabled={mutationDisabled} onClick={() => onDeprovision(status)}>
              Deprovision tenant
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TenantList({ tenants, mutationDisabled, onUpgrade, onDeprovision }) {
  const [stateFilter, setStateFilter] = useStateTenant('all');
  const [query, setQuery] = useStateTenant('');

  const filtered = useMemoTenant(() => {
    return tenants.filter((s) => {
      if (stateFilter !== 'all' && s.tenant.currentState !== stateFilter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return s.tenant.slug.includes(q) || s.tenant.id.includes(q) || (s.tenant.ownerId || '').includes(q);
    });
  }, [tenants, stateFilter, query]);

  const states = ['all', 'ready', 'provisioning', 'upgrading', 'restoring', 'maintenance', 'failed', 'deprovisioned'];

  return (
    <OperatorCard>
      <SectionHeader
        eyebrow="Tenant fleet"
        title={`${tenants.length} tenant${tenants.length === 1 ? '' : 's'}`}
        subtitle="Current and desired lifecycle state come straight from the existing /internal/fleet/status contract, including the latest transition actor and reason."
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, borderRadius: 14, background: 'rgba(167,139,250,0.06)', color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>
            No tenants match this filter.
          </div>
        ) : null}
        {filtered.map((status) => (
          <TenantRow
            key={status.tenant.id}
            status={status}
            mutationDisabled={mutationDisabled}
            onUpgrade={onUpgrade}
            onDeprovision={onDeprovision}
          />
        ))}
      </div>
    </OperatorCard>
  );
}

Object.assign(window, { ControlPlaneStatus, ProvisionPanel, TenantList, formatStateLabel });
