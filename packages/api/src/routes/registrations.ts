// ST-8 — POST /api/registrations. The body is checked against the shared field rules and
// the US phone rule before anything touches the database: a failure answers 400 with one
// error per field and stores nothing; a pass stores the trimmed values and the phone's
// ten digits. No response carries a submitted value or the row id.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { envelope, errorEnvelope, formatUtcSeconds, messages, normalise, registrationInput } from '@app/shared'
import type { RegistrationRepository } from '../persistence/repository.js'
import { PHONE_MESSAGE, parseUsPhone } from '../registration/phone.js'

export const VALIDATION_MESSAGE = 'Check the highlighted fields.'

const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  fullName: messages.required('Full name'),
  email: messages.invalidEmail,
  phone: PHONE_MESSAGE,
}

const normalised = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' ? normalise(value) : value), schema)

const body = z
  .object({
    fullName: normalised(registrationInput.shape.fullName),
    email: normalised(registrationInput.shape.email),
    phone: z.string().transform((value, ctx) => {
      const digits = parseUsPhone(value)
      if (digits === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom })
        return z.NEVER
      }
      return digits
    }),
  })
  .strict()

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
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

export function registerRegistrations(app: FastifyInstance, options: { repository: RegistrationRepository }): void {
  app.post('/api/registrations', { schema: { response: { 201: createdSchema, 400: errorSchema } } }, async (request, reply) => {
    if (!isJson(request.headers['content-type'])) {
      throw Object.assign(new Error('Unsupported content type.'), { statusCode: 415 })
    }
    const parsed = body.safeParse(request.body)
    if (!parsed.success) {
      const paths = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))
      if (paths.has('')) {
        // Not an object, or a field the API does not know: refused without detail.
        throw Object.assign(new Error('Unreadable registration.'), { statusCode: 400 })
      }
      const fields = Object.entries(FIELD_MESSAGES)
        .filter(([path]) => paths.has(path))
        .map(([path, message]) => ({ path, message }))
      return reply.code(400).send(errorEnvelope(VALIDATION_MESSAGE, fields))
    }
    const createdAt = new Date(formatUtcSeconds(Date.now()))
    await options.repository.insert({ ...parsed.data, createdAt })
    return reply.code(201).send(envelope({ createdAt: formatUtcSeconds(createdAt) }))
  })
}
