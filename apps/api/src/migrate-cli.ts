/**
 * CLI entry: `npm run db:migrate` for the tenant API.
 */
import 'dotenv/config'
import { runMigrationsCli } from './migrations.js'

runMigrationsCli().catch((error: unknown) => {
  console.error('[migrate] tenant-api migrations failed:', error)
  process.exit(1)
})
