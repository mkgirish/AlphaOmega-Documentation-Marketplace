// ST-3 — POST /api/registrations refuses a blank or spaces-only field with a 400 naming
// each one (AC-6), before anything reaches the repository, so no row is written. Values
// are normalised with CMP-2's normalise() so the screen and the API agree on "empty".
import type { FastifyInstance } from 'fastify'
import { envelope, errorEnvelope, formatUtcSeconds, normalise } from '@app/shared'
import type { RegistrationRecord, RegistrationRepository } from '../persistence/repository.js'

type Field = keyof RegistrationRecord

/** The four fields in form order, each with the message shown when it is left empty. */
export const REQUIRED_MESSAGES: Readonly<Record<Field, string>> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
}

const FIELDS = Object.keys(REQUIRED_MESSAGES) as Field[]

const UNREADABLE = 'The request could not be read.'

export function attentionSummary(count: number): string {
  return `${count} ${count === 1 ? 'field needs' : 'fields need'} attention. Check the messages below.`
}

type FieldError = { path: Field; message: string }
type Checked = { kind: 'unreadable' } | { kind: 'blank'; errors: FieldError[] } | { kind: 'ok'; record: RegistrationRecord }

/** Classifies a parsed JSON body without ever copying a submitted value into an error. */
export function checkRegistration(body: unknown): Checked {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { kind: 'unreadable' }
  const input = body as Record<string, unknown>
  if (Object.keys(input).some((key) => !FIELDS.includes(key as Field))) return { kind: 'unreadable' }
  const values: Partial<Record<Field, string>> = {}
  const errors: FieldError[] = []
  for (const field of FIELDS) {
    const raw = input[field]
    const value = typeof raw === 'string' ? normalise(raw) : ''
    if (value === '') errors.push({ path: field, message: REQUIRED_MESSAGES[field] })
    else values[field] = value
  }
  return errors.length > 0 ? { kind: 'blank', errors } : { kind: 'ok', record: values as RegistrationRecord }
}

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

function isJson(contentType: string | undefined): boolean {
  return /^application\/json\s*(;|$)/i.test(contentType ?? '')
}

export function registerRegistrations(app: FastifyInstance, options: { repository: RegistrationRepository }): void {
  app.post(
    '/api/registrations',
    {
      schema: { response: { 201: createdSchema, 400: errorSchema, 413: errorSchema, 415: errorSchema, 500: errorSchema } },
      // Fastify parses text/plain by default; only JSON reaches this handler.
      onRequest: async (request) => {
        if (!isJson(request.headers['content-type'])) {
          throw Object.assign(new Error('Unsupported content type.'), { statusCode: 415 })
        }
      },
    },
    async (request, reply) => {
      const checked = checkRegistration(request.body)
      if (checked.kind === 'unreadable') {
        return reply.code(400).send(errorEnvelope(UNREADABLE))
      }
      if (checked.kind === 'blank') {
        return reply.code(400).send(errorEnvelope(attentionSummary(checked.errors.length), checked.errors))
      }
      try {
        await options.repository.insert(checked.record)
      } catch (error) {
        // A storage failure is always a 500, whatever status the error object claims.
        const code = (error as { code?: unknown }).code
        throw Object.assign(new Error('The registration could not be stored.'), { code: typeof code === 'string' ? code : 'unknown' })
      }
      return reply.code(201).send(envelope({ createdAt: formatUtcSeconds(new Date()) }))
    },
  )
}
