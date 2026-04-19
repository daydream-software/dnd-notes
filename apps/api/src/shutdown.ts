import type { Server } from 'node:http'

export interface ShutdownControllerOptions {
  getServer: () => Pick<Server, 'close' | 'closeAllConnections' | 'closeIdleConnections'> | undefined
  closeResources: () => Promise<void>
  exit: (code: number) => void
  shutdownGracePeriodMs: number
  logError?: (message: string, error: unknown) => void
}

export function isServerNotRunningError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ERR_SERVER_NOT_RUNNING'
}

export function createShutdownController(options: ShutdownControllerOptions) {
  let shuttingDown = false
  let finalExitCode = 0
  let finishShutdownPromise: Promise<void> | undefined

  const logError = options.logError ?? console.error

  function finishShutdown(exitCode: number) {
    if (exitCode !== 0) {
      finalExitCode = exitCode
    }

    if (!finishShutdownPromise) {
      finishShutdownPromise = options
        .closeResources()
        .catch((error) => {
          finalExitCode = 1
          logError('Failed to close note store cleanly.', error)
        })
        .then(() => {
          options.exit(finalExitCode)
        })
    }

    return finishShutdownPromise
  }

  function safelyFinishShutdown(exitCode: number) {
    void finishShutdown(exitCode).catch((error) => {
      finalExitCode = 1
      logError('Unhandled shutdown failure.', error)
      options.exit(finalExitCode)
    })
  }

  function shutdown(exitCode: number) {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    finalExitCode = exitCode

    const server = options.getServer()
    if (!server) {
      safelyFinishShutdown(exitCode)
      return
    }

    const forceShutdownTimer = setTimeout(() => {
      server.closeAllConnections?.()
      safelyFinishShutdown(exitCode)
    }, options.shutdownGracePeriodMs)
    forceShutdownTimer.unref()

    server.close((error) => {
      clearTimeout(forceShutdownTimer)

      if (error) {
        if (isServerNotRunningError(error)) {
          safelyFinishShutdown(exitCode)
          return
        }

        logError('Failed to close HTTP server cleanly.', error)
        safelyFinishShutdown(1)
        return
      }

      safelyFinishShutdown(exitCode)
    })
    server.closeIdleConnections?.()
  }

  return {
    finishShutdown,
    isShuttingDown: () => shuttingDown,
    shutdown,
  }
}
