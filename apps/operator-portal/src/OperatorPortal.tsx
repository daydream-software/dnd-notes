import { Alert, Container, Stack } from '@mui/material'
import { Footer } from '@dnd-notes/theme'
import * as React from 'react'
import { useFleetStatus } from './hooks/useFleetStatus'
import { useOperatorAuth } from './hooks/useOperatorAuth'
import AuthGate from './components/AuthGate'
import PortalHeader from './components/PortalHeader'
import ProvisionTenantPanel from './components/ProvisionTenantPanel'
import FleetStatusPage from './pages/FleetStatusPage'
import { buildSummaryCards } from './pages/fleetSummaryCards'
import type { OperatorKeycloakConfig } from './types'
import type { RuntimeKeycloakClient } from './keycloak-client'

const { useCallback, useEffect, useMemo, useState } = React

export const surfaceRadius = '18px'

interface OperatorPortalProps {
  keycloakClientFactory?: (config: OperatorKeycloakConfig) => RuntimeKeycloakClient
}

export default function OperatorPortal({
  keycloakClientFactory,
}: OperatorPortalProps = {}) {
  const [notice, setNotice] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const {
    fleetStatus,
    isLoadingFleet,
    fleetError,
    loadFleet,
    clearFleet,
    suggestedProvisionVersion,
    mutationDisabledReason,
  } = useFleetStatus()

  const {
    authToken,
    isRoleAuthorized,
    isAuthReady,
    authError,
    operatorActor,
    handleLogin,
    handleLogout,
  } = useOperatorAuth(loadFleet, clearFleet, keycloakClientFactory)

  // Clear local display state when the session is cleared (mirrors original clearSession).
  useEffect(() => {
    if (!authToken) {
      setNotice(null)
      setMutationError(null)
    }
  }, [authToken])

  const onError = useCallback((message: string) => {
    setNotice(null)
    setMutationError(message || null)
  }, [])

  const onNotice = useCallback((message: string) => {
    setMutationError(null)
    setNotice(message || null)
  }, [])

  const displayError = mutationError ?? authError ?? fleetError

  const summaryCards = useMemo(
    () => (fleetStatus ? buildSummaryCards(fleetStatus) : []),
    [fleetStatus],
  )

  return (
    <>
      <Container maxWidth="xl" sx={{ py: 5 }}>
        <Stack spacing={3}>
          <PortalHeader
            authToken={authToken}
            isRoleAuthorized={isRoleAuthorized}
            isLoadingFleet={isLoadingFleet}
            operatorActor={operatorActor}
            surfaceRadius={surfaceRadius}
            onRefresh={() => void (authToken && loadFleet(authToken))}
            onLogout={() => void handleLogout()}
          />

          <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
            Portal writes stay on the existing <code>/internal/tenants</code> control-plane
            contract. Provisioning creates real Kubernetes and database resources, while
            deprovisioning deletes live resources and requires explicit confirmation.
          </Alert>

          {notice ? (
            <Alert
              severity="success"
              sx={{ borderRadius: surfaceRadius }}
              data-testid="operator-portal-notice"
            >
              {notice}
            </Alert>
          ) : null}

          {displayError ? (
            <Alert
              severity="error"
              sx={{ borderRadius: surfaceRadius }}
              data-testid="operator-portal-error"
            >
              {displayError}
            </Alert>
          ) : null}

          <AuthGate
            isAuthReady={isAuthReady}
            authToken={authToken}
            isRoleAuthorized={isRoleAuthorized}
            surfaceRadius={surfaceRadius}
            onLogin={() => void handleLogin()}
            onLogout={() => void handleLogout()}
          >
            {fleetStatus ? (
              <FleetStatusPage
                actor={operatorActor}
                authToken={authToken ?? ''}
                fleetStatus={fleetStatus}
                mutationDisabledReason={mutationDisabledReason}
                suggestedProvisionVersion={suggestedProvisionVersion}
                summaryCards={summaryCards}
                surfaceRadius={surfaceRadius}
                onError={onError}
                onNotice={onNotice}
                onRefresh={async () => { if (authToken) { await loadFleet(authToken) } }}
              />
            ) : (
              <ProvisionTenantPanel
                actor={operatorActor}
                authToken={authToken ?? ''}
                disabledReason={mutationDisabledReason}
                onError={onError}
                onProvisioned={onNotice}
                onRefresh={async () => { if (authToken) { await loadFleet(authToken) } }}
                suggestedVersion={suggestedProvisionVersion}
                surfaceRadius={surfaceRadius}
              />
            )}
          </AuthGate>
        </Stack>
      </Container>
      <Footer variant="signature" />
    </>
  )
}
