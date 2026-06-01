/* eslint-disable */
const { useState: useStatePortal } = React;

function PortalAppBar({ signedIn, onSignOut, provisioningEnabled }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px 28px',
      borderBottom: '1px solid var(--brand-line-faint)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 22, color: 'var(--accent)' }}>sticky_note_2</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1)' }}>dnd-notes customer portal</span>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Chip variant={provisioningEnabled ? 'success' : 'warn'}>
          {provisioningEnabled ? 'Self-serve provisioning enabled' : 'Provisioning placeholder mode'}
        </Chip>
        {signedIn ? (
          <Button variant="text" onClick={onSignOut}>Sign out</Button>
        ) : null}
      </div>
    </div>
  );
}

function Hero({ instanceHeadline, defaultVersion, signedInEmail }) {
  return (
    <div className="dndn-glass" style={{
      borderRadius: 24,
      background: 'var(--bg-paper-soft)',
      border: '1px solid var(--brand-line-soft)',
      padding: '40px 36px',
      boxShadow: 'var(--shadow-xl)',
    }}>
      <div style={{ color: 'var(--accent)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>
        Public landing + self-serve signup
      </div>
      <h1 style={{ margin: 0, fontSize: 44, lineHeight: 1.1, fontWeight: 800, color: 'var(--fg-1)', maxWidth: 880, letterSpacing: '-0.02em' }}>
        Spin up a dedicated D&amp;D note space without waiting on manual ops.
      </h1>
      <p style={{ margin: '14px 0 22px', fontSize: 17, lineHeight: 1.5, color: 'var(--fg-3)', maxWidth: 720 }}>
        Discover the product, claim a tenant slug, capture billing intent, and manage your owned instances from a single customer-facing portal.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip variant="brand-solid">{instanceHeadline}</Chip>
        <Chip variant="brand">Default tenant version {defaultVersion}</Chip>
        {signedInEmail ? <Chip variant="muted">Signed in as {signedInEmail}</Chip> : null}
      </div>
    </div>
  );
}

function PlanCard({ plan, accent }) {
  return (
    <div style={{
      borderRadius: 18,
      background: 'var(--bg-paper-soft)',
      border: '1px solid var(--brand-line-soft)',
      padding: 22,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-1)' }}>{plan.name}</div>
        <Chip variant="brand-solid">{plan.priceLabel}</Chip>
      </div>
      <p style={{ margin: 0, color: 'var(--fg-3)', fontSize: 14, lineHeight: 1.55 }}>{plan.description}</p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {plan.features.map((f) => (
          <li key={f} style={{ display: 'flex', gap: 10, color: 'var(--fg-1)', fontSize: 13.5 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 18, color: 'var(--accent)' }}>check</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PortalCard({ children, padding = 28 }) {
  return (
    <div className="dndn-glass" style={{
      borderRadius: 24,
      background: 'var(--bg-paper-soft)',
      border: '1px solid var(--brand-line-soft)',
      padding,
      boxShadow: 'var(--shadow-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
      minWidth: 0,
    }}>
      {children}
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--fg-1)', letterSpacing: '-0.01em' }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 6, fontSize: 14, color: 'var(--fg-3)', lineHeight: 1.55 }}>{subtitle}</div> : null}
    </div>
  );
}

const PAYMENT_OPTIONS = [
  { value: 'stripe', label: 'Stripe placeholder' },
  { value: 'square', label: 'Square placeholder' },
  { value: 'manual-review', label: 'Manual review placeholder' },
];

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '10px 14px',
        borderRadius: 18,
        border: '1px solid var(--brand-line-soft)',
        background: 'var(--bg-paper-soft)',
        color: 'var(--fg-1)',
        font: 'inherit',
        fontSize: 14,
        outline: 'none',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: 'var(--bg-1)' }}>{o.label}</option>
      ))}
    </select>
  );
}

Object.assign(window, { PortalAppBar, Hero, PlanCard, PortalCard, SectionHeader, Select, PAYMENT_OPTIONS });
