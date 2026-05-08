import type { Express, Request, Response } from 'express'
import type {
  AuthConfigResponse,
  AuthSessionResponse,
  CurrentOwnerResponse,
  ErrorResponse,
} from '../types.js'
import {
  createAuthLoginLimiter,
  createAuthLogoutLimiter,
  createAuthRegisterLimiter,
} from '../rate-limiters.js'
import {
  type AppRouteContext,
  parseAuthorizationToken,
  requireAuthenticatedAccount,
} from '../route-support.js'
import {
  validateOwnerLoginInput,
  validateOwnerRegistrationInput,
} from '../validation.js'

export function registerAuthRoutes(app: Express, context: AppRouteContext) {
  const authRegisterLimiter = createAuthRegisterLimiter()
  const authLoginLimiter = createAuthLoginLimiter()
  const authLogoutLimiter = createAuthLogoutLimiter()

  app.get(
    '/api/auth/config',
    (_request: Request, response: Response<AuthConfigResponse>) => {
      response.json(context.runtimeAuth.authConfig)
    },
  )

  app.post(
    '/api/auth/register',
    authRegisterLimiter,
    async (
      request: Request,
      response: Response<AuthSessionResponse | ErrorResponse>,
    ) => {
      if (context.runtimeAuth.mode === 'keycloak') {
        response.status(404).json({
          error: 'Local auth routes are disabled when Keycloak auth is enabled.',
        })
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
      const owner = await noteStore.createOwnerAccount(validation.data)

      if (!owner) {
        response.status(409).json({
          error: `An owner account already exists for ${validation.data.email}.`,
        })
        return
      }

      const token = await noteStore.createOwnerSession(owner.id)
      response.status(201).json({ token, owner })
    },
  )

  app.post(
    '/api/auth/login',
    authLoginLimiter,
    async (
      request: Request,
      response: Response<AuthSessionResponse | ErrorResponse>,
    ) => {
      if (context.runtimeAuth.mode === 'keycloak') {
        response.status(404).json({
          error: 'Local auth routes are disabled when Keycloak auth is enabled.',
        })
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
      const owner = await noteStore.authenticateOwner(
        validation.data.email,
        validation.data.password,
      )

      if (!owner) {
        response.status(401).json({ error: 'Email or password is incorrect.' })
        return
      }

      const token = await noteStore.createOwnerSession(owner.id)
      response.json({ token, owner })
    },
  )

  app.get(
    '/api/auth/session',
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

  app.post(
    '/api/auth/logout',
    authLogoutLimiter,
    async (
      request: Request,
      response: Response<undefined | ErrorResponse>,
    ) => {
      if (context.runtimeAuth.mode === 'keycloak') {
        response.status(204).send()
        return
      }

      const token = parseAuthorizationToken(request)

      if (!token) {
        response.status(401).json({ error: 'Owner authentication is required.' })
        return
      }

      await context.getNoteStore().deleteOwnerSession(token)
      response.status(204).send()
    },
  )
}
