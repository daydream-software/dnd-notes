import assert from 'node:assert/strict'
import test from 'node:test'
import { createShutdownController } from '../src/shutdown.js'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

const closeGracePeriodMs = 1_000
const timeoutGracePeriodMs = 50

test('finishShutdown closes resources once even if requested multiple times', async () => {
  const closeResources = createDeferred()
  let closeCallCount = 0
  const exitCodes: number[] = []
  const controller = createShutdownController({
    getServer: () => undefined,
    closeResources: async () => {
      closeCallCount += 1
      await closeResources.promise
    },
    exit: (code) => {
      exitCodes.push(code)
    },
    shutdownGracePeriodMs: closeGracePeriodMs,
  })

  const firstShutdown = controller.finishShutdown(0)
  const secondShutdown = controller.finishShutdown(0)

  assert.equal(closeCallCount, 1)

  closeResources.resolve()
  await Promise.all([firstShutdown, secondShutdown])

  assert.deepEqual(exitCodes, [0])
})

test('finishShutdown swallows resource-close rejections and exits once', async () => {
  const errors: Array<{ message: string; error: unknown }> = []
  const exitCodes: number[] = []
  const failure = new Error('double close')
  const controller = createShutdownController({
    getServer: () => undefined,
    closeResources: async () => {
      throw failure
    },
    exit: (code) => {
      exitCodes.push(code)
    },
    shutdownGracePeriodMs: closeGracePeriodMs,
    logError: (message, error) => {
      errors.push({ message, error })
    },
  })

  await Promise.all([controller.finishShutdown(0), controller.finishShutdown(0)])

  assert.deepEqual(exitCodes, [1])
  assert.deepEqual(errors, [
    {
      message: 'Failed to close control-plane resources cleanly.',
      error: failure,
    },
  ])
})

test('finishShutdown times out stalled resource shutdowns and exits once', async () => {
  const errors: Array<{ message: string; error: unknown }> = []
  const exitCodes: number[] = []
  const controller = createShutdownController({
    getServer: () => undefined,
    closeResources: async () => new Promise<void>(() => {}),
    exit: (code) => {
      exitCodes.push(code)
    },
    shutdownGracePeriodMs: timeoutGracePeriodMs,
    logError: (message, error) => {
      errors.push({ message, error })
    },
  })

  await controller.finishShutdown(0)

  assert.deepEqual(exitCodes, [1])
  assert.equal(errors.length, 1)
  assert.equal(
    errors[0]?.message,
    'Timed out while closing control-plane resources cleanly.',
  )
  assert.match(
    (errors[0]?.error as Error).message,
    /closeResources\(\) exceeded 50ms/,
  )
})
