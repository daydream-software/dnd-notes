export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    const trimmedError = error.trim()

    if (trimmedError.length > 0) {
      return trimmedError
    }
  }

  if (
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint'
  ) {
    return String(error)
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const constructorName =
      typeof error.constructor?.name === 'string' && error.constructor.name.length > 0
        ? error.constructor.name
        : 'Object'
    const message =
      typeof record.message === 'string' && record.message.trim().length > 0
        ? record.message.trim()
        : null
    const code =
      typeof record.code === 'string' && record.code.trim().length > 0
        ? record.code.trim()
        : null
    const keys = Object.keys(record).slice(0, 5)

    if (message && code) {
      return `${constructorName}: ${message} (code: ${code})`
    }

    if (message) {
      return `${constructorName}: ${message}`
    }

    if (code) {
      return `${constructorName} (code: ${code})`
    }

    return keys.length > 0
      ? `${constructorName} with keys: ${keys.join(', ')}`
      : constructorName
  }

  return 'Unknown error'
}

export function normalizeUnknownError(
  error: unknown,
  fallbackMessage: string,
): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(`${fallbackMessage}: ${formatUnknownError(error)}`, {
    cause: error,
  })
}
