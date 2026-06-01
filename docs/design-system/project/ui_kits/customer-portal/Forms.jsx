/* eslint-disable */
const { useState: useStateForm } = React;

function normalizeSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
    .slice(0, 63);
}

function SignupForm({ plans, onSubmit, isSubmitting }) {
  const [draft, setDraft] = useStateForm({
    email: '', displayName: '', password: '', billingEmail: '',
    paymentProvider: 'stripe', tenantName: '', tenantSlug: '',
    planTier: plans[0]?.id || '',
  });
  const [editedSlug, setEditedSlug] = useStateForm(false);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(draft); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Work email"><Input value={draft.email} onChange={(v) => set('email', v)} /></Field>
      <Field label="Display name"><Input value={draft.displayName} onChange={(v) => set('displayName', v)} /></Field>
      <Field label="Password" help="At least 10 characters for the local portal auth slice."><Input value={draft.password} onChange={(v) => set('password', v)} /></Field>
      <Field label="Billing email (optional)"><Input value={draft.billingEmail} onChange={(v) => set('billingEmail', v)} /></Field>
      <Field label="Tenant name"><Input value={draft.tenantName} onChange={(v) => {
        set('tenantName', v);
        if (!editedSlug) set('tenantSlug', normalizeSlug(v));
      }} /></Field>
      <Field label="Tenant slug" help="Lowercase letters, numbers, and hyphens only. Example: crimson-court">
        <Input value={draft.tenantSlug} onChange={(v) => { setEditedSlug(true); set('tenantSlug', normalizeSlug(v)); }} />
      </Field>
      <Field label="Plan">
        <Select value={draft.planTier} onChange={(v) => set('planTier', v)} options={plans.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <Field label="Payment provider placeholder">
        <Select value={draft.paymentProvider} onChange={(v) => set('paymentProvider', v)} options={PAYMENT_OPTIONS} />
      </Field>
      <Button type="submit" disabled={isSubmitting} style={{ alignSelf: 'flex-start', padding: '12px 22px' }}>
        {isSubmitting ? 'Creating portal account…' : 'Create portal account'}
      </Button>
    </form>
  );
}

function LoginForm({ defaultEmail, onSubmit }) {
  const [email, setEmail] = useStateForm(defaultEmail || '');
  const [password, setPassword] = useStateForm('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ email, password }); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Portal email"><Input value={email} onChange={setEmail} /></Field>
      <Field label="Password"><Input value={password} onChange={setPassword} /></Field>
      <Button type="submit" variant="outlined" style={{ alignSelf: 'flex-start' }}>Restore dashboard</Button>
    </form>
  );
}

function CreateTenantForm({ plans, billingEmail, onSubmit, isSubmitting }) {
  const [draft, setDraft] = useStateForm({
    tenantName: '', tenantSlug: '', planTier: plans[0]?.id || '',
    paymentProvider: 'stripe', billingEmail: billingEmail || '',
  });
  const [editedSlug, setEditedSlug] = useStateForm(false);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(draft); setDraft((d) => ({ ...d, tenantName: '', tenantSlug: '' })); setEditedSlug(false); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Tenant name"><Input value={draft.tenantName} onChange={(v) => { set('tenantName', v); if (!editedSlug) set('tenantSlug', normalizeSlug(v)); }} /></Field>
      <Field label="Tenant slug"><Input value={draft.tenantSlug} onChange={(v) => { setEditedSlug(true); set('tenantSlug', normalizeSlug(v)); }} /></Field>
      <Field label="Plan"><Select value={draft.planTier} onChange={(v) => set('planTier', v)} options={plans.map((p) => ({ value: p.id, label: p.name }))} /></Field>
      <Field label="Payment provider placeholder"><Select value={draft.paymentProvider} onChange={(v) => set('paymentProvider', v)} options={PAYMENT_OPTIONS} /></Field>
      <Field label="Billing email (optional)"><Input value={draft.billingEmail} onChange={(v) => set('billingEmail', v)} /></Field>
      <Button type="submit" disabled={isSubmitting} style={{ alignSelf: 'flex-start' }}>
        {isSubmitting ? 'Submitting tenant request…' : 'Create tenant request'}
      </Button>
    </form>
  );
}

const STATE_VARIANT = {
  ready: 'success',
  provisioning: 'brand',
  maintenance: 'warn',
  upgrading: 'warn',
  restoring: 'warn',
  failed: 'muted',
  deprovisioned: 'muted',
};

function formatStateLabel(s) { return s.slice(0, 1).toUpperCase() + s.slice(1); }

function TenantCard({ summary }) {
  const t = summary.tenant;
  return (
    <div style={{
      borderRadius: 18,
      background: 'var(--bg-paper-soft)',
      border: '1px solid var(--brand-line-soft)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--fg-1)' }}>{t.displayName || t.slug}</div>
          <div style={{ color: 'var(--fg-3)', fontSize: 13, marginTop: 2 }}>{t.slug}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip variant={STATE_VARIANT[t.currentState] || 'muted'}>{formatStateLabel(t.currentState)}</Chip>
          <Chip variant="muted">{t.planTier || 'plan pending'}</Chip>
        </div>
      </div>
      <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>
        Version {t.version} · Last backup {summary.backup.lastBackupAt || 'Not available yet'}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button icon="open_in_new" disabled={!summary.appUrl}>{summary.appUrl ? 'Open tenant app' : 'App URL available after provisioning'}</Button>
        <Button variant="outlined" disabled>Settings placeholder ({summary.settingsPath})</Button>
      </div>
      <div style={{ height: 1, background: 'var(--brand-line-faint)' }} />
      <div style={{ color: 'var(--fg-1)', fontSize: 13 }}>
        Latest transition: {summary.latestTransition ? `${formatStateLabel(summary.latestTransition.fromState)} → ${formatStateLabel(summary.latestTransition.toState)}` : 'No transition recorded yet'}
      </div>
      <div style={{ color: 'var(--fg-muted)', fontSize: 12.5, lineHeight: 1.5 }}>
        Custom domain, archive/reactivate, subscription management, team invites, and usage analytics stay intentionally placeholder for this issue.
      </div>
    </div>
  );
}

function AccountCard({ account }) {
  return (
    <div style={{
      borderRadius: 18,
      background: 'var(--bg-paper-soft)',
      border: '1px solid var(--brand-line-soft)',
      padding: 18,
    }}>
      <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--fg-1)' }}>{account.displayName}</div>
      <div style={{ color: 'var(--fg-3)', fontSize: 13, marginTop: 4 }}>{account.email}</div>
      <div style={{ color: 'var(--fg-muted)', fontSize: 12.5, marginTop: 8 }}>
        Billing provider: {account.billingProvider || 'Captured as a placeholder'}
      </div>
    </div>
  );
}

function RoadmapList() {
  const items = [
    ['Billing/subscription management', 'placeholder'],
    ['Team member invites', 'coming-soon'],
    ['Usage analytics', 'coming-soon'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-1)' }}>Future roadmap placeholders</div>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--fg-3)' }}>
          <span>{k}</span><span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { SignupForm, LoginForm, CreateTenantForm, TenantCard, AccountCard, RoadmapList, formatStateLabel });
