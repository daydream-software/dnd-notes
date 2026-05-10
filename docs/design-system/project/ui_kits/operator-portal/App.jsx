/* eslint-disable */
const { useState: useStateOp, useMemo: useMemoOp } = React;

const SEED_FLEET = {
  generatedAt: '2025-04-12 14:32 UTC',
  controlPlane: { status: 'healthy', uptime: '6d 14h 22m', version: '1.4.2' },
  dependencies: {
    tenantRegistry: { status: 'healthy' },
    tenantProvisioning: { status: 'healthy', details: 'Provisioning endpoint ready.' },
  },
  summary: {
    totalTenants: 6,
    tenantsByCurrentState: {
      ready: 4, provisioning: 1, upgrading: 0, restoring: 0,
      maintenance: 0, failed: 1, deprovisioned: 0,
    },
    tenantsByDesiredState: { ready: 5, provisioning: 0, upgrading: 0, restoring: 0, maintenance: 0, failed: 0, deprovisioned: 1 },
    tenantsByVersion: { '1.4.2': 4, '1.4.1': 2 },
    tenantsWithBackupMetadata: 5,
    tenantsMissingBackupMetadata: 1,
    tenantsNeedingAttention: 2,
  },
  tenants: [
    {
      tenant: { id: 't_2KqM91', slug: 'crimson-court', subdomain: 'crimson-court', ownerId: 'usr_2K9pVx', initialAdminEmail: 'mikha@crimson-court.example', desiredState: 'ready', currentState: 'ready', version: '1.4.2', storageReference: 'pvc-crimson-court', backupMetadata: 'recorded', createdAt: '2025-02-08', updatedAt: '2025-04-12' },
      health: 'healthy',
      backup: { rawMetadata: 'recorded', location: 's3://dnd-notes-backups/crimson-court', lastBackupAt: '2 hours ago', lastBackupStatus: 'completed', lastRestoreDrillAt: '6 days ago', lastRestoreDrillStatus: 'passed' },
      latestTransition: { id: 41, tenantId: 't_2KqM91', fromState: 'upgrading', toState: 'ready', triggeredBy: 'rollout-bot@operator-portal', reason: 'Rolled to 1.4.2 successfully', createdAt: '2025-04-10 09:14 UTC' },
    },
    {
      tenant: { id: 't_3PzN02', slug: 'wreckers-of-the-pale-coast', subdomain: 'wreckers', ownerId: 'usr_8MaQ4w', initialAdminEmail: 'cap@wreckers.example', desiredState: 'ready', currentState: 'provisioning', version: '1.4.2', storageReference: null, backupMetadata: null, createdAt: '2025-04-12', updatedAt: '2025-04-12' },
      health: 'attention',
      backup: { rawMetadata: null, location: null, lastBackupAt: null, lastBackupStatus: null, lastRestoreDrillAt: null, lastRestoreDrillStatus: null },
      latestTransition: { id: 58, tenantId: 't_3PzN02', fromState: 'provisioning', toState: 'provisioning', triggeredBy: 'mikha@daydream.software', reason: 'Initial provisioning request submitted', createdAt: '2025-04-12 14:18 UTC' },
    },
    {
      tenant: { id: 't_4RxK77', slug: 'iron-vault', subdomain: 'iron-vault', ownerId: 'usr_5GhTn1', initialAdminEmail: 'gm@iron-vault.example', desiredState: 'ready', currentState: 'ready', version: '1.4.1', storageReference: 'pvc-iron-vault', backupMetadata: 'recorded', createdAt: '2025-01-22', updatedAt: '2025-04-09' },
      health: 'healthy',
      backup: { rawMetadata: 'recorded', location: 's3://dnd-notes-backups/iron-vault', lastBackupAt: '47 minutes ago', lastBackupStatus: 'completed', lastRestoreDrillAt: '12 days ago', lastRestoreDrillStatus: 'passed' },
      latestTransition: { id: 33, tenantId: 't_4RxK77', fromState: 'maintenance', toState: 'ready', triggeredBy: 'rollout-bot@operator-portal', reason: null, createdAt: '2025-04-09 11:02 UTC' },
    },
    {
      tenant: { id: 't_5SLk89', slug: 'pale-watch', subdomain: 'pale-watch', ownerId: 'usr_5GhTn1', initialAdminEmail: 'dm@pale-watch.example', desiredState: 'ready', currentState: 'failed', version: '1.4.2', storageReference: 'pvc-pale-watch', backupMetadata: 'recorded', createdAt: '2025-03-04', updatedAt: '2025-04-12' },
      health: 'attention',
      backup: { rawMetadata: 'recorded', location: 's3://dnd-notes-backups/pale-watch', lastBackupAt: '11 hours ago', lastBackupStatus: 'completed', lastRestoreDrillAt: '3 weeks ago', lastRestoreDrillStatus: 'passed' },
      latestTransition: { id: 62, tenantId: 't_5SLk89', fromState: 'upgrading', toState: 'failed', triggeredBy: 'rollout-bot@operator-portal', reason: 'PVC migration failed: insufficient block storage in eu-west-1b. Investigate before retrying rollout.', createdAt: '2025-04-12 13:47 UTC' },
    },
    {
      tenant: { id: 't_6TmL45', slug: 'arcane-archives', subdomain: 'arcane', ownerId: 'usr_9JnRz3', initialAdminEmail: 'librarian@arcane.example', desiredState: 'ready', currentState: 'ready', version: '1.4.2', storageReference: 'pvc-arcane-archives', backupMetadata: 'recorded', createdAt: '2024-11-18', updatedAt: '2025-04-08' },
      health: 'healthy',
      backup: { rawMetadata: 'recorded', location: 's3://dnd-notes-backups/arcane-archives', lastBackupAt: '4 hours ago', lastBackupStatus: 'completed', lastRestoreDrillAt: '8 days ago', lastRestoreDrillStatus: 'passed' },
      latestTransition: { id: 22, tenantId: 't_6TmL45', fromState: 'upgrading', toState: 'ready', triggeredBy: 'rollout-bot@operator-portal', reason: null, createdAt: '2025-04-08 16:21 UTC' },
    },
    {
      tenant: { id: 't_7UmP12', slug: 'twilight-keep', subdomain: 'twilight-keep', ownerId: 'usr_3FcPq7', initialAdminEmail: 'host@twilight-keep.example', desiredState: 'ready', currentState: 'ready', version: '1.4.2', storageReference: 'pvc-twilight-keep', backupMetadata: 'recorded', createdAt: '2025-03-29', updatedAt: '2025-04-12' },
      health: 'healthy',
      backup: { rawMetadata: 'recorded', location: 's3://dnd-notes-backups/twilight-keep', lastBackupAt: '1 hour ago', lastBackupStatus: 'completed', lastRestoreDrillAt: '4 days ago', lastRestoreDrillStatus: 'passed' },
      latestTransition: { id: 49, tenantId: 't_7UmP12', fromState: 'provisioning', toState: 'ready', triggeredBy: 'mikha@daydream.software', reason: 'Initial provisioning completed', createdAt: '2025-03-29 10:08 UTC' },
    },
  ],
};

