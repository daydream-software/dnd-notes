import type { CampaignOverview } from './types'

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3001'

export async function fetchOverview(signal?: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/api/overview`, { signal })

  if (!response.ok) {
    throw new Error(`Failed to load campaign overview (${response.status})`)
  }

  const data: CampaignOverview = await response.json()

  return data
}
