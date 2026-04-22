/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { normalizeBasePath } from './src/base-path'

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
    plugins: [react()],
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
