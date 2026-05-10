/* eslint-disable */
const { useState: useState_chrome } = React;

function BrandPill() {
  return (
    <div
      aria-label="Application brand"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 999,
        border: '1px solid rgba(167,139,250,0.2)',
        background: 'rgba(15,23,42,0.72)',
        color: 'rgba(255,255,255,0.78)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 12px 30px rgba(2,6,23,0.24)',
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
      style={{
        position: 'sticky',
        top: 12,
        zIndex: 2,
        alignSelf: 'flex-end',
        width: 560,
        maxWidth: '100%',
        borderRadius: 24,
        border: `1px solid ${hover ? 'rgba(167,139,250,0.22)' : 'rgba(167,139,250,0.14)'}`,
        background: hover ? 'rgba(15,23,42,0.88)' : 'rgba(15,23,42,0.44)',
        backdropFilter: 'blur(12px)',
        boxShadow: hover ? '0 18px 44px rgba(2,6,23,0.28)' : '0 16px 40px rgba(2,6,23,0.18)',
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
          <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12, marginTop: 2 }}>
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
              <option key={c.id} value={c.id} style={{ background: '#0f172a' }}>{c.name}</option>
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
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(15,23,42,0.6)',
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
            background: 'rgba(15,23,42,0.88)',
            border: '1px solid rgba(167,139,250,0.18)',
            boxShadow: '0 20px 40px rgba(15,23,42,0.24)',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(167,139,250,0.16)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              color: '#c4b1ff',
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

Object.assign(window, { BrandPill, WorkspaceHeader, StatPills });
