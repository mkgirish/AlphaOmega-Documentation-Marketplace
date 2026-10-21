// CMP-3 — the Fastify API. It serves the registration screen and the IF-2 liveness probe
// (the compose healthcheck probes GET /), and POST /api/registrations refuses blank fields
// (ST-3). The Postgres repository and its supervised child land with their stories under
// src/persistence and drizzle/.
import Fastify, { type FastifyInstance } from 'fastify'
import { loadConfig, type Config } from './config.js'
import { logger } from './observability/index.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { unavailableRepository, type RegistrationRepository } from './persistence/repository.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Where accepted registrations are stored; without one, a complete POST answers 500. */
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
  const app = buildApp({ webRoot: config.webRoot })
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
