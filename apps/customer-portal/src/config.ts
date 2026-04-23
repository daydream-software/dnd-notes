import { normalizeBasePath } from './base-path'

export const portalApiBasePath = normalizeBasePath(
  import.meta.env.VITE_PORTAL_API_BASE_PATH,
  '/portal-api',
)
