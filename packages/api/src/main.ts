// CMP-3 — the Fastify API. It serves the registration screen, the IF-2 liveness probe
// (the compose healthcheck probes GET /) and the write-only POST /api/registrations.
// The supervised Postgres child lands with its story under src/persistence.
import Fastify, { type FastifyInstance } from 'fastify'
import { loadConfig, type Config } from './config.js'
import { logger } from './observability/index.js'
import { createPgRepository, unavailableRepository, type RegistrationRepository } from './persistence/repository.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Where registrations are written; defaults to a pool on databaseUrl. */
  readonly registrations?: RegistrationRepository
  /** Defaults to DATABASE_URL; with none, POST /api/registrations answers 500. */
  readonly databaseUrl?: string | undefined
}

function repositoryFor(app: FastifyInstance, options: AppOptions): RegistrationRepository {
  if (options.registrations !== undefined) return options.registrations
  const databaseUrl = 'databaseUrl' in options ? options.databaseUrl : loadConfig().databaseUrl
  if (databaseUrl === undefined) return unavailableRepository
  const repository = createPgRepository(databaseUrl)
  app.addHook('onClose', () => repository.close())
  return repository
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
