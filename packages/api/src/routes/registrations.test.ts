import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import type { NewRegistration, RegistrationRepository } from '../persistence/repository.js'

// ST-9 through inject: POST /api/registrations applies the email rule, stores nothing on
// a rejection, and every answer is a documented envelope that never echoes the request.
const NO_WEB_ROOT = '/nonexistent-web-root'
const SENTINEL = 'SENTINEL-4b81e2'
const EMAIL_MESSAGE = 'Enter an email like name@example.com.'
const INCOMPLETE = ['jane', 'jane@', 'jane@example', '@example.com']
const emailOf = (length: number): string => `${'a'.repeat(length - '@example.com'.length)}@example.com`

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
  if (schema.type === 'string') return typeof value === 'string' ? [] : [`${at} is not a string`]
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${at} is not an array`]
    return value.flatMap((item, i) => violations(item, schema.items ?? {}, `${at}[${i}]`))
  }
  if (schema.type !== 'object') return []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${at} is not an object`]
  const record = value as Record<string, unknown>
  const props = schema.properties ?? {}
  return [
    ...(schema.required ?? []).filter((k) => !(k in record)).map((k) => `${at}.${k} is missing`),
    ...(schema.additionalProperties === false
      ? Object.keys(record)
          .filter((k) => !(k in props))
          .map((k) => `${at}.${k} is not allowed`)
      : []),
    ...Object.entries(props)
      .filter(([k]) => k in record)
      .flatMap(([k, s]) => violations(record[k], s, `${at}.${k}`)),
  ]
}

function expectDocumented(status: number, body: unknown): void {
  const documented = openapi.paths['/api/registrations']?.post?.responses[String(status)]
  expect(documented, `POST /api/registrations ${status} documented`).toBeDefined()
  expect(violations(body, documented?.content?.['application/json']?.schema ?? {})).toEqual([])
}

class RecordingRepository implements RegistrationRepository {
  readonly rows: NewRegistration[] = []
  async insert(row: NewRegistration): Promise<void> {
    this.rows.push(row)
  }
}

let app: FastifyInstance | undefined

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT, registrations: new RecordingRepository() })
  await warm.inject({ method: 'POST', url: '/api/registrations', payload: {} })
  await warm.close()
}, 30_000)

afterEach(async () => {
  await app?.close()
  app = undefined
})

