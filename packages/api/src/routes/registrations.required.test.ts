import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../main.js'
import { logger } from '../observability/index.js'
import type { NewRegistration, RegistrationRepository } from '../persistence/repository.js'

// ST-3 — POST /api/registrations refuses a blank field even when the screen is bypassed:
// empty, only whitespace, missing or null all answer 400 naming that field with the same
// message the screen shows under it, and nothing reaches the repository. The real
// PostgreSQL row count is proven in persistence/required.integration.test.ts.
const PATH = '/api/registrations'
const NO_WEB_ROOT = '/nonexistent-web-root'
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

type Field = keyof typeof VALID
const FIELDS: readonly Field[] = ['firstName', 'lastName', 'email', 'phone']

// The AC-3 copy, one message per empty field.
const REQUIRED: Record<Field, string> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
}

const SENTINELS: Record<Field, string> = {
  firstName: 'SentinelFirst',
  lastName: 'SentinelLast',
  email: 'sentinel.mail@example.com',
  phone: '(212) 867-5309',
}

type Schema = { $ref?: string; allOf?: Schema[]; properties?: Record<string, Schema> }
const openapi = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Schema }> }> }>>
}

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
  await warm.inject({ method: 'POST', url: PATH, payload: VALID })
  await warm.close()
}, 30_000)

afterEach(async () => {
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

function post(repository: RegistrationRepository, payload: unknown) {
  app = buildApp({ webRoot: NO_WEB_ROOT, repository })
  return app.inject({ method: 'POST', url: PATH, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) })
}

function expectValidation(res: { statusCode: number; headers: Record<string, unknown> }): void {
  expect(res.statusCode).toBe(400)
  expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/)
  expect(res.headers['cache-control']).toBe('no-store')
}

const blanks: [string, unknown][] = [
  ['empty', ''],
  ['three spaces', '   '],
  ['tabs and newlines', '\t\n \r\n'],
  ['a no-break space', '\u00a0'],
]

describe('a missing field stops the registration @story:ST-3 @criterion:AC-1', () => {
  it.each(FIELDS)('an empty %s answers 400 naming only that field and stores no row', async (field) => {
    const repository = new MemoryRepository()
    const res = await post(repository, { ...VALID, [field]: '' })
    expectValidation(res)
    expect(res.json()).toEqual({ error: 'validation', fields: { [field]: [REQUIRED[field]] } })
    expect(repository.rows).toEqual([])
  })

  it.each(FIELDS)('an absent or null %s is refused the same way', async (field) => {
    for (const payload of [{ ...VALID, [field]: null }, Object.fromEntries(FIELDS.filter((f) => f !== field).map((f) => [f, VALID[f]]))]) {
      const repository = new MemoryRepository()
      const res = await post(repository, payload)
      expectValidation(res)
      expect(res.json()).toEqual({ error: 'validation', fields: { [field]: [REQUIRED[field]] } })
      expect(repository.rows).toEqual([])
    }
  })
})

describe('a field of only spaces counts as empty @story:ST-3 @criterion:AC-2', () => {
  it.each(FIELDS.flatMap((field) => blanks.map(([name, value]) => [field, name, value] as const)))(
    '%s holding %s is refused as empty and stores no row',
    async (field, _name, value) => {
      const repository = new MemoryRepository()
      const res = await post(repository, { ...VALID, [field]: value })
      expectValidation(res)
      expect(res.json()).toEqual({ error: 'validation', fields: { [field]: [REQUIRED[field]] } })
      expect(repository.rows).toEqual([])
    },
  )
})

describe('each empty field says what it needs @story:ST-3 @criterion:AC-3', () => {
  it('an empty form lists all four messages, one under each field, in form order', async () => {
    const repository = new MemoryRepository()
    const res = await post(repository, { firstName: '', lastName: '', email: '', phone: '' })
    expectValidation(res)
    expect(res.json()).toEqual({
      error: 'validation',
      fields: Object.fromEntries(Object.entries(REQUIRED).map(([field, message]) => [field, [message]])),
    })
    expect(Object.keys((res.json() as { fields: object }).fields)).toEqual(FIELDS)
    expect(repository.rows).toEqual([])
  })

  it('a blank field alongside an invalid one keeps each its own message', async () => {
    const res = await post(new MemoryRepository(), { ...VALID, firstName: '  ', phone: '+14155550132' })
    expectValidation(res)
    expect(res.json()).toEqual({ error: 'validation', fields: { firstName: [REQUIRED.firstName], phone: [REQUIRED.phone] } })
  })
})

describe('what was typed is never echoed back @story:ST-3 @criterion:AC-5', () => {
  it.each(FIELDS)('a blank %s answers without any of the other submitted values in body, headers or logs', async (field) => {
    const logs: unknown[] = []
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => void logs.push(args)) as never)
    }
    const res = await post(new MemoryRepository(), { ...SENTINELS, [field]: '   ' })
    expect(res.json()).toEqual({ error: 'validation', fields: { [field]: [REQUIRED[field]] } })
    for (const value of [...Object.values(SENTINELS), '2128675309']) {
      expect(res.body).not.toContain(value)
      expect(JSON.stringify(res.headers)).not.toContain(value)
      expect(JSON.stringify(logs)).not.toContain(value)
    }
  })
})

describe('the API refuses a blank field sent directly @story:ST-3 @criterion:AC-6', () => {
  it('the Gherkin body with lastName "  " answers 400 with an error for lastName and inserts nothing', async () => {
    const insert = vi.fn(async () => undefined)
    const res = await post({ insert }, { firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expectValidation(res)
    expect(res.json()).toEqual({ error: 'validation', fields: { lastName: [REQUIRED.lastName] } })
    expect(insert).not.toHaveBeenCalled()
  })

  it('the 400 for a blank field is the documented ValidationProblem, with a fields key the contract allows', async () => {
    const documented = openapi.paths[PATH]?.post?.responses['400']?.content?.['application/problem+json']?.schema
    expect(documented?.$ref).toBe('#/components/schemas/ValidationProblem')
    for (const field of FIELDS) {
      const res = await post(new MemoryRepository(), { ...VALID, [field]: ' ' })
      expectValidation(res)
      const body = res.json() as { error: string; fields: Record<string, string[]> }
      expect(Object.keys(body).sort()).toEqual(['error', 'fields'])
      expect(body.error).toBe('validation')
      expect(body.fields).toEqual({ [field]: [REQUIRED[field]] })
      expect(res.body).not.toMatch(/"id"|reqId/)
    }
  })
})
