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

  let end = withLeadingSlash.length - 1
  while (end > 0 && withLeadingSlash[end] === '/') {
    end--
  }

  // end === 0 means every character was '/', i.e. input was something like
  // '///' — treat the same as blank and return the fallback.
  if (end === 0) {
    return fallback
  }

  return withLeadingSlash.slice(0, end + 1)
}

export function joinBasePath(basePath: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return basePath === '/' ? normalizedPath : `${basePath}${normalizedPath}`
}
