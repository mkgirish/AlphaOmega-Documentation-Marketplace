// CMP-3 — the Fastify API. It serves the registration screen and IF-2's liveness answer
// at / (ST-1); persistence and the supervised Postgres child land with their stories
// under src/persistence and drizzle/.
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import { loadConfig } from './config.js'
import { logger } from './observability/index.js'
import { frameworkError, registerErrorHandlers } from './plugins/errors.js'
import { registerSecurityHeaders } from './plugins/security-headers.js'
import { registerScreenRoutes } from './routes/screen.js'

export interface AppOptions {
  /** The vite build of packages/web; resolved beside this package by default. */
  readonly webRoot?: string
}

const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../../web/dist/', import.meta.url))

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ frameworkErrors: frameworkError })
  registerSecurityHeaders(app)
  registerErrorHandlers(app)
  registerScreenRoutes(app, options.webRoot ?? DEFAULT_WEB_ROOT)
  return app
}

export async function start(env: NodeJS.ProcessEnv = process.env): Promise<FastifyInstance> {
  const config = loadConfig(env)
  const app = buildApp()
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
