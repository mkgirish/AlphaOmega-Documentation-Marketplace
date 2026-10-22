// CMP-3 — the Fastify API. It serves the registration screen, the IF-2 liveness probe
// (the compose healthcheck probes GET /) and POST /api/registrations. The supervised
// Postgres child lands with its story; until then DATABASE_URL names the database.
import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import { loadConfig, type Config } from './config.js'
import { logger } from './observability/index.js'
import { migrate, pgRegistrations, unavailableRegistrations, type RegistrationRepository } from './persistence/registrations.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Where registrations are stored; without one, POST /api/registrations answers 500. */
  readonly registrations?: RegistrationRepository
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify(securityServerOptions)
  registerSecurity(app)
  registerScreen(app, { webRoot: options.webRoot ?? loadConfig().webRoot })
  registerRegistrations(app, { registrations: options.registrations ?? unavailableRegistrations })
  return app
}

export async function start(config: Config = loadConfig()): Promise<FastifyInstance> {
  const pool = config.databaseUrl === undefined ? undefined : new pg.Pool({ connectionString: config.databaseUrl })
  // The pool discards a broken idle client itself; the next insert fails as request.failed.
  pool?.on('error', () => undefined)
  try {
    if (pool !== undefined) await migrate(pool)
    const app = buildApp({ webRoot: config.webRoot, registrations: pool && pgRegistrations(pool) })
    app.addHook('onClose', async () => {
      await pool?.end()
    })
    await app.listen({ port: config.port, host: config.host })
    logger.info({ port: config.port }, 'registration-api listening')
    return app
  } catch (err) {
    await pool?.end()
    throw err
  }
}

// dist/main.js is the container entrypoint; start only when run directly.
if (process.argv[1]?.endsWith('main.js')) {
  start().catch((err) => {
    logger.error(err)
    process.exit(1)
  })
}
