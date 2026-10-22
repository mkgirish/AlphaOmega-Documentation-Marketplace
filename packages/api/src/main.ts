// CMP-3 — the Fastify API. It serves the registration screen and the IF-2 liveness probe
// (the compose healthcheck probes GET /), and POST /api/registrations (ST-10). The supervised Postgres child
// lands with its story under src/persistence.
import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import { loadConfig, type Config } from './config.js'
import { logger } from './observability/index.js'
import { applyMigrations } from './persistence/migrate.js'
import { createPgStore, unavailableStore, type RegistrationStore } from './persistence/repository.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Where registrations are written; without one every POST answers 500. */
  readonly store?: RegistrationStore
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify(securityServerOptions)
  registerSecurity(app)
  registerScreen(app, { webRoot: options.webRoot ?? loadConfig().webRoot })
  registerRegistrations(app, { store: options.store ?? unavailableStore })
  return app
}

export async function start(config: Config = loadConfig()): Promise<FastifyInstance> {
  const pool = config.databaseUrl === undefined ? undefined : new pg.Pool({ connectionString: config.databaseUrl })
  if (pool === undefined) {
    logger.warn('startup.db_unconfigured')
  } else {
    // An idle client dropped by the server must not crash the process; log the code only.
    pool.on('error', (error: Error & { code?: string }) => logger.error({ code: error.code ?? 'unknown' }, 'db.pool_error'))
  }
  const app = buildApp({ webRoot: config.webRoot, store: pool === undefined ? undefined : createPgStore(pool) })
  app.addHook('onClose', async () => {
    await pool?.end()
  })
  try {
    if (pool !== undefined) await applyMigrations(pool)
    await app.listen({ port: config.port, host: config.host })
  } catch (error) {
    await app.close()
    throw error
  }
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
