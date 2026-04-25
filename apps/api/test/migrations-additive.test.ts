import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

const destructivePattern =
  /\b(DROP\s+(TABLE|COLUMN|INDEX|SCHEMA|CONSTRAINT)|ALTER\s+\w+\s+DROP|TRUNCATE|RENAME\s+(TO|COLUMN))\b/i

const opt = '-- @migration:destructive'

async function listSqlFiles(dir: string) {
  const entries = await readdir(dir)
  return entries.filter((entry) => entry.endsWith('.sql')).sort()
}

test('tenant API migrations are additive-only', async () => {
  const migrationsDir = path.resolve(moduleDir, '..', 'migrations')
  const files = await listSqlFiles(migrationsDir)
  assert.ok(files.length > 0, 'expected at least one migration file')

  for (const file of files) {
    const contents = await readFile(path.join(migrationsDir, file), 'utf8')
    const lines = contents.split(/\r?\n/)

    lines.forEach((line, index) => {
      if (!destructivePattern.test(line)) {
        return
      }

      if (line.includes(opt)) {
        return
      }

      assert.fail(
        `tenant API: ${file}:${index + 1} contains destructive SQL without the "${opt}" opt-in marker:\n  ${line.trim()}`,
      )
    })
  }
})
