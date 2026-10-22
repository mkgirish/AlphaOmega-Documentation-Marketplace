// ST-10 — POST /api/registrations, the only write the API offers. The body is checked by
// the registration rules before anything touches the database; a 400 names each failing
// field with a fixed message and never echoes a submitted value, and a 201 carries only
// the whole-second UTC time it was recorded — no row id, no submitted value.
import type { FastifyInstance } from 'fastify'
import { envelope, errorEnvelope, formatUtcSeconds } from '@app/shared'
import type { RegistrationRepository } from '../persistence/registrations.js'
import { validateRegistration } from '../registration/rules.js'

export const INVALID_REGISTRATION = 'Check the highlighted fields and try again.'
export const METHOD_NOT_ALLOWED = 'Method not allowed.'

const fieldErrorsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'message'],
    properties: { path: { type: 'string' }, message: { type: 'string' } },
  },
} as const

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: { message: { type: 'string' }, fields: fieldErrorsSchema },
    },
  },
} as const

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

class DatabaseUnavailable extends Error {
  readonly code = 'db_unavailable'
}

export function registerRegistrations(app: FastifyInstance, options: { repository?: RegistrationRepository }): void {
  // JSON only: drop Fastify's default text/plain parser here so any other body is a 415.
  void app.register(async (scope) => {
    scope.removeContentTypeParser('text/plain')
    registerCreate(scope, options.repository)
  })

  // Registrations are write-only: no read, list, update or delete exists to route to.
  app.route({
    method: ['GET', 'PUT', 'PATCH', 'DELETE'],
    url: '/api/registrations',
    exposeHeadRoute: false,
    handler: async (_request, reply) => reply.code(405).header('allow', 'POST').send(errorEnvelope(METHOD_NOT_ALLOWED)),
  })
}

function registerCreate(app: FastifyInstance, repository: RegistrationRepository | undefined): void {
  app.post(
    '/api/registrations',
    { schema: { response: { 201: createdSchema, 400: errorSchema, 413: errorSchema, 415: errorSchema, 500: errorSchema } } },
    async (request, reply) => {
      const result = validateRegistration(request.body)
      if (!result.ok) {
        return reply.code(400).send(errorEnvelope(INVALID_REGISTRATION, result.fields))
      }
      if (repository === undefined) {
        throw new DatabaseUnavailable('no database configured')
      }
      const now = new Date()
      await repository.insert(result.value, now)
      return reply.code(201).send(envelope({ createdAt: formatUtcSeconds(now) }))
    },
  )
}
