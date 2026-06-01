/* eslint-disable */
const { useState: useStateApp, useMemo: useMemoApp } = React;

const SEED_CAMPAIGNS = [
  { id: 'crimson', name: 'The Crimson Court' },
  { id: 'wreckers', name: 'Wreckers of the Pale Coast' },
  { id: 'embers', name: 'Embers Below Aldrun' },
];

const SEED_NOTES = {
  crimson: [
    { id: 'n1', title: 'Lady Veska', body: 'Vampire matriarch of the Crimson Court. Wants the Solstice relic returned before midwinter; will trade information for it.\n\nFirst impression: cold, immaculate, asks more than she answers.', tags: ['npc', 'antagonist'], status: 'published', sessionName: 'Session 4', updatedAt: '2 days ago' },
    { id: 'n2', title: 'The Crimson Court', body: 'A faction of vampire nobility orbiting Lady Veska. They want the relic recovered before the Solstice and have leverage over two town councilors.', tags: ['faction', 'politics'], status: 'published', sessionName: null, updatedAt: '5 minutes ago' },
    { id: 'n3', title: 'Hollow Manor', body: 'Abandoned in name only. Cellars reach further than any map shows.\n\nWho controls it: Veska\'s thralls.\nHooks: a sealed chapel, a ledger of debts.', tags: ['location'], status: 'draft', sessionName: null, updatedAt: 'yesterday' },
    { id: 'n4', title: 'Session 6 — The Solstice Pact', body: 'Summary: party met Veska under truce. Traded the journal for a name.\nWins: avoided combat.\nLoose threads: who is "the gardener"?', tags: ['session', 'recap'], status: 'published', sessionName: 'Session 6', updatedAt: '3 hours ago' },
    { id: 'n5', title: 'Father Cain', body: 'Town priest. Knows more than he says. Watches the manor at dusk.', tags: ['npc'], status: 'draft', sessionName: null, updatedAt: 'last week' },
    { id: 'n6', title: 'The Solstice Relic', body: 'A copper disc, warm to the touch. Inscribed with a calendar nobody uses anymore.', tags: ['item', 'mystery'], status: 'archived', sessionName: null, updatedAt: '2 weeks ago' },
  ],
  wreckers: [
    { id: 'w1', title: 'Captain Mors', body: 'Leader of the wreckers. Lost a leg to the same storm that took her ship.', tags: ['npc'], status: 'published', sessionName: null, updatedAt: 'yesterday' },
    { id: 'w2', title: 'The Pale Coast', body: 'Cliffs the locals refuse to name. Fog never lifts before noon.', tags: ['location'], status: 'draft', sessionName: null, updatedAt: '3 days ago' },
  ],
  embers: [
    { id: 'e1', title: 'NPC roster', body: 'Use this note as a running list of notable NPCs.\n\n- Name:\n- Role in campaign:\n- What they want:\n- Connection to the party:', tags: ['npc', 'roster'], status: 'draft', sessionName: null, updatedAt: 'just now' },
  ],
};

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useStateApp('mikha@daydream.software');
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="dndn-glass" style={{
        width: 'min(100%, 420px)',
        background: 'var(--bg-paper)',
        border: '1px solid var(--brand-line)',
        borderRadius: 24,
        boxShadow: 'var(--shadow-xl)',
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <BrandPill />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--fg-1)' }}>Welcome back</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--fg-muted)', fontSize: 14 }}>
            Sign in to pick up where your last session left off.
          </p>
        </div>
        <Field label="Email"><Input value={email} onChange={setEmail} /></Field>
        <Field label="Password"><Input value="••••••••••" onChange={() => {}} /></Field>
        <Button onClick={onLogin} style={{ alignSelf: 'flex-start', width: 'auto' }}>Continue</Button>
        <div style={{ color: 'var(--fg-muted)', fontSize: 12, textAlign: 'center' }}>
          Joining a shared campaign? Open the share link instead.
        </div>
      </div>
    </div>
  );
}