function getSuggestedVersion(fleet) {
  if (!fleet) return '';
  const entries = Object.entries(fleet.summary.tenantsByVersion);
  if (entries.length === 0) return fleet.controlPlane.version;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function OperatorPortalApp() {
  const [signedIn, setSignedIn] = useStateOp(true);
  const [actor] = useStateOp('mikha@daydream.software');
  const [fleet, setFleet] = useStateOp(SEED_FLEET);
  const [refreshing, setRefreshing] = useStateOp(false);
  const [notice, setNotice] = useStateOp(null);
  const [err, setErr] = useStateOp(null);
  const [deprovisionTarget, setDeprovisionTarget] = useStateOp(null);
  const [upgradeTarget, setUpgradeTarget] = useStateOp(null);
  const [submitting, setSubmitting] = useStateOp(false);

  const provisioningHealthy = fleet.dependencies.tenantProvisioning.status === 'healthy';
  const mutationDisabledReason = !provisioningHealthy ? (fleet.dependencies.tenantProvisioning.details || 'Provisioning lane unhealthy.') : null;
  const suggestedVersion = useMemoOp(() => getSuggestedVersion(fleet), [fleet]);

  const summaryCards = [
    { label: 'Fleet tenants', value: String(fleet.summary.totalTenants), helper: `${fleet.summary.tenantsByCurrentState.ready} ready · ${fleet.summary.tenantsByCurrentState.failed} failed`, icon: 'apartment', tone: 'brand' },
    { label: 'Needs attention', value: String(fleet.summary.tenantsNeedingAttention), helper: `${fleet.summary.tenantsMissingBackupMetadata} missing backup metadata`, icon: fleet.summary.tenantsNeedingAttention > 0 ? 'warning' : 'check_circle', tone: fleet.summary.tenantsNeedingAttention > 0 ? 'warn' : 'success' },
    { label: 'Backups tracked', value: `${fleet.summary.tenantsWithBackupMetadata}/${fleet.summary.totalTenants}`, helper: `${fleet.summary.tenantsMissingBackupMetadata} missing`, icon: 'backup', tone: 'success' },
    { label: 'Provisioning lane', value: provisioningHealthy ? 'Healthy' : 'Disabled', helper: fleet.dependencies.tenantProvisioning.details || 'Provisioning endpoint ready.', icon: 'security', tone: provisioningHealthy ? 'info' : 'warn' },
  ];

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => { setRefreshing(false); setNotice('Fleet status refreshed.'); }, 600);
  };
  const handleSignOut = () => { setSignedIn(false); setNotice(null); setErr(null); };
  const handleLogin = () => { setSignedIn(true); setNotice('Signed in via Keycloak.'); };

  const handleProvision = (draft) => {
    setSubmitting(true);
    setTimeout(() => {
      const id = `t_${Math.random().toString(36).slice(2, 8)}`;
      setFleet((f) => ({
        ...f,
        summary: {
          ...f.summary,
          totalTenants: f.summary.totalTenants + 1,
          tenantsByCurrentState: { ...f.summary.tenantsByCurrentState, provisioning: f.summary.tenantsByCurrentState.provisioning + 1 },
          tenantsMissingBackupMetadata: f.summary.tenantsMissingBackupMetadata + 1,
          tenantsNeedingAttention: f.summary.tenantsNeedingAttention + 1,
        },
        tenants: [
          {
            tenant: { id, slug: draft.slug || 'new-tenant', subdomain: draft.slug || null, ownerId: draft.ownerId || 'usr_pending', initialAdminEmail: draft.initialAdminEmail || null, desiredState: 'ready', currentState: 'provisioning', version: draft.version || '1.4.2', storageReference: null, backupMetadata: null, createdAt: 'just now', updatedAt: 'just now' },
            health: 'attention',
            backup: { rawMetadata: null, location: null, lastBackupAt: null, lastBackupStatus: null, lastRestoreDrillAt: null, lastRestoreDrillStatus: null },
            latestTransition: { id: Date.now(), tenantId: id, fromState: 'provisioning', toState: 'provisioning', triggeredBy: actor, reason: draft.reason || 'Initial provisioning request submitted', createdAt: 'just now' },
          },
          ...f.tenants,
        ],
      }));
      setSubmitting(false);
      setErr(null);
      setNotice(`Provisioning request submitted for ${draft.slug || 'new tenant'}.`);
    }, 500);
  };

  const handleDeprovision = ({ tenant, reason }) => {
    setSubmitting(true);
    setTimeout(() => {
      setFleet((f) => ({
        ...f,
        summary: {
          ...f.summary,
          tenantsByCurrentState: {
            ...f.summary.tenantsByCurrentState,
            [tenant.tenant.currentState]: Math.max(0, f.summary.tenantsByCurrentState[tenant.tenant.currentState] - 1),
            deprovisioned: f.summary.tenantsByCurrentState.deprovisioned + 1,
          },
        },
        tenants: f.tenants.map((s) => s.tenant.id === tenant.tenant.id
          ? { ...s, tenant: { ...s.tenant, currentState: 'deprovisioned', desiredState: 'deprovisioned' }, latestTransition: { id: Date.now(), tenantId: s.tenant.id, fromState: s.tenant.currentState, toState: 'deprovisioned', triggeredBy: actor, reason, createdAt: 'just now' } }
          : s),
      }));
      setSubmitting(false);
      setDeprovisionTarget(null);
      setErr(null);
      setNotice(`Deprovisioned ${tenant.tenant.slug}. Tenant record retained for audit.`);
    }, 500);
  };

  const handleUpgrade = ({ tenant, version, reason }) => {
    setSubmitting(true);
    setTimeout(() => {
      setFleet((f) => ({
        ...f,
        tenants: f.tenants.map((s) => s.tenant.id === tenant.tenant.id
          ? { ...s, tenant: { ...s.tenant, currentState: 'upgrading', version }, latestTransition: { id: Date.now(), tenantId: s.tenant.id, fromState: 'ready', toState: 'upgrading', triggeredBy: actor, reason: reason || `Rolling to ${version}`, createdAt: 'just now' } }
          : s),
      }));
      setSubmitting(false);
      setUpgradeTarget(null);
      setErr(null);
      setNotice(`Rolling ${tenant.tenant.slug} to ${version}.`);
    }, 500);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 20% -10%, rgba(167,139,250,0.18), transparent 50%), radial-gradient(circle at 90% 0%, rgba(96,165,250,0.10), transparent 50%), linear-gradient(180deg, #020617 0%, #111827 100%)',
    }}>
      <OperatorAppBar
        provisioningHealthy={provisioningHealthy}
        actor={actor}
        signedIn={signedIn}
        onRefresh={handleRefresh}
        onSignOut={handleSignOut}
        refreshing={refreshing}
      />

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {!signedIn ? (
          <SignInCard onLogin={handleLogin} />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: '#c4b1ff', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
                  Operator control plane
                </div>
                <h1 style={{ margin: 0, fontSize: 36, fontWeight: 800, color: 'var(--fg-1)', letterSpacing: '-0.02em', lineHeight: 1.05 }}>
                  Fleet command for dnd-notes tenants
                </h1>
                <p style={{ margin: '10px 0 0', color: 'var(--fg-3)', fontSize: 15, lineHeight: 1.55, maxWidth: 720 }}>
                  Inspect and trigger tenant lifecycle work through the existing control-plane routes — not a browser-only write path. Each mutation requires explicit confirmation before touching live resources.
                </p>
              </div>
            </div>

            <OperatorBanner />

            {notice ? (
              <div style={{ padding: '12px 16px', borderRadius: 14, background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.32)', color: '#a7f3c4', fontSize: 13.5, display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>check_circle</span>
                <span style={{ flex: 1 }}>{notice}</span>
                <button onClick={() => setNotice(null)} style={{ background: 'transparent', border: 0, color: '#a7f3c4', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
                </button>
              </div>
            ) : null}
            {err ? (
              <div style={{ padding: '12px 16px', borderRadius: 14, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.32)', color: '#fca5a5', fontSize: 13.5 }}>
                {err}
              </div>
            ) : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              {summaryCards.map((c) => <StatCard key={c.label} {...c} />)}
            </div>

            <ProvisionPanel
              suggestedVersion={suggestedVersion}
              disabledReason={mutationDisabledReason}
              onSubmit={handleProvision}
              isSubmitting={submitting}
            />

            <ControlPlaneStatus fleet={fleet} />

            <TenantList
              tenants={fleet.tenants}
              mutationDisabled={Boolean(mutationDisabledReason)}
              onUpgrade={setUpgradeTarget}
              onDeprovision={setDeprovisionTarget}
            />
          </>
        )}
      </div>

      <DeprovisionDialog
        open={Boolean(deprovisionTarget)}
        onClose={() => setDeprovisionTarget(null)}
        tenant={deprovisionTarget}
        onConfirm={handleDeprovision}
        isSubmitting={submitting}
      />
      <UpgradeDialog
        open={Boolean(upgradeTarget)}
        onClose={() => setUpgradeTarget(null)}
        tenant={upgradeTarget}
        suggestedVersion={suggestedVersion}
        onConfirm={handleUpgrade}
        isSubmitting={submitting}
      />
    </div>
  );
}

Object.assign(window, { OperatorPortalApp });
