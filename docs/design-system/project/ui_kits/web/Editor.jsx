/* eslint-disable */
const { useState: useStateEditor } = React;

const TOOLBAR_BTN = {
  fontFamily: 'inherit',
  background: 'transparent',
  color: 'var(--fg-1)',
  border: '1px solid var(--brand-line-strong)',
  borderRadius: 999,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

function Toolbar({ onInsert }) {
  const wrap = (md) => () => onInsert(md);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <button style={TOOLBAR_BTN} onClick={wrap('# ')}>H1</button>
      <button style={TOOLBAR_BTN} onClick={wrap('## ')}>H2</button>
      <button style={TOOLBAR_BTN} onClick={wrap('### ')}>H3</button>
      <button style={{ ...TOOLBAR_BTN, padding: '4px 8px' }} onClick={wrap('**bold**')} aria-label="Bold"><Icon name="format_bold" size={14} /></button>
      <button style={{ ...TOOLBAR_BTN, padding: '4px 8px' }} onClick={wrap('*italic*')} aria-label="Italic"><Icon name="format_italic" size={14} /></button>
      <button style={{ ...TOOLBAR_BTN, padding: '4px 8px' }} onClick={wrap('\n- ')} aria-label="Bulleted list"><Icon name="format_list_bulleted" size={14} /></button>
      <button style={{ ...TOOLBAR_BTN, padding: '4px 8px' }} onClick={wrap('\n1. ')} aria-label="Numbered list"><Icon name="format_list_numbered" size={14} /></button>
      <button style={{ ...TOOLBAR_BTN, padding: '4px 8px' }} onClick={wrap('[link](https://)')} aria-label="External link"><Icon name="link" size={14} /></button>
      <button style={TOOLBAR_BTN} onClick={wrap('![[note-id|Label]]')}>Note</button>
      <button style={TOOLBAR_BTN} onClick={wrap('\n---\n')}>Rule</button>
    </div>
  );
}

function NoteEditor({ note, onChange, onSave, onDelete, isSaving, isDeleting, canEdit, allTags }) {
  const [tagDraft, setTagDraft] = useStateEditor('');
  if (!note) {
    return (
      <div style={{
        borderRadius: 18,
        background: 'var(--bg-paper-soft)',
        border: '1px dashed var(--brand-line-soft)',
        padding: '60px 24px',
        textAlign: 'center',
        color: 'var(--fg-muted)',
        fontSize: 14,
      }}>
        Select a note from the browse pane, or capture a new one.
      </div>
    );
  }

  const insertAtEnd = (md) => {
    onChange({ ...note, body: (note.body || '') + (note.body && !note.body.endsWith('\n') ? '\n' : '') + md });
  };

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t || note.tags.includes(t)) { setTagDraft(''); return; }
    onChange({ ...note, tags: [...note.tags, t] });
    setTagDraft('');
  };

  const removeTag = (t) => onChange({ ...note, tags: note.tags.filter((x) => x !== t) });

  return (
    <div className="dndn-glass" style={{
      borderRadius: 18,
      background: 'var(--bg-paper)',
      border: '1px solid var(--brand-line-soft)',
      boxShadow: 'var(--shadow-md)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      minWidth: 0,
    }}>
      <Field label="Title">
        <Input value={note.title} onChange={(v) => onChange({ ...note, title: v })} placeholder="Title…" />
      </Field>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: 'var(--fg-3)', fontSize: 12, letterSpacing: '0.02em' }}>STATUS</span>
        {['draft', 'published', 'archived'].map((s) => (
          <Chip
            key={s}
            variant={note.status === s ? 'brand-solid' : 'muted'}
            onClick={() => onChange({ ...note, status: s })}
          >
            {s}
          </Chip>
        ))}
      </div>

      <Field label="Session">
        <Input value={note.sessionName || ''} onChange={(v) => onChange({ ...note, sessionName: v || null })} placeholder="Optional — e.g. Session 7" />
      </Field>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ color: 'var(--fg-1)', fontSize: 14, fontWeight: 600 }}>Body</span>
          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Markdown supported</span>
        </div>
        <div style={{ border: '1px solid var(--brand-line-soft)', borderRadius: 18, padding: 12, background: 'var(--bg-paper-soft)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Toolbar onInsert={insertAtEnd} />
          <textarea
            value={note.body}
            onChange={(e) => onChange({ ...note, body: e.target.value })}
            placeholder="Start writing the note body…"
            rows={10}
            style={{
              background: 'transparent',
              color: 'var(--fg-1)',
              border: 0,
              outline: 'none',
              resize: 'vertical',
              font: 'inherit',
              fontSize: 14,
              lineHeight: 1.55,
              minHeight: 200,
            }}
          />
        </div>
      </div>

      <Field label="Tags">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {note.tags.map((t) => (
            <Chip key={t} variant="brand" onRemove={() => removeTag(t)}>{t}</Chip>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            placeholder="Add tag…"
            style={{
              background: 'transparent',
              border: 0,
              outline: 'none',
              color: 'var(--fg-1)',
              font: 'inherit',
              fontSize: 13,
              padding: '4px 6px',
              minWidth: 100,
            }}
          />
        </div>
      </Field>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
        <span style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          {note.updatedAt
            ? `Last updated ${note.updatedAt}`
            : canEdit ? 'New notes are saved straight to the selected campaign.'
            : 'Viewer links can read shared notes but cannot save changes.'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit && note.updatedAt ? (
            <Button danger onClick={onDelete} disabled={isSaving || isDeleting}>{isDeleting ? 'Deleting…' : 'Delete note'}</Button>
          ) : null}
          {canEdit ? (
            <Button icon="save" onClick={onSave} disabled={isSaving || isDeleting}>{isSaving ? 'Saving…' : 'Save note'}</Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Toolbar, NoteEditor });
