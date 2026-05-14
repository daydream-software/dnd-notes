import { useCallback, useEffect, useState } from 'react'
import { fetchAdminAccounts, fetchAdminOverview } from '../api'
import SiteAdminPanel from '../SiteAdminPanel'
import type { AdminAccountSummary, AdminOverview } from '../types'

interface AdminPageProps {
  authToken: string
  surfaceRadius: number | string
}

export default function AdminPage({ authToken, surfaceRadius }: AdminPageProps) {
  const [isLoadingAdminOverview, setIsLoadingAdminOverview] = useState(false)
  const [adminAccounts, setAdminAccounts] = useState<AdminAccountSummary[]>([])
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadSiteAdminOverview = async () => {
      setIsLoadingAdminOverview(true)

      try {
        const [nextOverview, nextAccounts] = await Promise.all([
          fetchAdminOverview(authToken),
          fetchAdminAccounts(authToken),
        ])

        if (cancelled) {
          return
        }

        setAdminAccounts(nextAccounts)
        setAdminOverview(nextOverview)
        setAdminError(null)
      } catch (loadError) {
        if (cancelled) {
          return
        }

        setAdminAccounts([])
        setAdminOverview(null)
        setAdminError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load site-admin data.',
        )
      } finally {
        if (!cancelled) {
          setIsLoadingAdminOverview(false)
        }
      }
    }

    void loadSiteAdminOverview()

    return () => {
      cancelled = true
    }
  }, [authToken])

  const handleRefresh = useCallback(async () => {
    setIsLoadingAdminOverview(true)

    try {
      const [nextOverview, nextAccounts] = await Promise.all([
        fetchAdminOverview(authToken),
        fetchAdminAccounts(authToken),
      ])
      setAdminOverview(nextOverview)
      setAdminAccounts(nextAccounts)
      setAdminError(null)
    } catch (loadError) {
      setAdminError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load site-admin data.',
      )
    } finally {
      setIsLoadingAdminOverview(false)
    }
  }, [authToken])

  return (
    <SiteAdminPanel
      accounts={adminAccounts}
      overview={adminOverview}
      isLoading={isLoadingAdminOverview}
      error={adminError}
      onRefresh={() => void handleRefresh()}
      surfaceRadius={surfaceRadius}
    />
  )
}
