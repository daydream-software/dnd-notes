import type { Express, Request, Response, NextFunction } from 'express'
import type { NoteStore } from '../note-store.js'
import {
  compareControlPlaneTokens,
  waitForInflightWriteDrain,
  type ControlState,
} from '../control-state.js'

export interface ControlRouteContext {
  getNoteStore: () => NoteStore
  controlState: ControlState
  controlPlaneToken: string | null
  appVersion: string
  schemaVersion: string
  tenantId: string | null
  drainGraceMs: number
}

export interface ControlInfoResponse {
  tenantId: string | null
  appVersion: string
  schema: {
    version: string
  }
  database: {
    state: 'connected' | 'disconnected'
    error?: string
  }
  maintenance: {
    mode: 'enabled' | 'disabled'
    since: string | null
    reason: string | null
  }
  lastWriteAt: string | null
  lastProbeAt: string | null
  serverTime: string
}

export interface ControlMaintenanceResponse {
  maintenance: {
    mode: 'enabled' | 'disabled'
    since: string | null
    reason: string | null
  }
  drained: boolean
  inflightWritesRemaining: number
  serverTime: string
}

export interface ControlErrorResponse {
  code: string
  error: string
  details?: string
}

export const controlMaintenanceErrorCode = 'tenant_in_maintenance'
export const controlNotConfiguredErrorCode = 'control_endpoints_not_configured'
export const controlUnauthorizedErrorCode = 'control_unauthorized'

export function createControlAuthMiddleware(controlPlaneToken: string | null) {
  return (
    request: Request,
    response: Response<ControlErrorResponse>,
    next: NextFunction,
  ) => {
    if (controlPlaneToken === null) {
      response.status(503).json({
        code: controlNotConfiguredErrorCode,
        error: 'Control-plane endpoints are not configured on this tenant.',
      })
      return
    }

    const authorizationHeader = request.header('authorization')

    if (!authorizationHeader?.startsWith('Bearer ')) {
      response.status(401).json({
        code: controlUnauthorizedErrorCode,
        error: 'Control-plane bearer token is required.',
      })
      return
    }

    const providedToken = authorizationHeader.slice('Bearer '.length).trim()

    if (!compareControlPlaneTokens(controlPlaneToken, providedToken)) {
      response.status(401).json({
        code: controlUnauthorizedErrorCode,
        error: 'Control-plane bearer token is invalid.',
      })
      return
    }

    next()
  }
}

export function registerControlRoutes(
  app: Express,
  context: ControlRouteContext,
) {
  const auth = createControlAuthMiddleware(context.controlPlaneToken)

  app.get(
    '/_control/info',
    auth,
    async (
      _request: Request,
      response: Response<ControlInfoResponse | ControlErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      let database: ControlInfoResponse['database']

      try {
        await noteStore.checkHealth()
        database = { state: 'connected' }
      } catch (error) {
        database = {
          state: 'disconnected',
          error: error instanceof Error ? error.message : String(error),
        }
      }

      response.json({
        tenantId: context.tenantId,
        appVersion: context.appVersion,
        schema: { version: context.schemaVersion },
        database,
        maintenance: { ...context.controlState.maintenance },
        lastWriteAt: context.controlState.lastWriteAt,
        lastProbeAt: context.controlState.lastProbeAt,
        serverTime: new Date().toISOString(),
      })
    },
  )

  app.post(
    '/_control/maintenance',
    auth,
    async (
      request: Request,
      response: Response<ControlMaintenanceResponse | ControlErrorResponse>,
    ) => {
      const body = (request.body ?? {}) as { mode?: unknown; reason?: unknown }
      const mode = body.mode

      if (mode !== 'enable' && mode !== 'disable') {
        response.status(400).json({
          code: 'invalid_request',
          error: 'Body must include mode of "enable" or "disable".',
        })
        return
      }

      const reasonRaw = body.reason
      let reason: string | null = null

      if (reasonRaw !== undefined && reasonRaw !== null) {
        if (typeof reasonRaw !== 'string') {
          response.status(400).json({
            code: 'invalid_request',
            error: 'Body field "reason" must be a string when provided.',
          })
          return
        }

        const trimmed = reasonRaw.trim()
        reason = trimmed.length > 0 ? trimmed : null
      }

      const now = new Date().toISOString()

      if (mode === 'enable') {
        // Block new writes immediately; existing in-flight writes get a brief
        // grace window to finish before we tell the control plane the tenant
        // is drained.
        context.controlState.maintenance = {
          mode: 'enabled',
          since: now,
          reason,
        }
        const drained = await waitForInflightWriteDrain(
          context.controlState,
          context.drainGraceMs,
        )

        response.json({
          maintenance: { ...context.controlState.maintenance },
          drained,
          inflightWritesRemaining: context.controlState.inflightWrites,
          serverTime: now,
        })
        return
      }

      context.controlState.maintenance = {
        mode: 'disabled',
        since: null,
        reason: null,
      }

      response.json({
        maintenance: { ...context.controlState.maintenance },
        drained: true,
        inflightWritesRemaining: context.controlState.inflightWrites,
        serverTime: now,
      })
    },
  )
}
