import { fieldMessages } from '@app/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../main.js'
import { logger } from '../observability/index.js'
import type { NewRegistration, RegistrationRepository } from '../persistence/repository.js'
import type { RegistrationField } from '../registration-input.js'

// ST-3 — POST /api/registrations refuses a blank field sent directly: an empty, all-space,
// missing or non-string field answers 400 naming exactly that field with its CMP-2
// required message, stores nothing and echoes none of the other submitted values.
const NO_WEB_ROOT = '/nonexistent-web-root'
const URL = '/api/registrations'
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const FIELDS: readonly RegistrationField[] = ['firstName', 'lastName', 'email', 'phone']
const SENTINELS = {
  firstName: 'SentinelFirst',
  lastName: 'SentinelLast',
  email: 'sentinel.mail@example.com',
  phone: '(212) 867-5309',
}

// Records every insert the route attempts, so an empty rows list means no row was written.
class MemoryRepository implements RegistrationRepository {
  readonly rows: NewRegistration[] = []
  async insert(row: NewRegistration): Promise<void> {
    this.rows.push(row)
  }
}

let app: FastifyInstance | undefined

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT, repository: new MemoryRepository() })
  await warm.inject({ method: 'POST', url: URL, payload: VALID })
  await warm.close()
}, 30_000)

afterEach(async () => {
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

function post(repository: RegistrationRepository, payload: unknown) {
  app = buildApp({ webRoot: NO_WEB_ROOT, repository })
  return app.inject({ method: 'POST', url: URL, payload: payload as Record<string, unknown> })
}

function expectValidation(res: { statusCode: number; headers: Record<string, unknown>; json: () => unknown }, fields: object) {
  expect(res.statusCode).toBe(400)
  expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/)
  expect(res.headers['cache-control']).toBe('no-store')
  expect(res.json()).toEqual({ error: 'validation', fields })
}

describe('a missing field stops the registration @story:ST-3 @criterion:AC-1', () => {
  it.each(FIELDS)('an empty %s answers 400 naming it and stores no row', async (field) => {
    const repository = new MemoryRepository()
    const res = await post(repository, { ...VALID, [field]: '' })
    expectValidation(res, { [field]: [fieldMessages[field].required] })
    expect(repository.rows).toEqual([])
  })

  it.each(FIELDS)('an absent %s answers 400 naming it and stores no row', async (field) => {
    const repository = new MemoryRepository()
    const payload: Record<string, string> = { ...VALID }
    delete payload[field]
    const res = await post(repository, payload)
    expectValidation(res, { [field]: [fieldMessages[field].required] })
    expect(repository.rows).toEqual([])
  })

  it.each(FIELDS)('a null or non-string %s counts as empty', async (field) => {
    for (const blank of [null, 0, false, [], {}]) {
      const repository = new MemoryRepository()
      const res = await post(repository, { ...VALID, [field]: blank })
      expectValidation(res, { [field]: [fieldMessages[field].required] })
      expect(repository.rows).toEqual([])
    }
  })

  it('an empty body names all four fields in form order and stores nothing', async () => {
    const repository = new MemoryRepository()
    const res = await post(repository, {})
    expectValidation(res, {
      firstName: [fieldMessages.firstName.required],
      lastName: [fieldMessages.lastName.required],
      email: [fieldMessages.email.required],
      phone: [fieldMessages.phone.required],
    })
    expect(Object.keys((res.json() as { fields: object }).fields)).toEqual([...FIELDS])
    expect(repository.rows).toEqual([])
  })
})

describe('a field of only spaces counts as empty @story:ST-3 @criterion:AC-2', () => {
  it.each(FIELDS.flatMap((field) => ['   ', ' ', '\t', ' \t\n ', '\u00a0', '\u3000'].map((blank) => [field, blank] as const)))(
    '%s of %j answers 400 naming it and stores no row',
    async (field, blank) => {
      const repository = new MemoryRepository()
      const res = await post(repository, { ...VALID, [field]: blank })
      expectValidation(res, { [field]: [fieldMessages[field].required] })
      expect(repository.rows).toEqual([])
    },
  )
})

describe('the API refuses a blank field sent directly @story:ST-3 @criterion:AC-6', () => {
  it('a last name of two spaces answers 400 with an error for lastName only', async () => {
    const repository = new MemoryRepository()
    const res = await post(repository, { firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expectValidation(res, { lastName: [fieldMessages.lastName.required] })
    expect(repository.rows).toEqual([])
  })

  it('a blank field alongside an invalid one names both, each with its own message', async () => {
    const repository = new MemoryRepository()
    const res = await post(repository, { ...VALID, firstName: ' ', email: 'not-an-email' })
    const body = res.json() as { fields: Record<string, string[]> }
    expect(res.statusCode).toBe(400)
    expect(Object.keys(body.fields).sort()).toEqual(['email', 'firstName'])
    expect(body.fields.firstName).toEqual([fieldMessages.firstName.required])
    expect(body.fields.email).not.toEqual([fieldMessages.email.required])
    expect(repository.rows).toEqual([])
  })

  it.each(FIELDS)('a blank %s echoes no other submitted value in the body, headers or logs', async (field) => {
    const logs: unknown[] = []
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        logs.push([level, ...args])
      }) as never)
    }
    const repository = new MemoryRepository()
    const res = await post(repository, { ...SENTINELS, [field]: '   ' })
    expectValidation(res, { [field]: [fieldMessages[field].required] })
    const seen = [res.body, JSON.stringify(res.headers), JSON.stringify(logs)].join('\n')
    for (const value of [...Object.values(SENTINELS), '2128675309']) expect(seen).not.toContain(value)
    expect(res.body).not.toMatch(/"id"|reqId/i)
    expect(repository.rows).toEqual([])
  })
})
