// ST-9 — POST /api/registrations. The body is checked against CMP-2's shared registration
// rules (AD-2, AD-3), so the screen and the API reject the same emails with the same
// messages; a rejected body stores nothing, and no response echoes a submitted value.
import type { FastifyInstance } from 'fastify'
import { envelope, errorEnvelope, formatUtcSeconds, normalise, registrationInput } from '@app/shared'
import { uuidV7 } from '../persistence/ids.js'
import type { RegistrationRepository } from '../persistence/repository.js'
import { UNREADABLE_REQUEST, UNSUPPORTED_TYPE } from '../plugins/security.js'

const INVALID_REGISTRATION = 'Check the highlighted fields.'
const JSON_MEDIA_TYPE = /^application\/json\s*(;|$)/i

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

/** Applies the shared normalise() to every string field, so stored values are trimmed. */
function normalised(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === 'string' ? normalise(value) : value]))
}

export function registerRegistrations(app: FastifyInstance, options: { repository: RegistrationRepository }): void {
  app.post(
    '/api/registrations',
    {
      schema: {
        operationId: 'createRegistration',
        summary: 'Record a visitor registration, validated against the shared registration rules.',
        response: { 201: createdSchema, 400: errorSchema, 413: errorSchema, 415: errorSchema, 500: errorSchema },
      },
    },
    async (request, reply) => {
      // Fastify also parses text/plain; this route takes JSON only.
      if (!JSON_MEDIA_TYPE.test(String(request.headers['content-type']))) {
        return reply.code(415).send(errorEnvelope(UNSUPPORTED_TYPE))
      }
      const body = request.body
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return reply.code(400).send(errorEnvelope(UNREADABLE_REQUEST))
      }
      const parsed = registrationInput.safeParse(normalised(body as Record<string, unknown>))
      if (!parsed.success) {
        // One message per field: the first rule the value breaks.
        const fields = new Map<string, string>()
        for (const issue of parsed.error.issues) {
          const path = issue.path.join('.')
          if (!fields.has(path)) fields.set(path, issue.message)
        }
        const list = [...fields].map(([path, message]) => ({ path, message }))
        return reply.code(400).send(errorEnvelope(INVALID_REGISTRATION, list))
      }
      const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000)
      await options.repository.insert({ ...parsed.data, id: uuidV7(), createdAt })
      return reply.code(201).send(envelope({ createdAt: formatUtcSeconds(createdAt) }))
    },
  )
}
