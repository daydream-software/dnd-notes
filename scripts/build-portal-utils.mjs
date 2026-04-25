import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const omit = (process.env.npm_config_omit ?? '').split(/[ ,]+/).filter(Boolean)
if (omit.includes('dev')) {
  console.log('Skipping workspace package builds: dev dependencies are omitted.')
  process.exit(0)
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
for (const workspace of ['packages/portal-utils', 'packages/postgres-migrations']) {
  if (!existsSync(`${workspace}/src`)) {
    console.log(`Skipping ${workspace} build: source directory not present.`)
    continue
  }

  const result = spawnSync(
    npmCmd,
    ['run', 'build', '--workspace', workspace],
    { stdio: 'inherit' },
  )

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1)
  }
}
