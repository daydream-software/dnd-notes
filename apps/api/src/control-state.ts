import { timingSafeEqual } from 'node:crypto'

export interface MaintenanceState {
  mode: 'enabled' | 'disabled'
  since: string | null
  reason: string | null
}

export interface ControlState {
  maintenance: MaintenanceState
  lastWriteAt: string | null
  lastProbeAt: string | null
  inflightWrites: number
}

export function createControlState(): ControlState {
  return {
    maintenance: { mode: 'disabled', since: null, reason: null },
    lastWriteAt: null,
    lastProbeAt: null,
    inflightWrites: 0,
  }
}

export function compareControlPlaneTokens(
  expected: string,
  provided: string,
): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const providedBuffer = Buffer.from(provided, 'utf8')

  if (expectedBuffer.length !== providedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, providedBuffer)
}

export async function waitForInflightWriteDrain(
  controlState: ControlState,
  timeoutMs: number,
  pollIntervalMs = 25,
): Promise<boolean> {
  if (timeoutMs <= 0) {
    return controlState.inflightWrites === 0
  }

  const deadline = Date.now() + timeoutMs

  while (controlState.inflightWrites > 0) {
    if (Date.now() >= deadline) {
      return false
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  return true
}
