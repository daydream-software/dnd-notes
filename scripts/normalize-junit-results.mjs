import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const reportsDir = path.join(rootDir, 'reports', 'test-results')

const parser = new DOMParser()
const serializer = new XMLSerializer()

function stripXmlDeclaration(xml) {
  return xml.replace(/^\uFEFF?<\?xml[^?]*\?>\s*/i, '')
}

function getChildElements(node, tagName) {
  return Array.from(node.childNodes ?? []).filter(
    (child) =>
      child.nodeType === child.ELEMENT_NODE &&
      (tagName === undefined || child.tagName === tagName),
  )
}

function getWorkspaceLabel(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/\.junit$/, '')
}

function toNumber(value) {
  const number = Number.parseFloat(value ?? '')
  return Number.isFinite(number) ? number : 0
}

function getLeafSuites(node, parentPath, syntheticName) {
  const suiteName = node.getAttribute?.('name')?.trim() || syntheticName
  const suitePath = suiteName ? parentPath.concat(suiteName) : parentPath
  const childSuites = getChildElements(node, 'testsuite')
  const cases = getChildElements(node, 'testcase')
  const leafSuites = []

  if (cases.length > 0 || childSuites.length === 0) {
    leafSuites.push({
      name: suitePath.join(' > ') || syntheticName,
      node,
      path: suitePath,
      cases,
    })
  }

  for (const childSuite of childSuites) {
    leafSuites.push(...getLeafSuites(childSuite, suitePath, syntheticName))
  }

  return leafSuites
}

function collectSuites(document, workspaceLabel) {
  const root = document.documentElement
  const syntheticName = workspaceLabel
  const childSuites =
    root.tagName === 'testsuites' ? getChildElements(root, 'testsuite') : [root]
  const directCases =
    root.tagName === 'testsuites' ? getChildElements(root, 'testcase') : []
  const suites = []

  if (directCases.length > 0) {
    suites.push({
      name: syntheticName,
      node: root,
      path: [syntheticName],
      cases: directCases,
    })
  }

  for (const suite of childSuites) {
    suites.push(...getLeafSuites(suite, [], syntheticName))
  }

  return suites
}

function getCaseStatus(testcase) {
  const tags = new Set(getChildElements(testcase).map((child) => child.tagName))

  if (tags.has('error')) {
    return 'error'
  }
  if (tags.has('failure')) {
    return 'failure'
  }
  if (tags.has('skipped') || tags.has('disabled')) {
    return 'skipped'
  }
  return 'success'
}

function getBaseClassName(testcase, suite, workspaceLabel) {
  const original = testcase.getAttribute('classname')?.trim()

  if (original && original !== 'test') {
    return original
  }

  return suite.path.join(' > ') || workspaceLabel
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function serializeAttributes(attributes) {
  return attributes
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}="${escapeXml(value)}"`)
    .join(' ')
}

function normalizeSuiteElement(suite, workspaceLabel, duplicateCounts) {
  const testcases = []
  let failures = 0
  let errors = 0
  let skipped = 0
  let time = 0

  for (const testcase of suite.cases) {
    const cloned = testcase.cloneNode(true)
    const baseClassName = getBaseClassName(testcase, suite, workspaceLabel)
    const key = `${baseClassName}\u0000${cloned.getAttribute('name') ?? ''}`
    const nextCount = (duplicateCounts.get(key) ?? 0) + 1
    duplicateCounts.set(key, nextCount)
    const className =
      nextCount === 1 ? baseClassName : `${baseClassName} [${nextCount}]`

    cloned.setAttribute('classname', className)
    testcases.push(stripXmlDeclaration(serializer.serializeToString(cloned)))

    const status = getCaseStatus(testcase)
    if (status === 'failure') {
      failures += 1
    } else if (status === 'error') {
      errors += 1
    } else if (status === 'skipped') {
      skipped += 1
    }

    time += toNumber(testcase.getAttribute('time'))
  }

  const hostname = suite.node.getAttribute?.('hostname')
  const timestamp = suite.node.getAttribute?.('timestamp')
  const attributes = serializeAttributes([
    ['name', suite.name],
    ['tests', String(testcases.length)],
    ['failures', String(failures)],
    ['errors', String(errors)],
    ['skipped', String(skipped)],
    ['time', String(time)],
    ['hostname', hostname],
    ['timestamp', timestamp],
  ])

  return {
    xml: `<testsuite ${attributes}>${testcases.join('')}</testsuite>`,
    tests: testcases.length,
    failures,
    errors,
    skipped,
    time,
  }
}

function hasParseError(document) {
  return getChildElements(document, 'parsererror').length > 0
}

async function normalizeReport(filePath) {
  const source = stripXmlDeclaration(await readFile(filePath, 'utf8'))
  const document = parser.parseFromString(source, 'application/xml')

  if (hasParseError(document)) {
    throw new Error(`Unable to parse JUnit XML: ${path.relative(rootDir, filePath)}`)
  }

  const workspaceLabel = getWorkspaceLabel(filePath)
  const suites = collectSuites(document, workspaceLabel)
  const duplicateCounts = new Map()

  let tests = 0
  let failures = 0
  let errors = 0
  let skipped = 0
  let time = 0
  const suiteXml = []

  for (const suite of suites) {
    const normalized = normalizeSuiteElement(suite, workspaceLabel, duplicateCounts)
    suiteXml.push(normalized.xml)
    tests += normalized.tests
    failures += normalized.failures
    errors += normalized.errors
    skipped += normalized.skipped
    time += normalized.time
  }

  const rootAttributes = serializeAttributes([
    ['name', `${workspaceLabel} tests`],
    ['tests', String(tests)],
    ['failures', String(failures)],
    ['errors', String(errors)],
    ['skipped', String(skipped)],
    ['time', String(time)],
  ])
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites ${rootAttributes}>${suiteXml.join(
    '',
  )}</testsuites>\n`
  await writeFile(filePath, xml)
}

export async function normalizeJUnitReports() {
  let entries = []

  try {
    entries = await readdir(reportsDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.xml')) {
      continue
    }

    await normalizeReport(path.join(reportsDir, entry.name))
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  normalizeJUnitReports().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
