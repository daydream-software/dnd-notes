import type { Express, Request, Response } from 'express'
import type {
  AuthConfigResponse,
  CurrentOwnerResponse,
  ErrorResponse,
} from '../types.js'
import { createReadLimiter } from '../rate-limiters.js'
import {
  type AppRouteContext,
  requireAuthenticatedAccount,
} from '../route-support.js'

export function registerAuthRoutes(app: Express, context: AppRouteContext) {
  const authSessionReadLimiter = createReadLimiter()

  app.get(
    '/api/auth/config',
    (_request: Request, response: Response<AuthConfigResponse>) => {
      response.json(context.runtimeAuth.authConfig)
    },
  )

  app.get(
    '/api/auth/session',
    authSessionReadLimiter,
    async (
      request: Request,
      response: Response<CurrentOwnerResponse | ErrorResponse>,
    ) => {
      const owner = await requireAuthenticatedAccount(
        context.getNoteStore(),
        request,
        response,
        context.runtimeAuth,
      )

      if (!owner) {
        return
      }

      response.json({ owner })
    },
  )
}
