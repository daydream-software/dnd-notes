import * as React from 'react'
import type { FleetTenantStatus } from '../types'

const { useCallback, useState } = React

export interface UseUpgradeResult {
  upgradeTarget: FleetTenantStatus | null
  openUpgrade: (tenant: FleetTenantStatus) => void
  closeUpgrade: () => void
}

export function useUpgrade(): UseUpgradeResult {
  const [upgradeTarget, setUpgradeTarget] = useState<FleetTenantStatus | null>(null)

  const openUpgrade = useCallback((tenant: FleetTenantStatus) => {
    setUpgradeTarget(tenant)
  }, [])

  const closeUpgrade = useCallback(() => {
    setUpgradeTarget(null)
  }, [])

  return { upgradeTarget, openUpgrade, closeUpgrade }
}
