export function normalizeBasePath(
  value: string | undefined,
  fallback: string,
): string {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return fallback
  }

  if (trimmedValue === '/') {
    return trimmedValue
  }

  const withLeadingSlash = trimmedValue.startsWith('/')
    ? trimmedValue
    : `/${trimmedValue}`
  const normalized = withLeadingSlash.replace(/\/+$/, '')

  return normalized.length > 0 ? normalized : fallback
}

export function joinBasePath(basePath: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return basePath === '/' ? normalizedPath : `${basePath}${normalizedPath}`
}
