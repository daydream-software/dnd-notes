/* eslint-disable */
const { useState: useStateBrowse } = React;

function NoteListItem({ note, selected, onClick }) {
  const [hover, setHover] = useStateBrowse(false);
  const statusVariant = note.status === 'published' ? 'success' : note.status === 'archived' ? 'warn' : 'muted';
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: 'left',
        padding: '14px 16px',
        borderRadius: 14,
        border: `1px solid ${selected ? 'var(--brand-line-strong)' : 'var(--brand-line-faint)'}`,
        background: selected ? 'var(--brand-tint)' : hover ? 'var(--bg-paper-soft)' : 'var(--bg-paper-faint)',
        color: 'var(--fg-1)',
        cursor: 'pointer',
        transition: 'background 200ms, border-color 200ms',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        font: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note.title}</span>
        <Chip variant={statusVariant}>{note.status}</Chip>
      </div>
      <div style={{ color: 'var(--fg-3)', fontSize: 13, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {note.body.split('\n')[0] || 'No content yet.'}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
        {note.tags.slice(0, 3).map((t) => <Chip key={t} variant="brand">{t}</Chip>)}
        {note.sessionName ? <Chip variant="muted">{note.sessionName}</Chip> : null}
      </div>
    </button>
  );
}

function NotesBrowsePane({ notes, selectedId, onSelect, search, onSearch, allTags, selectedTag, onTagSelect }) {
  return (
    <div className="dndn-glass" style={{
      borderRadius: 18,
      background: 'var(--bg-paper)',
      border: '1px solid var(--brand-line-soft)',
      boxShadow: 'var(--shadow-md)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg-1)' }}>Browse</div>
          <div style={{ color: 'var(--fg-muted)', fontSize: 13, marginTop: 4 }}>
            Search by title, body, tags, or session.
          </div>
        </div>
      </div>

      <Input
        icon="search"
        placeholder="Search title, body, tags, session, or collaborator…"
        value={search}
        onChange={onSearch}
        onClear={() => onSearch('')}
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip variant={selectedTag === null ? 'brand-solid' : 'muted'} onClick={() => onTagSelect(null)}>All</Chip>
        {allTags.map((t) => (
          <Chip key={t} variant={selectedTag === t ? 'brand-solid' : 'brand'} onClick={() => onTagSelect(t)}>{t}</Chip>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
        {notes.length === 0 ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 14, padding: '24px 8px', textAlign: 'center' }}>
            No notes match that search.
          </div>
        ) : notes.map((n) => (
          <NoteListItem key={n.id} note={n} selected={n.id === selectedId} onClick={() => onSelect(n.id)} />
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { NoteListItem, NotesBrowsePane });
