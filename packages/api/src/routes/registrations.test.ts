import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import type { NewRegistration, RegistrationRepository } from '../persistence/registrations.js'
import { PHONE_MESSAGE } from '../rules/phone.js'

// ST-8 AC-1, AC-2, AC-3 and AC-8 at the API: POST /api/registrations applies the phone
// rule itself, answers 400 with an error for phone and stores nothing when it fails.
// The repository here is an in-memory port double; the real-database proof lives in
// persistence/registrations.test.ts.
const NO_WEB_ROOT = '/nonexistent-web-root'
const SENTINEL = 'SENTINEL-c41e'
const VALID = { fullName: 'Ada Lovelace', email: 'ada@example.com' }
const REJECTED = [
  'abc123',
  '5550132',
  '41555501329',
  '0155550132',
  '+44 20 7946 0958',
  '+1 415 555 0132',
  '1-415-555-0132',
  '4150550132',
  '4151550132',
  '1155550132',
]

type Schema = {
  $ref?: string
  type?: string
  required?: string[]
  additionalProperties?: boolean
  properties?: Record<string, Schema>
  items?: Schema
}
type OpenApi = {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: Schema }> }> }>>
  components: { schemas: Record<string, Schema> }
}
const openapi = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as OpenApi

function violations(value: unknown, raw: Schema, at = '$'): string[] {
  const schema = raw.$ref === undefined ? raw : openapi.components.schemas[raw.$ref.replace('#/components/schemas/', '')]
  if (schema === undefined) return [`${at}: unresolved ${raw.$ref}`]
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' ? [] : [`${at} is not a string`]
    case 'array':
      if (!Array.isArray(value)) return [`${at} is not an array`]
      return value.flatMap((item, i) => violations(item, schema.items ?? {}, `${at}[${i}]`))
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${at} is not an object`]
      const record = value as Record<string, unknown>
      const props = schema.properties ?? {}
      const missing = (schema.required ?? []).filter((k) => !(k in record)).map((k) => `${at}.${k} is missing`)
      const extra =
        schema.additionalProperties === false
          ? Object.keys(record)
              .filter((k) => !(k in props))
              .map((k) => `${at}.${k} is not allowed`)
          : []
      const nested = Object.entries(props)
        .filter(([k]) => k in record)
        .flatMap(([k, s]) => violations(record[k], s, `${at}.${k}`))
      return [...missing, ...extra, ...nested]
    }
    default:
      return []
  }
}

function expectDocumented(status: number, body: unknown): void {
  const operation = openapi.paths['/api/registrations']?.post
  expect(operation, 'POST /api/registrations is documented').toBeDefined()
  const schema = operation?.responses[String(status)]?.content?.['application/json']?.schema
  expect(schema, `status ${status} is documented`).toBeDefined()
  expect(violations(body, schema ?? {})).toEqual([])
}

class MemoryRegistrations implements RegistrationRepository {
  readonly rows: NewRegistration[] = []
  async insert(row: NewRegistration): Promise<void> {
    this.rows.push(row)
  }
}

let app: FastifyInstance | undefined

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT, registrations: new MemoryRegistrations() })
  await warm.inject({ method: 'POST', url: '/api/registrations', payload: { ...VALID, phone: '4155550132' } })
  await warm.close()
}, 30_000)

afterEach(async () => {
  await app?.close()
  app = undefined
})

function appWith(registrations: RegistrationRepository): FastifyInstance {
  app = buildApp({ webRoot: NO_WEB_ROOT, registrations })
  return app
}

function post(target: FastifyInstance, payload: unknown) {
  return target.inject({ method: 'POST', url: '/api/registrations', payload: payload as object })
}

describe('POST /api/registrations accepts a US number @story:ST-8 @criterion:AC-1', () => {
  it.each(['4155550132', '(415) 555-0132', '415.555.0132'])('stores %j as 4155550132', async (phone) => {
    const repo = new MemoryRegistrations()
    const res = await post(appWith(repo), { ...VALID, phone })
    expect(res.statusCode).toBe(201)
    expect(res.headers['cache-control']).toBe('no-store')
    expectDocumented(201, res.json())
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0]).toMatchObject({ fullName: 'Ada Lovelace', email: 'ada@example.com', phone: '4155550132' })
  })

  it('stores trimmed name and email, and a whole-second created_at it reports in UTC seconds', async () => {
    const repo = new MemoryRegistrations()
    const res = await post(appWith(repo), { fullName: '  Ada   Lovelace ', email: ' ada@example.com ', phone: '4155550132' })
    expect(res.statusCode).toBe(201)
    const row = repo.rows[0]
    expect(row).toMatchObject({ fullName: 'Ada Lovelace', email: 'ada@example.com' })
    expect((row?.createdAt.getTime() ?? 1) % 1000).toBe(0)
    expect(res.json()).toEqual({ data: { createdAt: row?.createdAt.toISOString().replace('.000Z', 'Z') } })
  })
})

describe('POST /api/registrations rejects anything else @story:ST-8 @criterion:AC-8', () => {
  it.each(REJECTED)('answers 400 with an error for phone for %j and stores nothing', async (phone) => {
    const repo = new MemoryRegistrations()
    const res = await post(appWith(repo), { ...VALID, phone })
    expect(res.statusCode).toBe(400)
    expectDocumented(400, res.json())
    expect(res.json().error.fields).toEqual([{ path: 'phone', message: PHONE_MESSAGE }])
    expect(res.body).not.toContain(phone)
    expect(repo.rows).toEqual([])
  })

  it.each([
    ['a missing phone', { ...VALID }],
    ['a number', { ...VALID, phone: 4155550132 }],
    ['null', { ...VALID, phone: null }],
    ['an array', { ...VALID, phone: ['4155550132'] }],
  ])('answers 400 with the phone message for %s', async (_case, payload) => {
    const repo = new MemoryRegistrations()
    const res = await post(appWith(repo), payload)
    expect(res.statusCode).toBe(400)
    expectDocumented(400, res.json())
    expect(res.json().error.fields).toEqual([{ path: 'phone', message: PHONE_MESSAGE }])
    expect(repo.rows).toEqual([])
  })

  it('reports every failing field once and echoes none of the submitted values', async () => {
    const repo = new MemoryRegistrations()
    const res = await post(appWith(repo), {
      fullName: '   ',
      email: `${SENTINEL}-not-an-email`,
      phone: `+1 ${SENTINEL}`,
    })
    expect(res.statusCode).toBe(400)
    expectDocumented(400, res.json())
    const paths = (res.json().error.fields as { path: string }[]).map((f) => f.path)
    expect(paths.sort()).toEqual(['email', 'fullName', 'phone'])
    expect(res.body).not.toContain(SENTINEL)
    expect(repo.rows).toEqual([])
  })

  it('refuses an unknown field without naming or echoing it', async () => {
    const repo = new MemoryRegistrations()
    const res = await post(appWith(repo), { ...VALID, phone: '4155550132', [SENTINEL]: SENTINEL })
    expect(res.statusCode).toBe(400)
    expectDocumented(400, res.json())
    expect(res.json()).toEqual({ error: { message: 'Check the highlighted fields.' } })
    expect(res.body).not.toContain(SENTINEL)
    expect(repo.rows).toEqual([])
  })

  it.each([
    ['a JSON array', '[]'],
    ['a JSON string', '"4155550132"'],
    ['malformed JSON', `{"phone":"${SENTINEL}"`],
  ])('answers 400 for %s without echoing it', async (_case, payload) => {
    const repo = new MemoryRegistrations()
    const res = await appWith(repo).inject({
      method: 'POST',
      url: '/api/registrations',
      headers: { 'content-type': 'application/json' },
      payload,
    })
    expect(res.statusCode).toBe(400)
    expectDocumented(400, res.json())
    expect(res.body).not.toContain(SENTINEL)
    expect(repo.rows).toEqual([])
  })

  it('answers 413 for a body over 16 KiB and stores nothing', async () => {
    const repo = new MemoryRegistrations()
    const res = await post(appWith(repo), { ...VALID, phone: '4155550132', fullName: SENTINEL.repeat(2000) })
    expect(res.statusCode).toBe(413)
    expectDocumented(413, res.json())
    expect(res.body).not.toContain(SENTINEL)
    expect(repo.rows).toEqual([])
  })

  it('answers 415 for a form-encoded body and stores nothing', async () => {
    const repo = new MemoryRegistrations()
    const res = await appWith(repo).inject({
      method: 'POST',
      url: '/api/registrations',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'phone=4155550132',
    })
    expect(res.statusCode).toBe(415)
    expectDocumented(415, res.json())
    expect(repo.rows).toEqual([])
  })
})

describe('POST /api/registrations when storing fails @story:ST-8', () => {
  it('answers 500 without the database detail', async () => {
    const failing: RegistrationRepository = {
      insert: async () => {
        throw Object.assign(new Error(`permission denied ${SENTINEL}`), { code: '42501' })
      },
    }
    const res = await post(appWith(failing), { ...VALID, phone: '4155550132' })
    expect(res.statusCode).toBe(500)
    expectDocumented(500, res.json())
    expect(res.body).not.toContain(SENTINEL)
  })

  it('answers 500 when no database is configured', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await post(app, { ...VALID, phone: '4155550132' })
    expect(res.statusCode).toBe(500)
    expectDocumented(500, res.json())
  })
})

describe('the registrations surface stays write-only @story:ST-8', () => {
  it.each(['GET', 'PUT', 'DELETE'] as const)('%s /api/registrations is not a route', async (method) => {
    const res = await appWith(new MemoryRegistrations()).inject({ method, url: '/api/registrations' })
    expect(res.statusCode).toBe(404)
  })
})
