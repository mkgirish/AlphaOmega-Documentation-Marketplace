// ST-9 — POST /api/registrations: the API applies the same email rule as the screen, so a
// half-typed address sent directly is refused with 400 and stores nothing (AC-5). Answers
// are AD-5 envelopes that carry neither a submitted value nor the row id.
import type { FastifyInstance } from 'fastify'
import { envelope, errorEnvelope, formatUtcSeconds } from '@app/shared'
import type { RegistrationRepository } from '../persistence/repository.js'
import { fieldErrors, registrationBody } from '../registration-rules.js'

export const CHECK_FIELDS = 'Check the highlighted fields.'
const UNREADABLE = 'The request could not be read.'

export function registerRegistrations(app: FastifyInstance, options: { repository: RegistrationRepository }): void {
  app.post('/api/registrations', async (request, reply) => {
    const parsed = registrationBody.safeParse(request.body)
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error)
      return reply.code(400).send(fields.length === 0 ? errorEnvelope(UNREADABLE) : errorEnvelope(CHECK_FIELDS, fields))
    }
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000)
    await options.repository.insert({ ...parsed.data, createdAt })
    return reply.code(201).send(envelope({ createdAt: formatUtcSeconds(createdAt) }))
  })
}
