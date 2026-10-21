// CMP-3 — the Fastify API. Scaffold baseline: a liveness route matching IF-2's GET /
// (the compose healthcheck probes it). Routes, persistence and the supervised Postgres
// child land with their stories under src/routes, src/persistence and drizzle/.
import Fastify, { type FastifyInstance } from 'fastify'
import { loadConfig } from './config.js'
import { logger } from './observability/index.js'

export function buildApp(): FastifyInstance {
  const app = Fastify()
  app.get('/', async () => ({ ok: true }))
  return app
}

export async function start(): Promise<void> {
  const config = loadConfig()
  const app = buildApp()
  await app.listen({ port: config.port, host: config.host })
  logger.info({ port: config.port }, 'registration-api listening')
}

// dist/main.js is the container entrypoint; start only when run directly.
if (process.argv[1]?.endsWith('main.js')) {
  start().catch((err) => {
    logger.error(err)
    process.exit(1)
  })
}
