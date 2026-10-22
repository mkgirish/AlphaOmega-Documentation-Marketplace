// CMP-3 — the Fastify API. It serves the registration screen, the IF-2 liveness probe
// (the compose healthcheck probes GET /) and POST /api/registrations. The supervised
// Postgres child lands with its story under src/persistence.
import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import { loadConfig, type Config } from './config.js'
import { logger } from './observability/index.js'
import { createRegistrationRepository, unavailableRepository, type RegistrationRepository } from './persistence/repository.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Where registrations are stored; without one every POST answers 500. */
  readonly repository?: RegistrationRepository
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify(securityServerOptions)
  registerSecurity(app)
  registerScreen(app, { webRoot: options.webRoot ?? loadConfig().webRoot })
  registerRegistrations(app, { repository: options.repository ?? unavailableRepository })
  return app
}

export async function start(config: Config = loadConfig()): Promise<FastifyInstance> {
  // pg connects lazily, on the first insert; without DATABASE_URL it falls back to its PG* defaults.
  const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5_000 })
  // An idle client losing its connection must not take the process down; the next POST answers 500.
  pool.on('error', (err: Error & { code?: string }) => {
    logger.error({ code: err.code }, 'db.pool_error')
  })
  const repository = createRegistrationRepository(pool)
  const app = buildApp({ webRoot: config.webRoot, repository })
  app.addHook('onClose', async () => {
    await pool.end()
  })
  await app.listen({ port: config.port, host: config.host })
  logger.info({ port: config.port }, 'registration-api listening')
  return app
}

// dist/main.js is the container entrypoint; start only when run directly.
if (process.argv[1]?.endsWith('main.js')) {
  start().catch((err) => {
    logger.error(err)
    process.exit(1)
  })
}
