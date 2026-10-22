// CMP-3 — the Fastify API. It serves the registration screen and the IF-2 liveness probe
// (the compose healthcheck probes GET /). Persistence and the supervised Postgres child
// land with their stories under src/persistence and drizzle/.
import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import { loadConfig, type Config } from './config.js'
import { logger, type Logger } from './observability/index.js'
import { createPgStore, unavailableStore, type RegistrationStore } from './persistence/repository.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Where registrations are written; the write route exists only once a store is wired. */
  readonly store?: RegistrationStore
  readonly logger?: Logger
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify(securityServerOptions)
  registerSecurity(app, options.logger ?? logger)
  registerScreen(app, { webRoot: options.webRoot ?? loadConfig().webRoot })
  if (options.store !== undefined) {
    registerRegistrations(app, { store: options.store, logger: options.logger ?? logger })
  }
  return app
}

/** A pool whose dropped idle connections are logged by code instead of crashing the process. */
function pool(connectionString: string): pg.Pool {
  const created = new pg.Pool({ connectionString })
  created.on('error', (error: Error & { code?: string }) => logger.error({ code: error.code ?? 'unknown' }, 'request.failed'))
  return created
}

export async function start(config: Config = loadConfig()): Promise<FastifyInstance> {
  const store = config.databaseUrl === undefined ? unavailableStore : createPgStore(pool(config.databaseUrl))
  const app = buildApp({ webRoot: config.webRoot, store })
  app.addHook('onClose', () => store.close())
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