function App() {
  const [stage, setStage] = useStateApp('login'); // 'login' | 'workspace'
  const [campaignsState] = useStateApp(SEED_CAMPAIGNS);
  const [notesByCampaign, setNotesByCampaign] = useStateApp(SEED_NOTES);
  const [selectedCampaignId, setSelectedCampaignId] = useStateApp('crimson');
  const [selectedNoteId, setSelectedNoteId] = useStateApp('n2');
  const [search, setSearch] = useStateApp('');
  const [selectedTag, setSelectedTag] = useStateApp(null);
  const [quickValue, setQuickValue] = useStateApp('');
  const [splitMode, setSplitMode] = useStateApp(true);
  const [pane, setPane] = useStateApp('both'); // 'browse' | 'editor' | 'both'
  const [draftNote, setDraftNote] = useStateApp(null);
  const [savingFlash, setSavingFlash] = useStateApp(false);
  const [quickJustCaptured, setQuickJustCaptured] = useStateApp(false);

  const notes = notesByCampaign[selectedCampaignId] || [];
  const allTags = useMemoApp(() => Array.from(new Set(notes.flatMap((n) => n.tags))).sort(), [notes]);
  const selectedCampaign = campaignsState.find((c) => c.id === selectedCampaignId);

  const filteredNotes = useMemoApp(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (selectedTag && !n.tags.includes(selectedTag)) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.tags.some((t) => t.includes(q)) ||
        (n.sessionName || '').toLowerCase().includes(q)
      );
    });
  }, [notes, search, selectedTag]);

  const selectedNote = useMemoApp(
    () => draftNote || notes.find((n) => n.id === selectedNoteId) || null,
    [notes, selectedNoteId, draftNote],
  );

  const showBrowse = pane === 'browse' || pane === 'both';
  const showEditor = pane === 'editor' || pane === 'both';

  const updateNote = (next) => {
    if (next.id === selectedNoteId) {
      setNotesByCampaign((prev) => ({
        ...prev,
        [selectedCampaignId]: prev[selectedCampaignId].map((n) => n.id === next.id ? next : n),
      }));
    } else {
      setDraftNote(next);
    }
  };

  const saveNote = () => {
    setSavingFlash(true);
    setTimeout(() => setSavingFlash(false), 600);
    if (draftNote) {
      const newId = `n${Date.now()}`;
      const saved = { ...draftNote, id: newId, updatedAt: 'just now' };
      setNotesByCampaign((prev) => ({
        ...prev,
        [selectedCampaignId]: [saved, ...prev[selectedCampaignId]],
      }));
      setDraftNote(null);
      setSelectedNoteId(newId);
    } else if (selectedNote) {
      updateNote({ ...selectedNote, updatedAt: 'just now' });
    }
  };

  const deleteNote = () => {
    if (!selectedNote) return;
    setNotesByCampaign((prev) => ({
      ...prev,
      [selectedCampaignId]: prev[selectedCampaignId].filter((n) => n.id !== selectedNote.id),
    }));
    setSelectedNoteId(null);
  };

  const captureQuick = () => {
    const v = quickValue.trim();
    if (!v) return;
    const newNote = { id: `q${Date.now()}`, title: v.slice(0, 60), body: v, tags: ['quick'], status: 'draft', sessionName: null, updatedAt: 'just now' };
    setNotesByCampaign((prev) => ({
      ...prev,
      [selectedCampaignId]: [newNote, ...prev[selectedCampaignId]],
    }));
    setQuickValue('');
    setDraftNote(null);
    setQuickJustCaptured(true);
    setTimeout(() => setQuickJustCaptured(false), 1500);
  };

  const newNote = () => {
    setDraftNote({ id: '__draft', title: 'Untitled note', body: '', tags: [], status: 'draft', sessionName: null, updatedAt: null });
    setSelectedNoteId('__draft');
  };

  if (stage === 'login') return <LoginScreen onLogin={() => setStage('workspace')} />;

  const stats = [
    { label: 'Notes', value: notes.length, icon: 'description' },
    { label: 'Tags', value: allTags.length, icon: 'sell' },
    { label: 'Sessions', value: new Set(notes.map((n) => n.sessionName).filter(Boolean)).size, icon: 'event_note' },
    { label: 'Drafts', value: notes.filter((n) => n.status === 'draft').length, icon: 'edit_note' },
  ];

  return (
    <main style={{ minHeight: '100vh', padding: '32px 0', width: '100%' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <BrandPill />

        <WorkspaceHeader
          campaignName={selectedCampaign.name}
          subtitle={`${notes.length} notes · ${allTags.length} tags`}
          campaigns={campaignsState}
          selectedId={selectedCampaignId}
          onSelect={(id) => { setSelectedCampaignId(id); setSelectedNoteId(null); setDraftNote(null); }}
          actions={[
            { icon: 'add', label: 'New note', onClick: newNote },
            { icon: 'view_column_2', label: 'Toggle split', onClick: () => setSplitMode((s) => !s), active: splitMode },
            { icon: 'share', label: 'Share', onClick: () => {} },
            { icon: 'settings', label: 'Settings', onClick: () => {} },
          ]}
        />

        <QuickCaptureBar
          value={quickValue}
          onChange={setQuickValue}
          onSubmit={captureQuick}
          justCaptured={quickJustCaptured}
        />

        <StatPills stats={stats} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--fg-3)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Workspace</span>
          <Chip variant={pane === 'both' ? 'brand-solid' : 'muted'} onClick={() => { setPane('both'); setSplitMode(true); }}>Split</Chip>
          <Chip variant={pane === 'browse' ? 'brand-solid' : 'muted'} onClick={() => setPane('browse')}>Browse only</Chip>
          <Chip variant={pane === 'editor' ? 'brand-solid' : 'muted'} onClick={() => setPane('editor')}>Editor only</Chip>
          {savingFlash ? <span style={{ color: 'var(--success)', fontSize: 12, marginLeft: 'auto' }}>Saved.</span> : null}
        </div>

        <div style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: showBrowse && showEditor ? 'minmax(0, 1.1fr) minmax(0, 1fr)' : '1fr',
          minWidth: 0,
        }}>
          {showBrowse ? (
            <NotesBrowsePane
              notes={filteredNotes}
              selectedId={selectedNoteId}
              onSelect={(id) => { setSelectedNoteId(id); setDraftNote(null); }}
              search={search}
              onSearch={setSearch}
              allTags={allTags}
              selectedTag={selectedTag}
              onTagSelect={setSelectedTag}
            />
          ) : null}
          {showEditor ? (
            <NoteEditor
              note={selectedNote}
              onChange={updateNote}
              onSave={saveNote}
              onDelete={deleteNote}
              isSaving={false}
              isDeleting={false}
              canEdit={true}
              allTags={allTags}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { App, LoginScreen });
