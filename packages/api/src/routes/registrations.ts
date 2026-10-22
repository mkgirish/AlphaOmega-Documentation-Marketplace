// ST-11 — POST /api/registrations refuses whatever the screen would never send, before any
// row is written: cross-site requests (403), anything but JSON (415), bodies over 4 KB (413),
// malformed JSON or unknown fields (400, no field named) and invalid fields (400, every one
// named). Each refusal logs one registration.rejected naming only fields and rules.
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from '../observability/index.js'
import type { RegistrationStore } from '../persistence/repository.js'
import { judgeRegistration, validationEnvelope, type Failure } from '../registrations/rules.js'

export const REGISTRATION_BODY_LIMIT = 4 * 1024

type Reason = 'cross_site' | 'content_type' | 'too_large' | 'malformed' | 'unknown_field' | 'validation'

// The screen is served from this origin, so a browser sends same-origin (or none when a
// person acts directly); a missing header is a client that is not a browser.
const OWN_SITES = new Set(['', 'same-origin', 'none'])

class GateRefusal extends Error {
  constructor(
    readonly statusCode: 403 | 405 | 415,
    readonly reason?: Reason,
  ) {
    super('refused')
  }
}

class Refusal extends Error {
  constructor(
    readonly reason: 'malformed' | 'unknown_field' | 'validation',
    readonly failures: readonly Failure[] = [],
  ) {
    super(reason)
  }
}

/** True for application/json, in any case, with at most a utf-8 charset parameter. */
export function isJson(contentType: string | undefined): boolean {
  const [type, ...params] = (contentType ?? '').split(';').map((part) => part.trim().toLowerCase())
  return type === 'application/json' && params.every((param) => param === 'charset=utf-8')
}

export interface RegistrationRouteOptions {
  readonly store: RegistrationStore
  readonly logger: Logger
}

export function registerRegistrations(app: FastifyInstance, { store, logger }: RegistrationRouteOptions): void {
  function rejected(request: FastifyRequest, reason: Reason, failures: readonly Failure[] = []): void {
    const fields = failures.map(({ field, rule }) => ({ field, rule }))
    logger.info({ reqId: request.id, reason, fields }, 'registration.rejected')
  }

  async function gate(request: FastifyRequest): Promise<void> {
    if (!OWN_SITES.has(String(request.headers['sec-fetch-site'] ?? '').toLowerCase())) {
      throw new GateRefusal(403, 'cross_site')
    }
    if (!isJson(request.headers['content-type'])) throw new GateRefusal(415, 'content_type')
  }

  function refuse(error: FastifyError | Refusal, request: FastifyRequest, reply: FastifyReply): FastifyReply {
    if (error instanceof Refusal) {
      rejected(request, error.reason, error.failures)
      return reply.code(400).send(validationEnvelope(error.failures))
    }
    if (error instanceof GateRefusal) {
      if (error.reason !== undefined) rejected(request, error.reason)
    } else if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      rejected(request, 'too_large')
    } else if (error.code?.startsWith('FST_ERR_CTP_') && error.statusCode === 400) {
      rejected(request, 'malformed')
      return reply.code(400).send(validationEnvelope([]))
    }
    // Every other envelope, 500 included, is the shared one from plugins/security.
    throw error
  }

  app.post('/api/registrations', { bodyLimit: REGISTRATION_BODY_LIMIT, onRequest: gate, errorHandler: refuse }, async (request, reply) => {
    const verdict = judgeRegistration(request.body)
    if (!verdict.ok) throw new Refusal(verdict.reason, verdict.reason === 'validation' ? verdict.failures : [])
    // Whatever the store throws is a 500 carrying only its code, never a client status.
    await store.insert(verdict.value).catch((cause: { code?: string }) => {
      throw Object.assign(new Error('save failed'), { code: cause?.code })
    })
    return reply.code(201).send({ ok: true })
  })

  // The write-only surface: nothing can be read, changed or removed here.
  app.route({
    method: ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/api/registrations',
    handler: async (_request, reply) => {
      reply.header('allow', 'POST')
      throw new GateRefusal(405)
    },
  })
}
