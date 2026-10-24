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

/** Where shutdown signals come from; the process itself unless a test supplies its own. */
export interface SignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown
}

export interface StartOptions {
  readonly signals?: SignalSource
  readonly exit?: (code: number) => void
}

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT']

// `docker stop` reaches node as SIGTERM through tini: finish in-flight requests, close the
// store, and exit 0. The first signal wins and later ones are absorbed while it drains;
// the listeners go when the server closes.
function closeOnSignals(app: FastifyInstance, signals: SignalSource, exit: (code: number) => void): void {
  let closing = false
  const shutdown = (): void => {
    if (closing) return
    closing = true
    app.close().then(
      () => exit(0),
      () => exit(1),
    )
  }
  for (const signal of SHUTDOWN_SIGNALS) signals.on(signal, shutdown)
  app.addHook('onClose', async () => {
    for (const signal of SHUTDOWN_SIGNALS) signals.removeListener(signal, shutdown)
  })
}

export async function start(config: Config = loadConfig(), options: StartOptions = {}): Promise<FastifyInstance> {
  const store = await connect(config.databaseUrl)
  const app = buildApp({ webRoot: config.webRoot, repository: store.repository, rateLimits: config.rateLimits })
  app.addHook('onClose', store.close)
  closeOnSignals(app, options.signals ?? process, options.exit ?? ((code) => process.exit(code)))
  try {
    await app.listen({ port: config.port, host: config.host })
  } catch (err) {
    // A port already taken: release the signal listeners and the store before failing.
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
