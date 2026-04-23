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

  let normalized = withLeadingSlash
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized.length > 0 ? normalized : fallback
}

export function joinBasePath(basePath: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return basePath === '/' ? normalizedPath : `${basePath}${normalizedPath}`
}
