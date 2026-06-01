/* eslint-disable */
const { useState, useMemo } = React;

function Icon({ name, size = 20, style }) {
  return (
    <span
      className="material-symbols-rounded"
      style={{ fontSize: size, lineHeight: 1, ...style }}
    >
      {name}
    </span>
  );
}

function Button({ variant = 'contained', icon, danger, children, onClick, disabled, style, type = 'button' }) {
  const base = {
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 999,
    padding: '8px 18px',
    border: '1px solid transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'background-color 200ms, border-color 200ms, opacity 200ms',
    opacity: disabled ? 0.5 : 1,
  };
  const variants = {
    contained: { background: 'var(--brand-500)', color: 'var(--on-brand)' },
    outlined: { background: 'transparent', color: 'var(--accent)', borderColor: 'var(--brand-line-strong)' },
    text: { background: 'transparent', color: 'var(--accent)', padding: '8px 12px' },
  };
  const dangerStyle = danger ? {
    background: 'transparent',
    color: 'var(--error)',
    border: '1px solid rgba(248,113,113,0.5)',
  } : null;
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...(dangerStyle || variants[variant]), ...style }}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

function IconButton({ name, label, onClick, active, style }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      style={{
        width: 36,
        height: 36,
        borderRadius: 12,
        border: '1px solid transparent',
        background: active ? 'var(--brand-tint)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-1)',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        transition: 'background-color 200ms',
        ...style,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--action-hover)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon name={name} size={20} />
    </button>
  );
}

function Field({ label, children, help }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label ? <span style={{ color: 'var(--fg-3)', fontSize: 12, letterSpacing: '0.02em' }}>{label}</span> : null}
      {children}
      {help ? <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{help}</span> : null}
    </label>
  );
}

const inputStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 18,
  border: '1px solid var(--brand-line-soft)',
  background: 'var(--bg-paper-soft)',
  color: 'var(--fg-1)',
  font: 'inherit',
  fontSize: 14,
  transition: 'border-color 200ms, box-shadow 200ms',
};

function Input({ icon, value, onChange, placeholder, onClear, style }) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        ...inputStyle,
        borderColor: focused ? 'var(--accent)' : 'var(--brand-line-soft)',
        boxShadow: focused ? '0 0 0 2px var(--brand-line)' : 'none',
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={18} style={{ color: 'var(--fg-muted)' }} /> : null}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{ background: 'transparent', border: 0, outline: 'none', color: 'inherit', flex: 1, font: 'inherit' }}
      />
      {onClear && value ? (
        <button onClick={onClear} aria-label="Clear" style={{ background: 'transparent', border: 0, color: 'var(--fg-muted)', cursor: 'pointer', padding: 2, display: 'grid', placeItems: 'center' }}>
          <Icon name="clear" size={16} />
        </button>
      ) : null}
    </div>
  );
}

function Chip({ children, variant = 'neutral', onRemove, onClick, active }) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 500,
    height: 26,
    cursor: onClick ? 'pointer' : 'default',
    border: '1px solid transparent',
    transition: 'background-color 200ms, border-color 200ms',
  };
  const variants = {
    neutral: { background: 'var(--action-hover)', color: 'var(--fg-1)' },
    brand: { background: 'var(--brand-tint)', color: 'var(--accent)', borderColor: 'var(--brand-line)' },
    'brand-solid': { background: 'var(--brand-500)', color: 'var(--on-brand)' },
    success: { background: 'rgba(74,222,128,0.16)', color: 'var(--success)' },
    warn: { background: 'rgba(245,158,11,0.16)', color: 'var(--warn)' },
    muted: { background: 'var(--action-hover)', color: 'var(--fg-muted)' },
  };
  const v = active ? variants['brand-solid'] : variants[variant];
  return (
    <span onClick={onClick} style={{ ...base, ...v }}>
      {children}
      {onRemove ? (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(0,0,0,0.25)', display: 'inline-grid', placeItems: 'center', fontSize: 9 }}
        >×</span>
      ) : null}
    </span>
  );
}

Object.assign(window, { Icon, Button, IconButton, Field, Input, Chip });
