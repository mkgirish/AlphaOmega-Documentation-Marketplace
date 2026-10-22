// ST-10 — POST /api/registrations: the API applies the same name rules as the screen, so a
// body sent straight to it with a 101-character name is a 400 naming that field and no row.
// The answer carries only the stored createdAt: never the row id or a submitted value.
import type { FastifyInstance } from 'fastify'
import { envelope, errorEnvelope, formatUtcSeconds } from '@app/shared'
import type { RegistrationStore } from '../persistence/repository.js'
import { parseRegistration } from '../registration/rules.js'

export const CHECK_FIELDS = 'Check the highlighted fields.'
export const UNREADABLE = 'The request could not be read.'

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'message'],
            properties: { path: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
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

export function registerRegistrations(app: FastifyInstance, options: { store: RegistrationStore }): void {
  app.post(
    '/api/registrations',
    { schema: { response: { 201: createdSchema, 400: errorSchema, 413: errorSchema, 415: errorSchema, 500: errorSchema } } },
    async (request, reply) => {
      const parsed = parseRegistration(request.body)
      if (!parsed.ok) {
        const body = parsed.fields === undefined ? errorEnvelope(UNREADABLE) : errorEnvelope(CHECK_FIELDS, parsed.fields)
        return reply.code(400).send(body)
      }
      const createdAt = new Date(formatUtcSeconds(Date.now()))
      await options.store.insert({ ...parsed.value, createdAt })
      return reply.code(201).send(envelope({ createdAt: formatUtcSeconds(createdAt) }))
    },
  )
}
