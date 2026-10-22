// CMP-3 — the Fastify API. It serves the registration screen, the IF-2 liveness probe
// (the compose healthcheck probes GET /) and, given a store, POST /api/registrations.
// The supervised Postgres child lands with its story under src/persistence.
import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import { DEFAULT_WEB_ROOT, loadConfig, type Config, type RateLimits } from './config.js'
import { logger } from './observability/index.js'
import { createPgStore, unavailableStore, type RegistrationStore } from './persistence/store.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Mounts POST /api/registrations writing to this store; without it only the screen is served. */
  readonly store?: RegistrationStore
  readonly rateLimits?: RateLimits
  readonly now?: () => number
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify(securityServerOptions)
  registerSecurity(app)
  registerScreen(app, { webRoot: options.webRoot ?? DEFAULT_WEB_ROOT })
  if (options.store !== undefined) {
    registerRegistrations(app, { store: options.store, rateLimits: options.rateLimits, now: options.now })
  }
  return app
}

export async function start(config: Config = loadConfig()): Promise<FastifyInstance> {
  const pool = config.databaseUrl === undefined ? undefined : new pg.Pool({ connectionString: config.databaseUrl })
  if (pool === undefined) logger.error({ event: 'startup.db_unavailable' }, 'startup.db_unavailable')
  // An idle client dropping must not take the process down; the next insert reports it.
  pool?.on('error', (err) => logger.error({ event: 'db.exited', sqlstate: (err as { code?: string }).code ?? 'unknown' }, 'db.exited'))
  const store = pool === undefined ? unavailableStore : createPgStore(pool)
  const app = buildApp({ webRoot: config.webRoot, store, rateLimits: config.rateLimits })
  app.addHook('onClose', async () => {
    await pool?.end()
  })
  try {
    await app.listen({ port: config.port, host: config.host })
  } catch (err) {
    await app.close()
    throw err
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
