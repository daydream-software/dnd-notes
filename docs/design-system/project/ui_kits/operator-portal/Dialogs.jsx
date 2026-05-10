/* eslint-disable */
const { useState: useStateDlg, useEffect: useEffectDlg } = React;

function Modal({ open, onClose, children, width = 520 }) {
  useEffectDlg(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(2,6,23,0.72)',
        backdropFilter: 'blur(8px)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          background: 'rgba(15,23,42,0.96)',
          border: '1px solid rgba(167,139,250,0.24)',
          borderRadius: 22,
          padding: 28,
          boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function DeprovisionDialog({ open, onClose, tenant, onConfirm, isSubmitting }) {
  const [reason, setReason] = useStateDlg('');
  const [confirmSlug, setConfirmSlug] = useStateDlg('');
  useEffectDlg(() => { if (!open) { setReason(''); setConfirmSlug(''); } }, [open]);
  if (!tenant) return null;
  const t = tenant.tenant;
  const slugMatches = confirmSlug === t.slug;
  const canConfirm = slugMatches && reason.trim().length > 0 && !isSubmitting;

  return (
    <Modal open={open} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.32)',
          display: 'grid', placeItems: 'center', color: '#f87171',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: 24 }}>delete_forever</span>
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)' }}>Deprovision tenant</div>
          <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 2 }}>This deletes live Kubernetes and database resources.</div>
        </div>
      </div>

      <div style={{
        padding: '12px 14px',
        borderRadius: 12,
        background: 'rgba(248,113,113,0.08)',
        border: '1px solid rgba(248,113,113,0.24)',
        color: '#fca5a5',
        fontSize: 12.5,
        lineHeight: 1.55,
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}>
        <span className="material-symbols-rounded" style={{ fontSize: 16 }}>warning</span>
        <span>
          The tenant record stays visible for audit/history, but the namespace, deployment, PVC, configmap, secret, and database will be removed.
        </span>
      </div>

      <div style={{
        padding: 14, borderRadius: 12,
        background: 'rgba(2,6,23,0.5)', border: '1px solid rgba(167,139,250,0.14)',
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: 12.5,
      }}>
        <MetaRow icon="badge" label="Slug" value={t.slug} mono />
        <MetaRow icon="fingerprint" label="ID" value={t.id} mono />
        <MetaRow icon="public" label="Subdomain" value={t.subdomain || 'pending'} mono />
        <MetaRow icon="sell" label="Version" value={t.version} mono />
      </div>

      <Field label="Reason (recorded on the audit trail)">
        <Input icon="edit_note" value={reason} onChange={setReason} placeholder="e.g. customer cancelled subscription" />
      </Field>
      <Field label={`Type the tenant slug to confirm: ${t.slug}`} help="This guard prevents accidental deletion.">
        <Input icon="keyboard" value={confirmSlug} onChange={setConfirmSlug} placeholder={t.slug} />
      </Field>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button danger icon="delete_forever" disabled={!canConfirm} onClick={() => onConfirm({ tenant, reason })}>
          {isSubmitting ? 'Deprovisioning…' : `Deprovision ${t.slug}`}
        </Button>
      </div>
    </Modal>
  );
}

function UpgradeDialog({ open, onClose, tenant, suggestedVersion, onConfirm, isSubmitting }) {
  const [version, setVersion] = useStateDlg(suggestedVersion || '');
  const [reason, setReason] = useStateDlg('');
  useEffectDlg(() => {
    if (open) { setVersion(suggestedVersion || ''); setReason(''); }
  }, [open, suggestedVersion]);
  if (!tenant) return null;
  const t = tenant.tenant;
  const sameVersion = version.trim() === t.version;
  const canConfirm = version.trim().length > 0 && !sameVersion && !isSubmitting;

  return (
    <Modal open={open} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(167,139,250,0.16)', border: '1px solid rgba(167,139,250,0.32)',
          display: 'grid', placeItems: 'center', color: '#c4b1ff',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: 24 }}>refresh</span>
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)' }}>Roll to new version</div>
          <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 2 }}>Reuses the provision route with a version override.</div>
        </div>
      </div>

      <div style={{
        padding: 14, borderRadius: 12,
        background: 'rgba(2,6,23,0.5)', border: '1px solid rgba(167,139,250,0.14)',
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: 12.5,
      }}>
        <MetaRow icon="badge" label="Slug" value={t.slug} mono />
        <MetaRow icon="sell" label="Current version" value={t.version} mono />
        <MetaRow icon="public" label="Subdomain" value={t.subdomain || 'pending'} mono />
        <MetaRow icon="hourglass_top" label="Desired state" value={formatStateLabel(t.desiredState)} />
      </div>

      <Field label="Target version" help="Suggested from the majority fleet version. Override carefully.">
        <Input icon="sell" value={version} onChange={setVersion} placeholder="1.4.3" />
      </Field>
      <Field label="Reason (recorded on the audit trail)">
        <Input icon="edit_note" value={reason} onChange={setReason} placeholder="e.g. patch release rollout" />
      </Field>

      {sameVersion ? (
        <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.24)', color: '#fbbf24', fontSize: 12.5 }}>
          Target version matches the current version. Pick a different version to roll.
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Button variant="outlined" onClick={onClose}>Cancel</Button>
        <Button icon="rocket_launch" disabled={!canConfirm} onClick={() => onConfirm({ tenant, version, reason })}>
          {isSubmitting ? 'Rolling…' : `Roll ${t.slug} to ${version || '…'}`}
        </Button>
      </div>
    </Modal>
  );
}

Object.assign(window, { Modal, DeprovisionDialog, UpgradeDialog });
