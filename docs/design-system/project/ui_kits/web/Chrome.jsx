/* eslint-disable */
const { useState: useState_chrome, useRef: useRef_chrome } = React;

function BrandPill() {
  return (
    <div
      aria-label="Application brand"
      className="dndn-glass"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 999,
        border: '1px solid var(--brand-line)',
        background: 'var(--bg-paper-soft)',
        color: 'var(--fg-2)',
        boxShadow: 'var(--shadow-sm)',
        fontSize: 12,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontWeight: 500,
        alignSelf: 'flex-start',
      }}
    >
      <Icon name="sticky_note_2" size={16} />
      D&amp;D Notes
    </div>
  );
}

function WorkspaceHeader({ campaignName, subtitle, campaigns, selectedId, onSelect, actions }) {
  const [hover, setHover] = useState_chrome(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="dndn-glass"
      style={{
        position: 'sticky',
        top: 12,
        zIndex: 2,
        alignSelf: 'flex-end',
        width: 560,
        maxWidth: '100%',
        borderRadius: 24,
        border: `1px solid ${hover ? 'var(--brand-line-strong)' : 'var(--brand-line-faint)'}`,
        background: hover ? 'var(--bg-paper-strong)' : 'var(--bg-paper-faint)',
        boxShadow: hover ? 'var(--shadow-lg)' : 'var(--shadow-md)',
        padding: '12px 14px',
        transition: 'background 200ms, border-color 200ms, box-shadow 200ms',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--fg-1)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={campaignName}
          >
            {campaignName}
          </div>
          <div style={{ color: 'var(--fg-3)', fontSize: 12, marginTop: 2 }}>
            {subtitle}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
          <select
            value={selectedId}
            onChange={(e) => onSelect(e.target.value)}
            style={{
              ...inputStyleHeader,
              fontSize: 13,
            }}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id} style={{ background: 'var(--bg-1)' }}>{c.name}</option>
            ))}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${actions.length}, 1fr)`, gap: 4 }}>
            {actions.map((a) => (
              <IconButton key={a.label} name={a.icon} label={a.label} onClick={a.onClick} active={a.active} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyleHeader = {
  padding: '8px 12px',
  borderRadius: 12,
  border: '1px solid var(--brand-line-soft)',
  background: 'var(--bg-paper-soft)',
  color: 'var(--fg-1)',
  font: 'inherit',
  outline: 'none',
};

function StatPills({ stats }) {
  return (
    <div
      role="list"
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        listStyle: 'none',
        padding: 0,
        margin: 0,
      }}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          role="listitem"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderRadius: 18,
            background: 'var(--bg-paper-strong)',
            border: '1px solid var(--brand-line-soft)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--brand-tint)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              color: 'var(--accent)',
            }}
          >
            <Icon name={s.icon} size={20} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--fg-muted)', fontSize: 13, lineHeight: 1.2 }}>{s.label}</div>
            <div style={{ color: 'var(--fg-1)', fontSize: 24, fontWeight: 600, lineHeight: 1.1, marginTop: 2 }}>
              {s.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickCaptureBar({ value, onChange, onSubmit, justCaptured }) {
  const inputRef = useRef_chrome(null);
  const [focused, setFocused] = useState_chrome(false);
  const canSubmit = value.trim().length > 0;
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit();
    inputRef.current?.focus();
  };
  return (
    <form
      onSubmit={handleSubmit}
      className="dndn-glass"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 18,
        background: 'var(--bg-paper-soft)',
        border: `1px solid ${focused ? 'var(--accent)' : 'var(--brand-line)'}`,
        boxShadow: focused ? `0 0 0 3px var(--brand-line), var(--shadow-sm)` : 'var(--shadow-sm)',
        transition: 'border-color 200ms, box-shadow 200ms',
      }}
    >
      <span
        className="material-symbols-rounded"
        aria-hidden="true"
        style={{ fontSize: 20, color: 'var(--accent)', flexShrink: 0 }}
      >
        bolt
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Jot a thought, reminder, or scene — Enter saves to the campaign."
        aria-label="Quick capture a note"
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 0,
          outline: 'none',
          color: 'var(--fg-1)',
          font: 'inherit',
          fontSize: 14.5,
          lineHeight: 1.5,
          padding: '4px 0',
        }}
      />
      {justCaptured ? (
        <span
          role="status"
          style={{
            color: 'var(--success)',
            fontSize: 12.5,
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap',
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 14 }}>check_circle</span>
          Captured
        </span>
      ) : null}
      <Button icon="add" disabled={!canSubmit} type="submit">Capture</Button>
    </form>
  );
}

Object.assign(window, { BrandPill, WorkspaceHeader, StatPills, QuickCaptureBar });
