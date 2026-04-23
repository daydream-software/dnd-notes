import { normalizeBasePath } from '@dnd-notes/portal-utils'

export const portalApiBasePath = normalizeBasePath(
  import.meta.env.VITE_PORTAL_API_BASE_PATH,
  '/portal-api',
)
