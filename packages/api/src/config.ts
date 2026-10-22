// Runtime configuration, read from the environment (SQ-7). AC-1 of ST-1: the image must
// start with no environment variable at all, so every value has a working default.
import { fileURLToPath } from 'node:url'

export interface RateLimits {
  readonly perIpPerMin: number
  readonly globalPerMin: number
}

export interface Config {
  readonly port: number
  readonly host: string
  /** The built registration screen (packages/web/dist), served from the same origin. */
  readonly webRoot: string
  /** Where registrations are stored; without it every POST answers 500 (ST-2). */
  readonly databaseUrl?: string
  readonly rateLimits?: RateLimits
}

export const DEFAULT_RATE_LIMITS: RateLimits = { perIpPerMin: 30, globalPerMin: 300 }

// src/ and dist/ both sit one level under packages/api, so this resolves to
// packages/web/dist under vitest and in the image alike.
const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../../web/dist', import.meta.url))

// The error names the variable, never the value it held.
function positiveWholeNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined) return fallback
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive whole number.`)
  return Number(raw)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: env.PORT ? Number(env.PORT) : 3000,
    host: env.HOST ?? '0.0.0.0',
    webRoot: DEFAULT_WEB_ROOT,
    databaseUrl: env.DATABASE_URL || undefined,
    rateLimits: {
      perIpPerMin: positiveWholeNumber(env, 'RATE_LIMIT_PER_IP_PER_MIN', DEFAULT_RATE_LIMITS.perIpPerMin),
      globalPerMin: positiveWholeNumber(env, 'RATE_LIMIT_GLOBAL_PER_MIN', DEFAULT_RATE_LIMITS.globalPerMin),
    },
  }
}
