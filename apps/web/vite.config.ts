/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

interface SharedSessionPayload {
  shareLink?: {
    frameAncestors?: string | null
  }
}

function createFrameAncestorsPlugin(apiBaseUrl: string): Plugin {
  const applyFrameAncestorsHeader = async (
    request: { method?: string; url?: string; headers: { accept?: string } },
    response: { setHeader(name: string, value: string): void },
    next: () => void,
  ) => {
    if (request.method !== 'GET' || !request.url) {
      next()
      return
    }

    const accept = request.headers.accept ?? ''

    if (!accept.includes('text/html')) {
      next()
      return
    }

    const url = new URL(request.url, 'http://localhost')
    const shareMatch = url.pathname.match(/^\/share\/([^/]+)\/?$/)
    let policy = "frame-ancestors 'none'"

    if (shareMatch) {
      try {
        const sessionResponse = await fetch(
          `${apiBaseUrl}/api/shared/${encodeURIComponent(shareMatch[1])}/session`,
        )

        if (sessionResponse.ok) {
          const payload = (await sessionResponse.json()) as SharedSessionPayload
          policy = `frame-ancestors ${payload.shareLink?.frameAncestors?.trim() || "'none'"}`
        }
      } catch {
        policy = "frame-ancestors 'none'"
      }
    }

    response.setHeader('Content-Security-Policy', policy)
    next()
  }

  return {
    name: 'frame-ancestors-headers',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void applyFrameAncestorsHeader(request, response, next)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        void applyFrameAncestorsHeader(request, response, next)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBaseUrl =
    env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3001'

  return {
    plugins: [react(), createFrameAncestorsPlugin(apiBaseUrl)],
    test: {
      environment: 'jsdom',
      pool: 'threads',
      testTimeout: 15000,
    },
  }
})