function post(repository: RegistrationRepository, payload: unknown, contentType = 'application/json') {
  app = buildApp({ webRoot: NO_WEB_ROOT, registrations: repository })
  return app.inject({
    method: 'POST',
    url: '/api/registrations',
    headers: { 'content-type': contentType },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

describe('POST /api/registrations accepts a complete email @story:ST-9 @criterion:AC-1', () => {
  it('answers 201, stores the email as entered, and returns neither the row id nor a submitted value', async () => {
    const repository = new RecordingRepository()
    const before = Date.now()
    const res = await post(repository, { fullName: 'Jane Doe', email: 'jane.doe@example.com' })
    expect(res.statusCode).toBe(201)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.headers['cache-control']).toBe('no-store')
    expectDocumented(201, res.json())
    expect(repository.rows).toHaveLength(1)
    const [row] = repository.rows
    expect(row?.email).toBe('jane.doe@example.com')
    expect(row?.fullName).toBe('Jane Doe')
    // created_at is whole UTC seconds, and the receipt carries exactly that instant.
    expect(row?.createdAt.getTime() % 1000).toBe(0)
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000)
    expect(res.json()).toEqual({ data: { createdAt: row?.createdAt.toISOString().replace('.000Z', 'Z') } })
    expect(res.body).not.toContain('jane.doe')
    expect(res.body).not.toContain('Jane Doe')
    expect(res.body).not.toMatch(/"id"/)
  })
})

describe('POST /api/registrations rejects an incomplete email @story:ST-9 @criterion:AC-5 @criterion:AC-2', () => {
  it.each(INCOMPLETE)('answers %j with 400, an error for email, and no row', async (email) => {
    const repository = new RecordingRepository()
    const res = await post(repository, { fullName: `Jane ${SENTINEL}`, email })
    expect(res.statusCode).toBe(400)
    expectDocumented(400, res.json())
    expect(res.json()).toEqual({
      error: { message: 'Check the highlighted fields.', fields: [{ path: 'email', message: EMAIL_MESSAGE }] },
    })
    expect(repository.rows).toEqual([])
    expect(res.body).not.toContain(SENTINEL)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('never echoes the submitted email, even one carrying a sentinel', async () => {
    const repository = new RecordingRepository()
    const res = await post(repository, { fullName: 'Jane Doe', email: `${SENTINEL}@` })
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain(SENTINEL)
    expect(repository.rows).toEqual([])
  })
})

describe('POST /api/registrations applies the 254-character limit @story:ST-9 @criterion:AC-3', () => {
  it('stores an email of exactly 254 characters', async () => {
    const repository = new RecordingRepository()
    const res = await post(repository, { fullName: 'Jane Doe', email: emailOf(254) })
    expect(res.statusCode).toBe(201)
    expect(repository.rows.map((r) => r.email)).toEqual([emailOf(254)])
    expect(res.body).not.toContain(emailOf(254))
  })

  it('rejects an email of 255 characters with the email message and no row', async () => {
    const repository = new RecordingRepository()
    const res = await post(repository, { fullName: 'Jane Doe', email: emailOf(255) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.fields).toEqual([{ path: 'email', message: EMAIL_MESSAGE }])
    expect(repository.rows).toEqual([])
  })
})

describe('POST /api/registrations keeps every other answer inside the envelope @story:ST-9 @criterion:AC-5', () => {
  it.each([
    ['a missing email', { fullName: 'Jane Doe' }, [{ path: 'email', message: EMAIL_MESSAGE }]],
    [
      'an empty name and an incomplete email',
      { fullName: '', email: 'jane@' },
      [
        { path: 'fullName', message: 'Full name is required.' },
        { path: 'email', message: EMAIL_MESSAGE },
      ],
    ],
  ])('answers %s with 400 and one error per field', async (_name, payload, fields) => {
    const repository = new RecordingRepository()
    const res = await post(repository, payload)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { message: 'Check the highlighted fields.', fields } })
    expectDocumented(400, res.json())
    expect(repository.rows).toEqual([])
  })

  it.each([
    ['an unknown field', { fullName: 'Jane Doe', email: 'jane.doe@example.com', [SENTINEL]: SENTINEL }],
    ['a JSON array', [SENTINEL]],
    ['JSON null', null],
    ['a JSON string', SENTINEL],
  ])('answers %s with 400, a generic envelope and no row', async (_name, payload) => {
    const repository = new RecordingRepository()
    const res = await post(repository, JSON.stringify(payload))
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { message: 'The request could not be read.' } })
    expectDocumented(400, res.json())
    expect(res.body).not.toContain(SENTINEL)
    expect(repository.rows).toEqual([])
  })

  it('answers malformed JSON with 400 and no row', async () => {
    const repository = new RecordingRepository()
    const res = await post(repository, `{"email":"${SENTINEL}"`)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { message: 'The request could not be read.' } })
    expectDocumented(400, res.json())
    expect(res.body).not.toContain(SENTINEL)
    expect(repository.rows).toEqual([])
  })

  it('answers a non-JSON body with 415 and no row', async () => {
    const repository = new RecordingRepository()
    const res = await post(repository, `email=${SENTINEL}`, 'application/x-www-form-urlencoded')
    expect(res.statusCode).toBe(415)
    expectDocumented(415, res.json())
    expect(res.body).not.toContain(SENTINEL)
    expect(repository.rows).toEqual([])
  })

  it('answers a storage failure with 500 and no internal detail', async () => {
    const failing: RegistrationRepository = {
      insert: async () => {
        throw Object.assign(new Error(`permission denied: ${SENTINEL}`), { code: '42501' })
      },
    }
    const res = await post(failing, { fullName: 'Jane Doe', email: 'jane.doe@example.com' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
    expectDocumented(500, res.json())
    expect(res.body).not.toContain(SENTINEL)
    expect(res.body).not.toContain('jane.doe')
  })

  it('answers 500 when no database is configured, and still rejects an incomplete email with 400', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT, databaseUrl: undefined })
    const ok = await app.inject({
      method: 'POST',
      url: '/api/registrations',
      payload: { fullName: 'Jane Doe', email: 'jane.doe@example.com' },
    })
    expect(ok.statusCode).toBe(500)
    expect(ok.json()).toEqual({ error: { message: 'Something went wrong.' } })
    const bad = await app.inject({ method: 'POST', url: '/api/registrations', payload: { fullName: 'Jane Doe', email: 'jane@' } })
    expect(bad.statusCode).toBe(400)
  })

  it('offers no way to read registrations back', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT, registrations: new RecordingRepository() })
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/registrations' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: { message: 'Not found.' } })
    }
    expect(Object.keys(openapi.paths['/api/registrations'] ?? {})).toEqual(['post'])
  })
})
