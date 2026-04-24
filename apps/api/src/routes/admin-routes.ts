import { type Express, type Request, type Response } from 'express'
import {
  type AdminAccountsResponse,
  type AdminOverviewResponse,
  type ErrorResponse,
} from '../types.js'
import {
  type AppRouteContext,
  requireSiteAdmin,
} from '../route-support.js'

export function registerAdminRoutes(app: Express, context: AppRouteContext) {
  app.get(
    '/api/admin/accounts',
    async (
      request: Request,
      response: Response<AdminAccountsResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const siteAdmin = await requireSiteAdmin(
        noteStore,
        request,
        response,
        context.runtimeAuth,
      )

      if (!siteAdmin) {
        return
      }

      response.json({ accounts: await noteStore.listOwnerAccounts() })
    },
  )

  app.get(
    '/api/admin/overview',
    async (
      request: Request,
      response: Response<AdminOverviewResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const siteAdmin = await requireSiteAdmin(
        noteStore,
        request,
        response,
        context.runtimeAuth,
      )

      if (!siteAdmin) {
        return
      }

      response.json({ overview: await noteStore.getAdminOverview() })
    },
  )
}
