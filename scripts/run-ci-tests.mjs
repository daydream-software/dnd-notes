import { mkdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { mergeCiCoverage } from './merge-ci-coverage.mjs'
import { normalizeJUnitReports } from './normalize-junit-results.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const reportsDir = path.join(rootDir, 'reports')

const suites = [
  { name: 'keycloak-jwt', script: 'test:ci:keycloak-jwt' },
  { name: 'portal-utils', script: 'test:ci:portal-utils' },
  { name: 'web', script: 'test:ci:web' },
  { name: 'api', script: 'test:ci:api' },
  { name: 'control-plane', script: 'test:ci:control-plane' },
  { name: 'operator-portal', script: 'test:ci:operator-portal' },
  { name: 'customer-portal', script: 'test:ci:customer-portal' },
]

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function runSuite({ name, script }) {
  return new Promise((resolve) => {
    const child = spawn(getNpmCommand(), ['run', script], {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
    })

    child.on('exit', (code, signal) => {
      resolve({
        name,
        code: code ?? 1,
        signal,
        passed: code === 0 && !signal,
      })
    })

    child.on('error', (error) => {
      console.error(`Failed to start ${name} suite:`, error)
      resolve({
        name,
        code: 1,
        signal: null,
        passed: false,
      })
    })
  })
}

await rm(reportsDir, { recursive: true, force: true })
await mkdir(path.join(reportsDir, 'test-results'), { recursive: true })
await mkdir(path.join(reportsDir, 'coverage'), { recursive: true })
await Promise.all(
  suites.flatMap(({ name }) => [
    mkdir(path.join(reportsDir, 'coverage', name), { recursive: true }),
    mkdir(path.join(reportsDir, 'coverage', name, '.tmp'), { recursive: true }),
  ]),
)

const results = []

for (const suite of suites) {
  console.log(`\n==> Running ${suite.name} CI test suite\n`)
  results.push(await runSuite(suite))
}

await normalizeJUnitReports()
await mergeCiCoverage()

console.log('\nCI test summary:')

for (const result of results) {
  const detail = result.signal ? ` (signal: ${result.signal})` : ''
  console.log(`- ${result.name}: ${result.passed ? 'passed' : 'failed'}${detail}`)
}

if (results.some((result) => !result.passed)) {
  process.exitCode = 1
}
