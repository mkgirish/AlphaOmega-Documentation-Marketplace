// ST-11 — POST /api/registrations keeps bad data out whatever sends it: a cross-site
// request (403), a body that is not JSON (415) or over 4 KB (413), and malformed JSON, an
// unexpected field or an invalid value (400) are refused before anything is stored. Each
// refusal logs one registration.rejected naming only fields and rules, never a value.
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify'
import type { Logger } from 'pino'
import { errorEnvelope, formatUtcSeconds } from '@app/shared'
import type { RegistrationStore } from '../persistence/registrations.js'
import { clientErrorEnvelope, errorEnvelopeSchema, sendError, validationEnvelope, validationEnvelopeSchema } from '../plugins/security.js'
import { validateRegistration, type Field } from './registration-rules.js'

/** The form's four fields fit easily; anything larger is refused with 413 unread. */
export const REGISTRATION_BODY_LIMIT = 4 * 1024

// The screen is served from this origin; browsers mark a direct visit "none".
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none'])

export interface RegistrationRouteOptions {
  readonly store?: RegistrationStore
  readonly logger: Logger
  readonly now: () => Date
}

type Rejection = { field: Field; rule: string } | { rule: string }

const createdSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      additionalProperties: false,
      required: ['createdAt'],
      properties: { createdAt: { type: 'string' } },
    },
  },
} as const

function isJson(contentType: string | undefined): boolean {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json'
}

export function registerRegistrations(app: FastifyInstance, options: RegistrationRouteOptions): void {
  const { logger } = options

  function reject(reply: FastifyReply, status: number, failures: Rejection[], body: unknown): FastifyReply {
    logger.info({ event: 'registration.rejected', status, failures }, 'registration.rejected')
    return reply.code(status).send(body)
  }

  void app.register(async (scope) => {
    scope.setErrorHandler(async (error: FastifyError, _request, reply) => {
      // Only the body parser fails before the handler: unreadable JSON or an oversized body.
      if (error.statusCode === 400) return reject(reply, 400, [{ rule: 'malformed_json' }], validationEnvelope({}))
      if (error.statusCode === 413) return reject(reply, 413, [{ rule: 'body_size' }], clientErrorEnvelope(413))
      return sendError(error, reply, logger)
    })

    scope.post(
      '/api/registrations',
      {
        bodyLimit: REGISTRATION_BODY_LIMIT,
        schema: {
          response: {
            201: createdSchema,
            400: validationEnvelopeSchema,
            403: errorEnvelopeSchema,
            413: errorEnvelopeSchema,
            415: errorEnvelopeSchema,
            500: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
        // Runs before the body is read, so refused requests are never parsed.
        onRequest: async (request, reply) => {
          const site = request.headers['sec-fetch-site']
          if (site !== undefined && !ALLOWED_FETCH_SITES.has(site.toLowerCase())) {
            return reject(reply, 403, [{ rule: 'cross_site' }], clientErrorEnvelope(403))
          }
          if (!isJson(request.headers['content-type'])) {
            return reject(reply, 415, [{ rule: 'content_type' }], clientErrorEnvelope(415))
          }
        },
      },
      async (request, reply) => {
        const result = validateRegistration(request.body)
        if (!result.ok) {
          const fields: Partial<Record<Field, string[]>> = {}
          for (const failure of result.failures) {
            if (failure.field !== null) (fields[failure.field] ??= []).push(failure.message)
          }
          const failures = result.failures.map(({ field, rule }) => (field === null ? { rule } : { field, rule }))
          return reject(reply, 400, failures, validationEnvelope(fields))
        }
        if (options.store === undefined) {
          return reply.code(503).send(errorEnvelope('Registrations cannot be saved right now.'))
        }
        const createdAt = new Date(Math.floor(options.now().getTime() / 1000) * 1000)
        await options.store.save({ ...result.value, createdAt })
        return reply.code(201).send({ data: { createdAt: formatUtcSeconds(createdAt) } })
      },
    )
  })
}
