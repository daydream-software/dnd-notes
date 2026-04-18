import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { TenantRegistry } from './tenant-registry.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rawPort = process.env.PORT
const PORT =
  rawPort === undefined ? 3001 : Number.parseInt(rawPort, 10)

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error(`Invalid PORT value: ${rawPort}`)
}

const DATABASE_PATH =
  process.env.DATABASE_PATH || path.join(__dirname, '../data/control-plane.sqlite')

const databaseDir = path.dirname(DATABASE_PATH)

await import('node:fs/promises').then((fs) =>
  fs.mkdir(databaseDir, { recursive: true }),
)

const tenantRegistry = new TenantRegistry(DATABASE_PATH)
const app = createApp({ tenantRegistry })

const server = app.listen(PORT, () => {
  console.log(`Control plane listening on port ${PORT}`)
  console.log(`Database: ${DATABASE_PATH}`)
})

const shutdown = () => {
  console.log('\nShutting down control plane...')
  server.close(() => {
    tenantRegistry.close()
    console.log('Control plane stopped')
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
