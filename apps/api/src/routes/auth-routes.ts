import type { Express, Request, Response } from 'express'
import type {
  AuthSessionResponse,
  CurrentOwnerResponse,
  ErrorResponse,
} from '../types.js'
import {
  type AppRouteContext,
  loginRateLimitPolicy,
  parseAuthorizationToken,
  registerRateLimitPolicy,
  requireAuthenticatedAccount,
} from '../route-support.js'
import {
  validateOwnerLoginInput,
  validateOwnerRegistrationInput,
} from '../validation.js'

export function registerAuthRoutes(app: Express, context: AppRouteContext) {
  app.post(
    '/api/auth/register',
    (
      request: Request,
      response: Response<AuthSessionResponse | ErrorResponse>,
    ) => {
      if (context.isRateLimited(request, response, 'auth-register', registerRateLimitPolicy)) {
        return
      }

      const validation = validateOwnerRegistrationInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Owner registration payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const noteStore = context.getNoteStore()
      const owner = noteStore.createOwnerAccount(validation.data)

      if (!owner) {
        response.status(409).json({
          error: `An owner account already exists for ${validation.data.email}.`,
        })
        return
      }

      const token = noteStore.createOwnerSession(owner.id)
      response.status(201).json({ token, owner })
    },
  )

  app.post(
    '/api/auth/login',
    (
      request: Request,
      response: Response<AuthSessionResponse | ErrorResponse>,
    ) => {
      if (context.isRateLimited(request, response, 'auth-login', loginRateLimitPolicy)) {
        return
      }

      const validation = validateOwnerLoginInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Owner login payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const noteStore = context.getNoteStore()
      const owner = noteStore.authenticateOwner(
        validation.data.email,
        validation.data.password,
      )

      if (!owner) {
        response.status(401).json({ error: 'Email or password is incorrect.' })
        return
      }

      const token = noteStore.createOwnerSession(owner.id)
      response.json({ token, owner })
    },
  )

  app.get(
    '/api/auth/session',
    (
      request: Request,
      response: Response<CurrentOwnerResponse | ErrorResponse>,
    ) => {
      const owner = requireAuthenticatedAccount(context.getNoteStore(), request, response)

      if (!owner) {
        return
      }

      response.json({ owner })
    },
  )

  app.post(
    '/api/auth/logout',
    (
      request: Request,
      response: Response<undefined | ErrorResponse>,
    ) => {
      const token = parseAuthorizationToken(request)

      if (!token) {
        response.status(401).json({ error: 'Owner authentication is required.' })
        return
      }

      context.getNoteStore().deleteOwnerSession(token)
      response.status(204).send()
    },
  )
}
