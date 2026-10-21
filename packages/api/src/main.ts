// CMP-3 — the Fastify API. It serves the registration screen, the IF-2 liveness probe
// (the compose healthcheck probes GET /) and POST /api/registrations. The supervised
// Postgres child lands with its story under src/persistence.
import Fastify, { type FastifyInstance } from 'fastify'
import pg from 'pg'
import { loadConfig, type Config } from './config.js'
import { logger } from './observability/index.js'
import { createPgRepository, unavailableRepository, type RegistrationRepository } from './persistence/repository.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Used as given; otherwise one is built from databaseUrl. */
  readonly repository?: RegistrationRepository
  /** Defaults to DATABASE_URL; with neither, every insert answers 500. */
  readonly databaseUrl?: string
}

function repositoryFor(app: FastifyInstance, options: AppOptions): RegistrationRepository {
  if (options.repository !== undefined) return options.repository
  const url = 'databaseUrl' in options ? options.databaseUrl : loadConfig().databaseUrl
  if (url === undefined) return unavailableRepository
  // A database that never answers fails the request (500) instead of holding it open.
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5_000 })
  // An idle client's error must not crash the process; the next query reports it.
  pool.on('error', () => undefined)
  app.addHook('onClose', async () => pool.end())
  return createPgRepository(pool)
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify(securityServerOptions)
  registerSecurity(app)
  registerScreen(app, { webRoot: options.webRoot ?? loadConfig().webRoot })
  registerRegistrations(app, { repository: repositoryFor(app, options) })
  return app
}

export async function start(config: Config = loadConfig()): Promise<FastifyInstance> {
  const app = buildApp({ webRoot: config.webRoot, databaseUrl: config.databaseUrl })
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
