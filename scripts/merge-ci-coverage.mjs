import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const coverageRoot = path.join(rootDir, 'reports', 'coverage')

function round(value) {
  return Number.parseFloat(value.toFixed(2))
}

function formatPercent(metric) {
  return `${round(metric.pct ?? 0).toFixed(2)}%`
}

function createEmptySummary() {
  return {
    lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
    statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
    functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
    branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
  }
}

function mergeMetric(target, source) {
  target.total += source.total ?? 0
  target.covered += source.covered ?? 0
  target.skipped += source.skipped ?? 0
  target.pct = target.total === 0 ? 0 : (target.covered / target.total) * 100
}

async function readWorkspaceSummaries() {
  let entries = []

  try {
    entries = await readdir(coverageRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const workspaces = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const summaryPath = path.join(coverageRoot, entry.name, 'coverage-summary.json')

    try {
      const summary = JSON.parse(await readFile(summaryPath, 'utf8'))
      workspaces.push({
        name: entry.name,
        path: summaryPath,
        totals: summary.total,
      })
    } catch {
      continue
    }
  }

  return workspaces.sort((left, right) => left.name.localeCompare(right.name))
}

async function mergeLcovFiles(workspaces) {
  const lcovPaths = workspaces.map((workspace) =>
    path.join(coverageRoot, workspace.name, 'lcov.info'),
  )
  const chunks = []

  for (const lcovPath of lcovPaths) {
    try {
      const info = await stat(lcovPath)

      if (!info.isFile()) {
        continue
      }

      const content = (await readFile(lcovPath, 'utf8')).trim()

      if (content) {
        chunks.push(content)
      }
    } catch {
      continue
    }
  }

  if (chunks.length === 0) {
    return null
  }

  const mergedPath = path.join(coverageRoot, 'lcov.info')
  await writeFile(mergedPath, `${chunks.join('\n')}\n`)
  return mergedPath
}

function buildMarkdown(workspaces, total) {
  const header = [
    '# Coverage Summary',
    '',
    '| Workspace | Lines | Branches | Functions | Statements |',
    '| --- | ---: | ---: | ---: | ---: |',
  ]

  const rows = workspaces.map(({ name, totals }) => {
    return `| ${name} | ${formatPercent(totals.lines)} | ${formatPercent(
      totals.branches,
    )} | ${formatPercent(totals.functions)} | ${formatPercent(totals.statements)} |`
  })

  rows.push(
    `| **Total** | **${formatPercent(total.lines)}** | **${formatPercent(
      total.branches,
    )}** | **${formatPercent(total.functions)}** | **${formatPercent(
      total.statements,
    )}** |`,
  )

  return `${header.concat(rows).join('\n')}\n`
}

export async function mergeCiCoverage() {
  await mkdir(coverageRoot, { recursive: true })

  const workspaces = await readWorkspaceSummaries()
  const total = createEmptySummary()

  for (const workspace of workspaces) {
    mergeMetric(total.lines, workspace.totals.lines)
    mergeMetric(total.statements, workspace.totals.statements)
    mergeMetric(total.functions, workspace.totals.functions)
    mergeMetric(total.branches, workspace.totals.branches)
  }

  await mergeLcovFiles(workspaces)

  const summary = {
    generatedAt: new Date().toISOString(),
    workspaces: workspaces.map(({ name, totals, path: summaryPath }) => ({
      name,
      summaryPath: path.relative(rootDir, summaryPath),
      totals,
    })),
    total,
  }

  const markdown =
    workspaces.length === 0
      ? '# Coverage Summary\n\nNo coverage reports were generated.\n'
      : buildMarkdown(workspaces, total)

  await writeFile(
    path.join(coverageRoot, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  await writeFile(path.join(coverageRoot, 'summary.md'), markdown)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mergeCiCoverage().catch(async (error) => {
    try {
      await rm(path.join(coverageRoot, 'summary.md'), { force: true })
    } catch {
      // ignore cleanup errors
    }
    console.error(error)
    process.exitCode = 1
  })
}
