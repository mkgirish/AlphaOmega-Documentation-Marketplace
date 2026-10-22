// CMP-3 — the Fastify API. It serves the registration screen, the IF-2 liveness probe
// (the compose healthcheck probes GET /) and POST /api/registrations. The supervised
// Postgres child lands with its story under src/persistence.
import Fastify, { type FastifyInstance } from 'fastify'
import { loadConfig, type Config } from './config.js'
import { logger } from './observability/index.js'
import { migrate, openDatabase, type Database } from './persistence/database.js'
import { registrationRepository, type RegistrationRepository } from './persistence/registrations.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Where registrations are written; absent, POST /api/registrations answers 500. */
  readonly registrations?: RegistrationRepository
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify(securityServerOptions)
  registerSecurity(app)
  registerScreen(app, { webRoot: options.webRoot ?? loadConfig().webRoot })
  registerRegistrations(app, { repository: options.registrations })
  return app
}

export async function start(config: Config = loadConfig()): Promise<FastifyInstance> {
  const database = config.databaseUrl === undefined ? undefined : await openMigrated(config.databaseUrl)
  const app = buildApp({
    webRoot: config.webRoot,
    ...(database === undefined ? {} : { registrations: registrationRepository(database) }),
  })
  if (database !== undefined) {
    app.addHook('onClose', () => database.close())
  }
  try {
    await app.listen({ port: config.port, host: config.host })
  } catch (err) {
    await app.close()
    throw err
  }
  logger.info({ port: config.port }, 'registration-api listening')
  return app
}

/** Opens and migrates the database; unreachable, the screen is still served and POSTs answer 500. */
async function openMigrated(url: string): Promise<Database | undefined> {
  const database = openDatabase(url)
  try {
    await migrate(database)
    return database
  } catch (err) {
    logger.error({ code: (err as { code?: string }).code ?? 'unknown' }, 'startup.db_unavailable')
    await database.close()
    return undefined
  }
}

// dist/main.js is the container entrypoint; start only when run directly.
if (process.argv[1]?.endsWith('main.js')) {
  start().catch((err) => {
    logger.error(err)
    process.exit(1)
  })
}
