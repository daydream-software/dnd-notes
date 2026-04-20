import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (!existsSync('.git')) {
  process.exit(0)
}

let huskyPackagePath
try {
  huskyPackagePath = require.resolve('husky/package.json')
} catch {
  process.exit(0)
}

const huskyBinPath = path.join(path.dirname(huskyPackagePath), 'bin.js')
const result = spawnSync(process.execPath, [huskyBinPath], { stdio: 'inherit' })

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
