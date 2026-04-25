import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const omit = (process.env.npm_config_omit ?? '').split(/[ ,]+/).filter(Boolean)
if (omit.includes('dev')) {
  console.log('Skipping workspace builds: dev dependencies are omitted.')
  process.exit(0)
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const buildWorkspaces = [
  {
    name: 'portal-utils',
    sourceDirectory: 'packages/portal-utils/src',
    workspace: 'packages/portal-utils',
  },
  {
    name: 'postgres-migrations',
    sourceDirectory: 'packages/postgres-migrations/src',
    workspace: 'packages/postgres-migrations',
  },
  {
    name: 'keycloak-jwt',
    sourceDirectory: 'platform/keycloak-jwt/src',
    workspace: 'platform/keycloak-jwt',
  },
]

for (const { name, sourceDirectory, workspace } of buildWorkspaces) {
  if (!existsSync(sourceDirectory)) {
    console.log(`Skipping ${name} build: source directory not present.`)
    continue
  }

  const result = spawnSync(npmCmd, ['run', 'build', '--workspace', workspace], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
