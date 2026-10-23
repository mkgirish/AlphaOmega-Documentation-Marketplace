import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../main.js'
import { logger } from '../observability/index.js'
import type { NewRegistration, RegistrationRepository } from '../persistence/repository.js'
import { parseRegistration, type RegistrationField } from '../registration-input.js'

// ST-3 AC-6 — a JSON body sent straight to POST /api/registrations with any field blank,
// only spaces or missing answers 400 naming that field with the message the screen shows
// under it (AC-3), and no row is stored. The response never echoes what was typed.
const URL = '/api/registrations'
const NO_WEB_ROOT = '/nonexistent-web-root'
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

const REQUIRED: Record<RegistrationField, string> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
}
const FIELDS = Object.keys(REQUIRED) as RegistrationField[]
const EVERY_FIELD_REQUIRED = Object.fromEntries(FIELDS.map((field) => [field, [REQUIRED[field]]]))

// Empty, ASCII spaces, tabs and line breaks, and the Unicode spaces String.prototype.trim removes.
const BLANKS: [string, string][] = [
  ['empty', ''],
  ['only spaces', '   '],
  ['a tab and a newline', '\t\n'],
  ['a no-break space', '\u00a0'],
  ['an ideographic space', '\u3000'],
]

class MemoryRepository implements RegistrationRepository {
  readonly rows: NewRegistration[] = []
  async insert(row: NewRegistration): Promise<void> {
    this.rows.push(row)
  }
}

let app: FastifyInstance | undefined

beforeAll(async () => {
  const warm = buildApp({ webRoot: NO_WEB_ROOT, repository: new MemoryRepository() })
  await warm.inject({ method: 'POST', url: URL, payload: VALID })
  await warm.close()
}, 30_000)

afterEach(async () => {
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

function appWith(repository: RegistrationRepository): FastifyInstance {
  app = buildApp({ webRoot: NO_WEB_ROOT, repository })
  return app
}

function post(target: FastifyInstance, payload: object) {
  return target.inject({ method: 'POST', url: URL, payload: payload as Record<string, unknown> })
}

describe('the API refuses a blank field sent directly @story:ST-3 @criterion:AC-6', () => {
  it('answers 400 for the Gherkin body with an error for lastName only, and stores no row', async () => {
    const repository = new MemoryRepository()
    const res = await post(appWith(repository), {
      firstName: 'Jane',
      lastName: '  ',
      email: 'jane.doe@example.com',
      phone: '4155550132',
    })
    expect(res.statusCode).toBe(400)
    expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.json()).toEqual({ error: 'validation', fields: { lastName: [REQUIRED.lastName] } })
    expect(repository.rows).toHaveLength(0)
  })

  for (const field of FIELDS) {
    it.each(BLANKS)(`${field} %s is named with its own message and stores no row`, async (_name, blank) => {
      const repository = new MemoryRepository()
      const res = await post(appWith(repository), { ...VALID, [field]: blank })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'validation', fields: { [field]: [REQUIRED[field]] } })
      expect(repository.rows).toHaveLength(0)
    })

    it(`${field} left out of the body is named with its own message and stores no row`, async () => {
      const repository = new MemoryRepository()
      const { [field]: _omitted, ...rest } = VALID
      const res = await post(appWith(repository), rest)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'validation', fields: { [field]: [REQUIRED[field]] } })
      expect(repository.rows).toHaveLength(0)
    })
  }

  it('names every blank field at once, each with its own message, and stores no row', async () => {
    const repository = new MemoryRepository()
    const res = await post(appWith(repository), { firstName: '', lastName: '   ', email: '\t', phone: '\u00a0' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: EVERY_FIELD_REQUIRED })
    expect(repository.rows).toHaveLength(0)
  })

  it('keeps the row count unchanged across a valid save and then a blank one', async () => {
    const repository = new MemoryRepository()
    const target = appWith(repository)
    expect((await post(target, VALID)).statusCode).toBe(201)
    expect(repository.rows).toHaveLength(1)
    const res = await post(target, { ...VALID, firstName: '    ' })
    expect(res.json()).toEqual({ error: 'validation', fields: { firstName: [REQUIRED.firstName] } })
    expect(repository.rows).toHaveLength(1)
  })

  it('reports a blank field without echoing the values of the others or logging them', async () => {
    const logged: unknown[] = []
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => logged.push(args)) as never)
    }
    const sentinels = { firstName: 'SentinelFirst', lastName: '   ', email: 'sentinel.mail@example.com', phone: '(212) 867-5309' }
    const res = await post(appWith(new MemoryRepository()), sentinels)
    expect(res.json()).toEqual({ error: 'validation', fields: { lastName: [REQUIRED.lastName] } })
    for (const value of ['SentinelFirst', 'sentinel.mail@example.com', '(212) 867-5309', '2128675309']) {
      expect(res.body).not.toContain(value)
      expect(JSON.stringify(logged)).not.toContain(value)
    }
  })
})

describe('the blank-field messages are the ones the screen shows @story:ST-3 @criterion:AC-3', () => {
  it.each(FIELDS)('parseRegistration names a blank %s with its AC-3 message', (field) => {
    expect(parseRegistration({ ...VALID, [field]: '   ' })).toEqual({ ok: false, fields: { [field]: [REQUIRED[field]] } })
  })

  it('a field holding a value that is not a string is treated as empty', () => {
    expect(parseRegistration({ firstName: null, lastName: 7, email: false, phone: ['4155550132'] })).toEqual({
      ok: false,
      fields: EVERY_FIELD_REQUIRED,
    })
  })

  it('openapi.json documents the blank-field 400 exactly as the route answers it', async () => {
    const openapi = JSON.parse(readFileSync(new globalThis.URL('../../openapi.json', import.meta.url), 'utf8')) as {
      paths: Record<
        string,
        { post: { responses: Record<string, { content: Record<string, { examples: Record<string, { value: unknown }> }> }> } }
      >
    }
    const example = openapi.paths[URL]?.post.responses['400']?.content['application/problem+json']?.examples['blank']?.value
    expect(example).toEqual({ error: 'validation', fields: { lastName: [REQUIRED.lastName] } })
    const res = await post(appWith(new MemoryRepository()), { ...VALID, lastName: '  ' })
    expect(res.json()).toEqual(example)
  })
})
