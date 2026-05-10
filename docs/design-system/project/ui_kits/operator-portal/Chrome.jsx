/* eslint-disable */

function OperatorAppBar({ provisioningHealthy, actor, onRefresh, onSignOut, refreshing, signedIn }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px 28px',
      borderBottom: '1px solid rgba(167,139,250,0.12)',
      background: 'rgba(15,23,42,0.6)',
      backdropFilter: 'blur(16px)',
      position: 'sticky',
      top: 0,
      zIndex: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 22, color: '#c4b1ff' }}>admin_panel_settings</span>
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
      background: 'linear-gradient(135deg, rgba(167,139,250,0.10), rgba(167,139,250,0.02))',
      border: '1px solid rgba(167,139,250,0.22)',
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
    }}>
      <span className="material-symbols-rounded" style={{ fontSize: 22, color: '#c4b1ff', marginTop: 2 }}>shield</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 13.5, color: 'var(--fg-1)', fontWeight: 600 }}>Live infrastructure mode</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.55 }}>
          Writes go through the existing <span style={{ fontFamily: 'var(--font-mono)', color: '#c4b1ff' }}>/internal/tenants</span> control-plane contract. Provisioning creates real Kubernetes and database resources; deprovisioning deletes live resources and requires explicit confirmation.
        </div>
      </div>
    </div>
  );
}

function SignInCard({ onLogin }) {
  return (
    <div style={{
      borderRadius: 24,
      background: 'rgba(15,23,42,0.78)',
      border: '1px solid rgba(167,139,250,0.18)',
      padding: '56px 36px',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 24px 56px rgba(2,6,23,0.32)',
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
        background: 'rgba(167,139,250,0.16)',
        border: '1px solid rgba(167,139,250,0.32)',
        display: 'grid',
        placeItems: 'center',
      }}>
        <span className="material-symbols-rounded" style={{ fontSize: 36, color: '#c4b1ff' }}>security</span>
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
    <div style={{
      borderRadius: 22,
      background: 'rgba(15,23,42,0.78)',
      border: '1px solid rgba(167,139,250,0.18)',
      padding,
      backdropFilter: 'blur(20px)',
      boxShadow: '0 16px 40px rgba(2,6,23,0.26)',
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
          <div style={{ color: '#c4b1ff', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
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
    brand:   { bg: 'rgba(167,139,250,0.14)', fg: '#c4b1ff', ring: 'rgba(167,139,250,0.32)' },
    success: { bg: 'rgba(74,222,128,0.14)',  fg: '#4ade80', ring: 'rgba(74,222,128,0.32)' },
    warn:    { bg: 'rgba(245,158,11,0.14)',  fg: '#f59e0b', ring: 'rgba(245,158,11,0.32)' },
    info:    { bg: 'rgba(96,165,250,0.14)',  fg: '#60a5fa', ring: 'rgba(96,165,250,0.32)' },
  };
  const t = tones[tone] || tones.brand;
  return (
    <div style={{
      flex: '1 1 220px',
      minWidth: 0,
      borderRadius: 18,
      background: 'rgba(15,23,42,0.6)',
      border: '1px solid rgba(167,139,250,0.16)',
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
