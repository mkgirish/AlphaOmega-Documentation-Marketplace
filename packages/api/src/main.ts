// CMP-3 — the Fastify API. It serves the registration screen, the IF-2 liveness probe
// (the compose healthcheck probes GET /) and POST /api/registrations (ST-2). The supervised
// Postgres child lands with its story under src/persistence.
import Fastify, { type FastifyInstance } from 'fastify'
import { DEFAULT_RATE_LIMITS, loadConfig, type Config, type RateLimits } from './config.js'
import { logger } from './observability/index.js'
import { openDatabase } from './persistence/database.js'
import { migrate } from './persistence/migrate.js'
import { createRegistrationRepository, type RegistrationRepository } from './persistence/repository.js'
import { registerSecurity, securityServerOptions } from './plugins/security.js'
import { registerRegistrations } from './routes/registrations.js'
import { registerScreen } from './routes/screen.js'

export interface AppOptions {
  readonly webRoot?: string
  /** Where accepted registrations go; null or absent means no store, so POST answers 500. */
  readonly repository?: RegistrationRepository | null
  readonly rateLimits?: RateLimits
  readonly now?: () => Date
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify(securityServerOptions)
  registerSecurity(app)
  registerScreen(app, { webRoot: options.webRoot ?? loadConfig().webRoot })
  registerRegistrations(app, {
    repository: options.repository ?? null,
    rateLimits: options.rateLimits ?? DEFAULT_RATE_LIMITS,
    now: options.now ?? (() => new Date()),
  })
  return app
}

// Opens the store and applies the committed migrations. A store that cannot be reached is
// logged once without detail and the screen is still served; saves then answer 500.
async function connect(
  databaseUrl: string | undefined,
): Promise<{ repository: RegistrationRepository | null; close: () => Promise<void> }> {
  if (databaseUrl === undefined) return { repository: null, close: async () => undefined }
  const database = openDatabase(databaseUrl)
  try {
    await migrate(database.pool)
    return { repository: createRegistrationRepository(database.db), close: () => database.close() }
  } catch (err) {
    logger.error({ sqlstate: (err as { code?: unknown }).code ?? 'unknown' }, 'startup.db_unavailable')
    await database.close()
    return { repository: null, close: async () => undefined }
  }
}

/** What stopOnSignals needs of the process: its signals and a way to exit. */
export interface SignalSource {
  once(signal: NodeJS.Signals, listener: () => void): unknown
  exit(code: number): void
}

const STOP_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT']

// tini forwards `docker stop`'s SIGTERM and Ctrl+C's SIGINT; the first one closes the
// server and its store once, then exits 0 (a failed close exits 1, logged without detail).
export function stopOnSignals(app: FastifyInstance, source: SignalSource = process): void {
  let stopping = false
  const stop = (): void => {
    if (stopping) return
    stopping = true
    app.close().then(
      () => source.exit(0),
      (err: unknown) => {
        logger.error({ code: (err as { code?: unknown }).code ?? 'unknown' }, 'shutdown.failed')
        source.exit(1)
      },
    )
  }
  for (const signal of STOP_SIGNALS) source.once(signal, stop)
}

export async function start(config: Config = loadConfig()): Promise<FastifyInstance> {
  const store = await connect(config.databaseUrl)
  const app = buildApp({ webRoot: config.webRoot, repository: store.repository, rateLimits: config.rateLimits })
  app.addHook('onClose', store.close)
  await app.listen({ port: config.port, host: config.host })
  logger.info({ port: config.port }, 'registration-api listening')
  return app
}

// dist/main.js is the container entrypoint; start only when run directly.
if (process.argv[1]?.endsWith('main.js')) {
  start().then(stopOnSignals, (err) => {
    logger.error(err)
    process.exit(1)
  })
}
