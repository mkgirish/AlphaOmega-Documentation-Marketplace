import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { afterEach } from 'vitest'
import { buildApp } from './main.js'
import type { NewRegistration, RegistrationRepository } from './persistence/repository.js'
import { parseRegistration, type RegistrationField } from './registration-input.js'

// ST-3 AC-1, AC-2 and AC-6: a field that is missing, empty, only spaces or only invisible
// characters is refused with a message under that field alone, and nothing is stored.
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const FIELDS: readonly RegistrationField[] = ['firstName', 'lastName', 'email', 'phone']
const BLANKS = ['', '   ', '\t \n', ' ', '​', ' ⁠ ﻿ ']

class MemoryRepository implements RegistrationRepository {
  readonly rows: NewRegistration[] = []
  async insert(row: NewRegistration): Promise<void> {
    this.rows.push(row)
  }
}

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('blank fields are refused @story:ST-3 @criterion:AC-2', () => {
  it.each(FIELDS.flatMap((field) => BLANKS.map((blank) => [field, blank] as const)))(
    '%s holding %j is refused and only it is named',
    (field, blank) => {
      const result = parseRegistration({ ...VALID, [field]: blank })
      expect(result.ok).toBe(false)
      expect(result.ok ? [] : Object.keys(result.fields)).toEqual([field])
    },
  )

  it.each(FIELDS)('a missing %s is refused and named', (field) => {
    const body: Record<string, string> = { ...VALID }
    delete body[field]
    const result = parseRegistration(body)
    expect(result.ok ? [] : Object.keys(result.fields)).toEqual([field])
  })

  it('names all four fields when all are blank', () => {
    const result = parseRegistration({ firstName: ' ', lastName: '​', email: '', phone: '  ' })
    expect(result.ok ? [] : Object.keys(result.fields)).toEqual(FIELDS)
  })
})

describe('POST /api/registrations with a blank field @story:ST-3 @criterion:AC-6', () => {
  it.each(FIELDS.flatMap((field) => BLANKS.map((blank) => [field, blank] as const)))(
    '%s holding %j answers 400 naming it and stores no row',
    async (field, blank) => {
      const repository = new MemoryRepository()
      app = buildApp({ webRoot: '/nonexistent-web-root', repository })
      const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: { ...VALID, [field]: blank } })
      expect(res.statusCode).toBe(400)
      expect(Object.keys((res.json() as { fields: object }).fields)).toEqual([field])
      expect(repository.rows).toEqual([])
    },
  )

  it('answers the Gherkin request with 400 for "lastName"', async () => {
    const repository = new MemoryRepository()
    app = buildApp({ webRoot: '/nonexistent-web-root', repository })
    const res = await app.inject({
      method: 'POST',
      url: '/api/registrations',
      headers: { 'content-type': 'application/json' },
      payload: '{"firstName":"Jane","lastName":"  ","email":"jane.doe@example.com","phone":"4155550132"}',
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('"lastName"')
    expect(repository.rows).toEqual([])
  })
})
