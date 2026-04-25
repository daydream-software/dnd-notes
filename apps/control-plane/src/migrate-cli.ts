/**
 * CLI entry: `npm run db:migrate` for the control-plane service.
 */
import 'dotenv/config'
import { runMigrationsCli } from './migrations.js'

runMigrationsCli().catch((error: unknown) => {
  console.error('[migrate] control-plane migrations failed:', error)
  process.exit(1)
})
