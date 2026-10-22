// CMP-3 — the Fastify API. It serves the registration screen and the IF-2 liveness probe
// (the compose healthcheck probes GET /). Persistence and the supervised Postgres child
// land with their stories under src/persistence and drizzle/.
import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import type { Logger } from 'pino'
import { loadConfig, type Config } from './config.js'
import { logger } from './observability/index.js'
import { createPgRegistrationStore, type RegistrationStore } from './persistence/registrations.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Where valid registrations are kept; without one a valid POST answers 503. */
  readonly registrations?: RegistrationStore
  readonly logger?: Logger
  readonly now?: () => Date
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify(securityServerOptions)
  registerSecurity(app)
  registerScreen(app, { webRoot: options.webRoot ?? loadConfig().webRoot })
  registerRegistrations(app, {
    store: options.registrations,
    logger: options.logger ?? logger,
    now: options.now ?? (() => new Date()),
  })
  return app
}

export async function start(config: Config = loadConfig()): Promise<FastifyInstance> {
  const pool = config.databaseUrl === undefined ? undefined : new pg.Pool({ connectionString: config.databaseUrl })
  const app = buildApp({ webRoot: config.webRoot, registrations: pool && createPgRegistrationStore(pool) })
  if (pool !== undefined) app.addHook('onClose', async () => pool.end())
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
