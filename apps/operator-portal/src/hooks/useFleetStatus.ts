import * as React from 'react'
import { fetchFleetStatus } from '../control-plane-api'
import type { FleetStatusResponse } from '../types'

const { useCallback, useMemo, useState } = React

function getSuggestedProvisionVersion(fleetStatus: FleetStatusResponse | null) {
  if (!fleetStatus) {
    return ''
  }

  const versionEntries = Object.entries(fleetStatus.summary.tenantsByVersion)

  if (versionEntries.length === 0) {
    return fleetStatus.controlPlane.version
  }

  return versionEntries.sort((left, right) => right[1] - left[1])[0][0]
}

function getMutationDisabledReason(fleetStatus: FleetStatusResponse | null) {
  if (!fleetStatus) {
    return 'Refresh the live fleet first so the portal can confirm the provisioning lane is healthy.'
  }

  if (fleetStatus.dependencies.tenantProvisioning.status !== 'healthy') {
    return (
      fleetStatus.dependencies.tenantProvisioning.details ??
      'Tenant provisioning is disabled, so portal mutations stay locked.'
    )
  }

  return null
}

export interface UseFleetStatusResult {
  fleetStatus: FleetStatusResponse | null
  isLoadingFleet: boolean
  fleetError: string | null
  loadFleet: (sessionToken: string) => Promise<void>
  clearFleet: () => void
  suggestedProvisionVersion: string
  mutationDisabledReason: string | null
}

export function useFleetStatus(): UseFleetStatusResult {
  const [fleetStatus, setFleetStatus] = useState<FleetStatusResponse | null>(null)
  const [isLoadingFleet, setIsLoadingFleet] = useState(false)
  const [fleetError, setFleetError] = useState<string | null>(null)

  const loadFleet = useCallback(async (sessionToken: string) => {
    setIsLoadingFleet(true)

    try {
      const nextFleetStatus = await fetchFleetStatus(sessionToken)
      setFleetStatus(nextFleetStatus)
      setFleetError(null)
    } catch (loadError) {
      setFleetError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load operator fleet status.',
      )
    } finally {
      setIsLoadingFleet(false)
    }
  }, [])

  const clearFleet = useCallback(() => {
    setFleetStatus(null)
    setIsLoadingFleet(false)
    setFleetError(null)
  }, [])

  const suggestedProvisionVersion = useMemo(
    () => getSuggestedProvisionVersion(fleetStatus),
    [fleetStatus],
  )

  const mutationDisabledReason = useMemo(
    () => getMutationDisabledReason(fleetStatus),
    [fleetStatus],
  )

  return {
    fleetStatus,
    isLoadingFleet,
    fleetError,
    loadFleet,
    clearFleet,
    suggestedProvisionVersion,
    mutationDisabledReason,
  }
}
