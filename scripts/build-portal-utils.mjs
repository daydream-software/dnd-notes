import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const omit = (process.env.npm_config_omit ?? '').split(/[ ,]+/).filter(Boolean)
if (omit.includes('dev')) {
  console.log('Skipping portal-utils build: dev dependencies are omitted.')
  process.exit(0)
}

if (!existsSync('packages/portal-utils/src')) {
  console.log('Skipping portal-utils build: source directory not present.')
  process.exit(0)
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(
  npmCmd,
  ['run', 'build', '--workspace', 'packages/portal-utils'],
  { stdio: 'inherit' },
)
process.exit(result.status ?? 1)
