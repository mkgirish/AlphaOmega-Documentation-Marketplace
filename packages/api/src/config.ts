// Runtime configuration, read from the environment (SQ-7). AC-1 of ST-1: the image must
// start with no environment variable at all, so every value has a working default.
import { fileURLToPath } from 'node:url'

export interface Config {
  readonly port: number
  readonly host: string
  /** The built registration screen (packages/web/dist), served from the same origin. */
  readonly webRoot: string
  /** The registrations database (DATABASE_URL); unset, every registration answers 500. */
  readonly databaseUrl?: string
}

// src/ and dist/ both sit one level under packages/api, so this resolves to
// packages/web/dist under vitest and in the image alike.
const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../../web/dist', import.meta.url))

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: env.PORT ? Number(env.PORT) : 3000,
    host: env.HOST ?? '0.0.0.0',
    webRoot: DEFAULT_WEB_ROOT,
    databaseUrl: env.DATABASE_URL || undefined,
  }
}
