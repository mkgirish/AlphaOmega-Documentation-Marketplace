// ST-8 — POST /api/registrations. The API applies the same rules as the screen, so a
// body sent directly cannot store a phone the screen would refuse (AC-8). Error bodies
// name failing fields only; they never echo a submitted value, and the row id is never
// returned.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { envelope, errorEnvelope, formatUtcSeconds, messages, normalise, registrationInput } from '@app/shared'
import type { RegistrationRepository } from '../persistence/registrations.js'
import { normalisePhone, PHONE_MESSAGE } from '../rules/phone.js'

const INVALID = 'Check the highlighted fields.'

const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  fullName: messages.required('Full name'),
  email: messages.invalidEmail,
  phone: PHONE_MESSAGE,
}

const text = (value: unknown): unknown => (typeof value === 'string' ? normalise(value) : value)

const registrationBody = z
  .object({
    fullName: z.preprocess(text, registrationInput.shape.fullName),
    email: z.preprocess(text, registrationInput.shape.email),
    phone: z.string().transform((value, ctx) => {
      const phone = normalisePhone(value)
      if (phone === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_MESSAGE })
        return z.NEVER
      }
      return phone
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

export function registerRegistrations(app: FastifyInstance, options: { registrations: RegistrationRepository }): void {
  app.post(
    '/api/registrations',
    {
      schema: { response: { 201: createdSchema, 400: errorSchema, 413: errorSchema, 415: errorSchema, 500: errorSchema } },
    },
    async (request, reply) => {
      const parsed = registrationBody.safeParse(request.body)
      if (!parsed.success) {
        const paths = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))
        const fields = Object.keys(FIELD_MESSAGES)
          .filter((path) => paths.has(path))
          .map((path) => ({ path, message: FIELD_MESSAGES[path] ?? INVALID }))
        return reply.code(400).send(errorEnvelope(INVALID, fields.length > 0 ? fields : undefined))
      }
      const createdAt = new Date(formatUtcSeconds(Date.now()))
      await options.registrations.insert({ ...parsed.data, createdAt })
      return reply.code(201).send(envelope({ createdAt: formatUtcSeconds(createdAt) }))
    },
  )
}
