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

  async function closeResourcesWithinTimeout() {
    const timeoutError = new Error(
      `closeResources() exceeded ${options.shutdownGracePeriodMs}ms during shutdown.`,
    )
    let timeout: NodeJS.Timeout | undefined

    const closeResourcesResult = options.closeResources().then(
      () => ({ status: 'closed' as const }),
      (error) => ({ status: 'failed' as const, error }),
    )
    const timeoutResult = new Promise<{ status: 'timed-out'; error: Error }>((resolve) => {
      timeout = setTimeout(() => {
        resolve({ status: 'timed-out', error: timeoutError })
      }, options.shutdownGracePeriodMs)
    })
    const result = await Promise.race([closeResourcesResult, timeoutResult])

    if (timeout) {
      clearTimeout(timeout)
    }

    if (result.status === 'failed') {
      finalExitCode = 1
      logError('Failed to close control-plane resources cleanly.', result.error)
      return
    }

    if (result.status === 'timed-out') {
      finalExitCode = 1
      logError('Timed out while closing control-plane resources cleanly.', result.error)
    }
  }

  function finishShutdown(exitCode: number) {
    if (exitCode !== 0) {
      finalExitCode = exitCode
    }

    finishShutdownPromise ??= closeResourcesWithinTimeout().then(() => {
      options.exit(finalExitCode)
    })

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
    forceShutdownTimer.unref?.()

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
