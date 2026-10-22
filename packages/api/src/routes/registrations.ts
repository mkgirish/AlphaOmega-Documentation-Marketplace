// ST-2 — POST /api/registrations (IF-2), the only data route (AD-5). Gates run cheapest
// first: cross-site 403, rate limit 429, media type 415, body size 413, then validation
// 400 and the insert. Every failure is a fixed problem+json envelope that never carries
// a submitted value, a driver message, the row id or the reqId.
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { formatUtcSeconds, errorEnvelope } from '@app/shared'
import { DEFAULT_RATE_LIMITS, type RateLimits } from '../config.js'
import { logger } from '../observability/index.js'
import { createRateLimiter } from '../plugins/rate-limit.js'
import type { RegistrationStore } from '../persistence/store.js'
import { validateRegistration, type FieldErrors } from '../registration/rules.js'

export const REGISTRATIONS_PATH = '/api/registrations'

/** IF-2 request body limit. */
export const REGISTRATION_BODY_LIMIT = 4 * 1024

export type ProblemCode = 'validation' | 'forbidden' | 'too_large' | 'unsupported_media_type' | 'rate_limited' | 'internal'

const PROBLEM_TYPE = 'application/problem+json; charset=utf-8'

/** The 201 body as IF-2 defines it; serialising through it drops anything else, like the row id. */
export const registrationCreatedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['firstName', 'createdAt'],
  properties: {
    firstName: { type: 'string', description: 'The normalised first name.' },
    createdAt: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$',
      description: 'UTC whole seconds from formatUtcSeconds().',
    },
  },
} as const

export interface RegistrationsOptions {
  readonly store: RegistrationStore
  readonly rateLimits?: RateLimits
  readonly now?: () => number
}

function problem(reply: FastifyReply, status: number, error: ProblemCode, fields?: FieldErrors): FastifyReply {
  return reply
    .code(status)
    .type(PROBLEM_TYPE)
    .send(fields === undefined ? { error } : { error, fields })
}

function isJson(contentType: string | undefined): boolean {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json'
}

/** The request path as the router sees it, so an encoded spelling cannot dodge the 405. */
function pathOf(url: string): string {
  const raw = url.split('?')[0] ?? ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function sqlstate(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unknown'
}

export function registerRegistrations(app: FastifyInstance, options: RegistrationsOptions): void {
  const now = options.now ?? Date.now
  const limiter = createRateLimiter(options.rateLimits ?? DEFAULT_RATE_LIMITS, now)

  // Any other method on the path is 405, not a route (IF-2): it never reaches a handler.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST' || pathOf(request.url) !== REGISTRATIONS_PATH) return
    return reply.code(405).header('allow', 'POST').send(errorEnvelope('Method not allowed.'))
  })

  const gates = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    if (request.headers['sec-fetch-site'] === 'cross-site') return problem(reply, 403, 'forbidden')
    if (!limiter.take(request.ip)) return problem(reply, 429, 'rate_limited')
    if (!isJson(request.headers['content-type'])) return problem(reply, 415, 'unsupported_media_type')
    return undefined
  }

  const parseFailure = (error: FastifyError, _request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    if (error.statusCode === 413) return problem(reply, 413, 'too_large')
    // Any other client error from reading the body (malformed or empty JSON) is a validation failure.
    const status = error.statusCode ?? 500
    if (status >= 400 && status < 500) return problem(reply, 400, 'validation', {})
    logger.error({ event: 'request.failed', code: error.code ?? 'unknown' }, 'request.failed')
    return problem(reply, 500, 'internal')
  }

  app.post(
    REGISTRATIONS_PATH,
    {
      bodyLimit: REGISTRATION_BODY_LIMIT,
      onRequest: gates,
      errorHandler: parseFailure,
      schema: { response: { 201: registrationCreatedSchema } },
    },
    async (request, reply) => {
      const result = validateRegistration(request.body)
      if (!result.ok) return problem(reply, 400, 'validation', result.fields)
      const createdAt = formatUtcSeconds(now())
      try {
        await options.store.insert({ ...result.value, createdAt })
      } catch (err) {
        logger.error({ event: 'db.insert_failed', sqlstate: sqlstate(err) }, 'db.insert_failed')
        return problem(reply, 500, 'internal')
      }
      logger.info({ event: 'registration.created' }, 'registration.created')
      return reply.code(201).send({ firstName: result.value.firstName, createdAt })
    },
  )
}
