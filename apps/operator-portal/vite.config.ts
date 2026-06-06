/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { normalizeBasePath } from '@dnd-notes/portal-utils'

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBasePath = normalizeBasePath(
    env.VITE_OPERATOR_API_BASE_PATH,
    '/operator-api',
  )
  const proxyTarget =
    env.VITE_OPERATOR_DEV_PROXY_TARGET?.trim() ?? 'http://localhost:3001'

  return {
    // PluginOption[] cast: vite 8.0.16's Plugin types overflow tsc's
    // instantiation depth when compared against the vitest/config-augmented
    // UserConfig (TS2321 "excessive stack depth"). The cast short-circuits it.
    plugins: [react()] as PluginOption[],
    server: {
      proxy: {
        [apiBasePath]: {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (requestPath) =>
            requestPath.replace(new RegExp(`^${escapeForRegExp(apiBasePath)}`), ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      pool: 'threads',
      testTimeout: 15000,
    },
  }
})
