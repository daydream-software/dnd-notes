/* eslint-disable */

function OperatorAppBar({ provisioningHealthy, actor, onRefresh, onSignOut, refreshing, signedIn }) {
  return (
    <div className="dndn-glass" style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px 28px',
      borderBottom: '1px solid var(--brand-line-faint)',
      background: 'var(--bg-paper-soft)',
      position: 'sticky',
      top: 0,
      zIndex: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 22, color: 'var(--accent)' }}>admin_panel_settings</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-1)' }}>dnd-notes operator portal</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            control-plane · realm <strong style={{ color: 'var(--fg-3)' }}>workforce</strong> · client <strong style={{ color: 'var(--fg-3)' }}>operator-portal</strong>
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Chip variant={provisioningHealthy ? 'success' : 'warn'}>
          <span className="material-symbols-rounded" style={{ fontSize: 14, marginRight: 2 }}>
            {provisioningHealthy ? 'check_circle' : 'warning'}
          </span>
          Provisioning {provisioningHealthy ? 'healthy' : 'disabled'}
        </Chip>
        {signedIn ? (
          <>
            <Chip variant="muted">
              <span className="material-symbols-rounded" style={{ fontSize: 14, marginRight: 2 }}>person</span>
              {actor}
            </Chip>
            <Button variant="outlined" icon="refresh" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh fleet'}
            </Button>
            <Button variant="text" icon="logout" onClick={onSignOut}>Sign out</Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function OperatorBanner() {
  return (
    <div style={{
      borderRadius: 18,
      background: 'linear-gradient(135deg, var(--brand-line-faint), rgba(167,139,250,0.02))',
      border: '1px solid var(--brand-line-strong)',
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
    }}>
      <span className="material-symbols-rounded" style={{ fontSize: 22, color: 'var(--accent)', marginTop: 2 }}>shield</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 13.5, color: 'var(--fg-1)', fontWeight: 600 }}>Live infrastructure mode</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.55 }}>
          Writes go through the existing <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>/internal/tenants</span> control-plane contract. Provisioning creates real Kubernetes and database resources; deprovisioning deletes live resources and requires explicit confirmation.
        </div>
      </div>
    </div>
  );
}

function SignInCard({ onLogin }) {
  return (
    <div className="dndn-glass" style={{
      borderRadius: 24,
      background: 'var(--bg-paper-soft)',
      border: '1px solid var(--brand-line-soft)',
      padding: '56px 36px',
      boxShadow: 'var(--shadow-xl)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 18,
      textAlign: 'center',
    }}>
      <div style={{
        width: 64,
        height: 64,
        borderRadius: 20,
        background: 'var(--brand-tint)',
        border: '1px solid var(--brand-line)',
        display: 'grid',
        placeItems: 'center',
      }}>
        <span className="material-symbols-rounded" style={{ fontSize: 36, color: 'var(--accent)' }}>security</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 440 }}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--fg-1)', letterSpacing: '-0.02em' }}>Sign in with Keycloak</h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-3)', lineHeight: 1.55 }}>
          Authenticate against the workforce/admin Keycloak realm before inspecting fleet state. Operator actions require a verified workforce identity.
        </p>
      </div>
      <Button onClick={onLogin} icon="login" style={{ padding: '12px 24px', fontSize: 14 }}>
        Continue with Keycloak
      </Button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Chip variant="muted">realm: workforce</Chip>
        <Chip variant="muted">client: operator-portal</Chip>
      </div>
    </div>
  );
}

function OperatorCard({ children, padding = 24 }) {
  return (
    <div className="dndn-glass" style={{
      borderRadius: 22,
      background: 'var(--bg-paper-soft)',
      border: '1px solid var(--brand-line-soft)',
      padding,
      boxShadow: 'var(--shadow-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      minWidth: 0,
    }}>
      {children}
    </div>
  );
}

function SectionHeader({ title, subtitle, eyebrow, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow ? (
          <div style={{ color: 'var(--accent)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
            {eyebrow}
          </div>
        ) : null}
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-1)', letterSpacing: '-0.01em' }}>{title}</div>
        {subtitle ? <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--fg-3)', lineHeight: 1.55, maxWidth: 720 }}>{subtitle}</div> : null}
      </div>
      {action}
    </div>
  );
}

function StatCard({ label, value, helper, icon, tone = 'brand' }) {
  const tones = {
    brand:   { bg: 'var(--brand-line-faint)', fg: 'var(--accent)', ring: 'var(--brand-line)' },
    success: { bg: 'rgba(74,222,128,0.14)',  fg: 'var(--success)', ring: 'rgba(74,222,128,0.32)' },
    warn:    { bg: 'rgba(245,158,11,0.14)',  fg: 'var(--warn)', ring: 'rgba(245,158,11,0.32)' },
    info:    { bg: 'rgba(96,165,250,0.14)',  fg: 'var(--info)', ring: 'rgba(96,165,250,0.32)' },
  };
  const t = tones[tone] || tones.brand;
  return (
    <div style={{
      flex: '1 1 220px',
      minWidth: 0,
      borderRadius: 18,
      background: 'var(--bg-paper-soft)',
      border: '1px solid var(--brand-tint)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--fg-3)', fontSize: 12.5, fontWeight: 500, letterSpacing: '0.02em' }}>{label}</span>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: t.bg, border: `1px solid ${t.ring}`,
          display: 'grid', placeItems: 'center', color: t.fg,
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>{icon}</span>
        </div>
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--fg-1)', letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{helper}</div>
    </div>
  );
}

Object.assign(window, { OperatorAppBar, OperatorBanner, SignInCard, OperatorCard, SectionHeader, StatCard });
