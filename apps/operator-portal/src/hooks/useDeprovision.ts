import * as React from 'react'
import type { FleetTenantStatus } from '../types'

const { useCallback, useState } = React

export interface UseDeprovisionResult {
  deprovisionTarget: FleetTenantStatus | null
  openDeprovision: (tenant: FleetTenantStatus) => void
  closeDeprovision: () => void
}

export function useDeprovision(): UseDeprovisionResult {
  const [deprovisionTarget, setDeprovisionTarget] = useState<FleetTenantStatus | null>(null)

  const openDeprovision = useCallback((tenant: FleetTenantStatus) => {
    setDeprovisionTarget(tenant)
  }, [])

  const closeDeprovision = useCallback(() => {
    setDeprovisionTarget(null)
  }, [])

  return { deprovisionTarget, openDeprovision, closeDeprovision }
}
