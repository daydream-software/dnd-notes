export function normalizeBasePath(
  value: string | undefined,
  fallback: string,
) {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return fallback
  }

  if (trimmedValue === '/') {
    return trimmedValue
  }

  return trimmedValue.replace(/\/+$/, '')
}
