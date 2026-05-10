/* eslint-disable */
const { useState: useStatePortalApp } = React;

const PLANS = [
  { id: 'starter', name: 'Solo storyteller', priceLabel: '$0 / mo', description: 'For one DM running a campaign or two on the side.', features: ['One tenant instance', 'Up to 3 campaigns', 'Daily backup', 'Community support'] },
  { id: 'table', name: 'Full table', priceLabel: '$12 / mo', description: 'For an active table with guest-shared notes.', features: ['One tenant, unlimited campaigns', 'Share-link permissions', 'Hourly backup', 'Email support'] },
  { id: 'guild', name: 'Guild', priceLabel: '$48 / mo', description: 'For a multi-DM guild running parallel campaigns.', features: ['Multiple tenants', 'Custom domain', 'Restore drills monthly', 'Priority support'] },
];

const SEED_TENANTS = [
  { tenant: { id: 't1', slug: 'crimson-court', displayName: "Mikh'a's Table", planTier: 'table', currentState: 'ready', version: '1.4.2' }, latestTransition: { fromState: 'provisioning', toState: 'ready' }, backup: { lastBackupAt: '2 hours ago' }, appUrl: 'https://crimson-court.notes.example.com', settingsPath: '/portal/tenants/crimson-court' },
  { tenant: { id: 't2', slug: 'wreckers', displayName: 'Wreckers of the Pale Coast', planTier: 'starter', currentState: 'provisioning', version: '1.4.2' }, latestTransition: null, backup: { lastBackupAt: null }, appUrl: null, settingsPath: '/portal/tenants/wreckers' },
];

function PortalApp() {
  const [signedIn, setSignedIn] = useStatePortalApp(false);
  const [account, setAccount] = useStatePortalApp(null);
  const [tenants, setTenants] = useStatePortalApp([]);
  const [notice, setNotice] = useStatePortalApp(null);
  const [submitting, setSubmitting] = useStatePortalApp(false);

  const handleSignup = (draft) => {
    setSubmitting(true);
    setTimeout(() => {
      setAccount({ displayName: draft.displayName || 'Mikh\'a', email: draft.email || 'mikha@daydream.software', billingProvider: draft.paymentProvider });
      setTenants([{
        tenant: { id: `t-${Date.now()}`, slug: draft.tenantSlug, displayName: draft.tenantName, planTier: draft.planTier, currentState: 'provisioning', version: '1.4.2' },
        latestTransition: null, backup: { lastBackupAt: null }, appUrl: null, settingsPath: `/portal/tenants/${draft.tenantSlug}`,
      }]);
      setSignedIn(true);
      setNotice('Portal account ready. Your first instance request is now tracked below.');
      setSubmitting(false);
    }, 400);
  };

  const handleLogin = ({ email }) => {
    setAccount({ displayName: 'Mikh\'a', email: email || 'mikha@daydream.software', billingProvider: 'stripe' });
    setTenants(SEED_TENANTS);
    setSignedIn(true);
    setNotice('Welcome back. Your customer dashboard is restored.');
  };

  const handleAddTenant = (draft) => {
    setSubmitting(true);
    setTimeout(() => {
      setTenants((prev) => [...prev, {
        tenant: { id: `t-${Date.now()}`, slug: draft.tenantSlug, displayName: draft.tenantName, planTier: draft.planTier, currentState: 'provisioning', version: '1.4.2' },
        latestTransition: null, backup: { lastBackupAt: null }, appUrl: null, settingsPath: `/portal/tenants/${draft.tenantSlug}`,
      }]);
      setNotice('Tenant request submitted. The dashboard now reflects the latest instance list.');
      setSubmitting(false);
    }, 400);
  };

  const handleSignOut = () => { setSignedIn(false); setAccount(null); setTenants([]); setNotice('Signed out of the customer portal.'); };

  const headline = tenants.length === 0 ? 'No instances yet' : tenants.length === 1 ? '1 active customer instance' : `${tenants.length} customer instances`;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #020617 0%, #111827 100%)' }}>
      <PortalAppBar signedIn={signedIn} onSignOut={handleSignOut} provisioningEnabled={true} />
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 28px 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Hero instanceHeadline={headline} defaultVersion="1.4.2" signedInEmail={account?.email} />

        {notice ? (
          <div style={{ padding: '12px 16px', borderRadius: 14, background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.32)', color: '#a7f3c4', fontSize: 13.5 }}>
            {notice}
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
          {PLANS.map((p) => <PlanCard key={p.id} plan={p} />)}
        </div>

        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: signedIn ? '1.4fr 1fr' : '1fr 1fr' }}>
          <PortalCard>
            <SectionHeader
              title={signedIn ? 'Customer dashboard' : 'Create your first instance'}
              subtitle={signedIn ? 'Track lifecycle state, backups, and app access for the tenants tied to your portal account.' : 'The first signup flow claims your portal account and immediately requests a dedicated tenant.'}
            />
            {signedIn ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <AccountCard account={account} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {tenants.length === 0 ? (
                    <div style={{ padding: 14, borderRadius: 12, background: 'rgba(167,139,250,0.10)', color: '#c4b1ff', fontSize: 13.5 }}>
                      No tenant requests yet. Use the form on the right to create one.
                    </div>
                  ) : null}
                  {tenants.map((t) => <TenantCard key={t.tenant.id} summary={t} />)}
                </div>
              </div>
            ) : (
              <SignupForm plans={PLANS} onSubmit={handleSignup} isSubmitting={submitting} />
            )}
          </PortalCard>

          <PortalCard>
            <SectionHeader
              title={signedIn ? 'Add another tenant' : 'Already have a portal account?'}
              subtitle={signedIn ? 'Request another tenant under the same owner account. The control plane keeps the portal scoped to your owned instances only.' : 'Sign back in with the same email to restore your customer dashboard without creating a duplicate account.'}
            />
            {signedIn ? (
              <CreateTenantForm plans={PLANS} billingEmail={account?.email} onSubmit={handleAddTenant} isSubmitting={submitting} />
            ) : (
              <LoginForm onSubmit={handleLogin} />
            )}
            <div style={{ height: 1, background: 'rgba(167,139,250,0.12)' }} />
            <RoadmapList />
          </PortalCard>
        </div>

        <PortalCard padding={24}>
          <SectionHeader
            title="Portal ↔ control-plane contract"
            subtitle="This portal stays a frontend to the control-plane API rather than a fork of the operator dashboard. Customer traffic goes through /portal, while internal fleet controls stay under /internal."
          />
        </PortalCard>
      </div>
    </div>
  );
}

Object.assign(window, { PortalApp });
