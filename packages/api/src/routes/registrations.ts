// ST-2 — POST /api/registrations (IF-2), the only data route (AD-5). Gates run before the
// body is read: cross-site 403, rate limit 429, non-JSON 415; the 4 KB limit gives 413.
// A valid body is normalised, stamped with formatUtcSeconds() and inserted once; the 201
// carries only firstName and createdAt. Every failure is a fixed AD-5 problem envelope
// that never echoes a submitted value, a driver message or the row id.
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { errorEnvelope, formatUtcSeconds } from '@app/shared'
import type { RateLimits } from '../config.js'
import { logger } from '../observability/index.js'
import type { RegistrationRepository } from '../persistence/repository.js'
import { createRateLimiter } from '../plugins/rate-limit.js'
import { parseRegistration, type RegistrationParse } from '../registration-input.js'

export const REGISTRATIONS_PATH = '/api/registrations'
export const REGISTRATION_BODY_LIMIT = 4 * 1024

type ProblemCode = 'validation' | 'forbidden' | 'too_large' | 'unsupported_media_type' | 'rate_limited' | 'internal'

export interface RegistrationRouteOptions {
  /** null when no store is attached: every valid POST then answers 500. */
  readonly repository: RegistrationRepository | null
  readonly rateLimits: RateLimits
  readonly now: () => Date
}

const createdSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['firstName', 'createdAt'],
  properties: { firstName: { type: 'string' }, createdAt: { type: 'string' } },
} as const

function problem(
  reply: FastifyReply,
  status: number,
  error: ProblemCode,
  fields?: Extract<RegistrationParse, { ok: false }>['fields'],
): FastifyReply {
  return reply
    .code(status)
    .type('application/problem+json; charset=utf-8')
    .send(fields === undefined ? { error } : { error, fields })
}

function mediaType(request: FastifyRequest): string {
  return (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

// Failures raised before the handler (body parsing, the size limit) land here; the
// Content-Type gate has already answered 415 in onRequest.
function routeErrors(error: FastifyError, _request: FastifyRequest, reply: FastifyReply): FastifyReply {
  switch (error.statusCode) {
    case 400:
      return problem(reply, 400, 'validation', {})
    case 413:
      return problem(reply, 413, 'too_large')
    default:
      logger.error({ code: error.code ?? 'unknown' }, 'request.failed')
      return problem(reply, 500, 'internal')
  }
}

export function registerRegistrations(app: FastifyInstance, options: RegistrationRouteOptions): void {
  const limiter = createRateLimiter(options.rateLimits, options.now)

  app.post(REGISTRATIONS_PATH, {
    bodyLimit: REGISTRATION_BODY_LIMIT,
    schema: { response: { 201: createdSchema } },
    errorHandler: routeErrors,
    onRequest: async (request, reply) => {
      if (request.headers['sec-fetch-site'] === 'cross-site') return problem(reply, 403, 'forbidden')
      if (!limiter.take(request.ip)) return problem(reply, 429, 'rate_limited')
      if (mediaType(request) !== 'application/json') return problem(reply, 415, 'unsupported_media_type')
    },
    handler: async (request, reply) => {
      const parsed = parseRegistration(request.body)
      if (!parsed.ok) return problem(reply, 400, 'validation', parsed.fields)
      if (options.repository === null) {
        logger.error('db.insert_failed')
        return problem(reply, 500, 'internal')
      }
      const createdAt = formatUtcSeconds(options.now())
      try {
        await options.repository.insert({ ...parsed.value, createdAt })
      } catch (err) {
        logger.error({ sqlstate: (err as { code?: unknown }).code ?? 'unknown' }, 'db.insert_failed')
        return problem(reply, 500, 'internal')
      }
      logger.info('registration.created')
      return reply.code(201).send({ firstName: parsed.value.firstName, createdAt })
    },
  })

  // Any other method is refused here rather than by the not-found handler (AD-5).
  app.route({
    // HEAD is answered through GET.
    method: app.supportedMethods.filter((method) => method !== 'POST' && method !== 'HEAD'),
    url: REGISTRATIONS_PATH,
    handler: async (_request, reply) =>
      reply.code(405).header('allow', 'POST').send(errorEnvelope('This address only accepts new registrations.')),
  })
}
