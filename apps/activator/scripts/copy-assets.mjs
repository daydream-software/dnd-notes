// Copy non-TS runtime assets into dist/ after tsc (which only emits .ts output).
// The Dockerfile ships apps/activator/dist, so anything the runtime reads at
// `new URL('./assets/...', import.meta.url)` must land in dist/assets.
import { cp, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../src/assets')
const dest = resolve(here, '../dist/assets')

await mkdir(dest, { recursive: true })
await cp(src, dest, { recursive: true })
console.log(`[activator] copied assets ${src} -> ${dest}`)
