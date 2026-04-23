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
