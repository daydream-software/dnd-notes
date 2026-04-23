export function resolveApiBaseUrl(value: string | undefined, isDev: boolean) {
  const trimmedValue = value?.trim()

  if (trimmedValue && trimmedValue.length > 0) {
    return trimmedValue.replace(/\/+$/, '')
  }

  return isDev ? 'http://localhost:3001' : ''
}
