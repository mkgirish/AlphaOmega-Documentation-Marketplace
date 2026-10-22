import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { FastifyInstance } from 'fastify'
import type { LightMyRequestResponse } from 'fastify'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp, start } from '../main.js'
import { logger } from '../observability/index.js'
import { BODY_LIMIT } from '../plugins/security.js'
import type { NewRegistration, RegistrationStore } from '../persistence/repository.js'

// Every submitted value carries a sentinel (the phone's is its last four digits), so a
// response that echoed any of them would show it.
const ECHO = /sentinel|0132/i

// ST-10 AC-6 through the HTTP surface: POST /api/registrations applies the name rules,
// answers with AD-5 envelopes documented in openapi.json, and writes nothing on a 400.
const NO_WEB_ROOT = '/nonexistent-web-root'
const URL = '/api/registrations'
const valid = { firstName: 'Siobhan', lastName: "O'Brien", email: 'sentinel.visitor@example.com', phone: '(415) 555-0132' }

class MemoryStore implements RegistrationStore {
  readonly rows: NewRegistration[] = []
  async insert(row: NewRegistration): Promise<void> {
    this.rows.push(row)
  }
}

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
const openapi = JSON.parse(readFileSync(new globalThis.URL('../../openapi.json', import.meta.url), 'utf8')) as OpenApi

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

/** The status is documented, the body conforms, nothing is cached and nothing is echoed. */
function expectDocumented(res: LightMyRequestResponse): void {
  const media = openapi.paths[URL]?.post?.responses[String(res.statusCode)]?.content?.['application/json']
  expect(media, `POST ${URL} ${res.statusCode} documented`).toBeDefined()
  expect(violations(res.json(), media?.schema ?? {})).toEqual([])
  expect(res.headers['cache-control']).toBe('no-store')
  expect(res.body).not.toMatch(ECHO)
  expect(res.body).not.toContain('"id"')
}

let app: FastifyInstance | undefined

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT, store: new MemoryStore() })
  await warm.inject({ method: 'POST', url: URL, payload: valid })
  await warm.close()
}, 30_000)

afterEach(async () => {
  await app?.close()
  app = undefined
})

function post(store: RegistrationStore, payload: unknown, headers: Record<string, string> = {}) {
  app = buildApp({ webRoot: NO_WEB_ROOT, store })
  return app.inject({
    method: 'POST',
    url: URL,
    headers: { 'content-type': 'application/json', ...headers },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

describe('POST /api/registrations accepts real-world names @story:ST-10 @criterion:AC-1', () => {
  it.each([
    ['Siobhan', "O'Brien"],
    ['Anne-Marie', 'Dupont'],
    ['José', 'Anne-Marie'],
    ["O'Brien", 'José'],
  ])('stores "%s" "%s" exactly as entered and answers 201', async (firstName, lastName) => {
    const store = new MemoryStore()
    const res = await post(store, { ...valid, firstName, lastName })
    expect(res.statusCode).toBe(201)
    expectDocumented(res)
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({ firstName, lastName, email: valid.email, phone: valid.phone })
  })

  it('answers 201 with only the whole-second UTC createdAt it stored: no id, no submitted value', async () => {
    const store = new MemoryStore()
    const res = await post(store, { ...valid, firstName: 'SENTINELFIRST', lastName: 'SENTINELLAST' })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { data: { createdAt: string } }
    expect(Object.keys(body.data)).toEqual(['createdAt'])
    expect(body.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(store.rows[0]?.createdAt.toISOString().replace('.000Z', 'Z')).toBe(body.data.createdAt)
    expectDocumented(res)
  })
})

describe('POST /api/registrations accepts a 100-character name @story:ST-10 @criterion:AC-2', () => {
  it.each(['firstName', 'lastName'])('stores a %s of exactly 100 characters', async (field) => {
    const store = new MemoryStore()
    const res = await post(store, { ...valid, [field]: 'a'.repeat(100) })
    expect(res.statusCode).toBe(201)
    expect(store.rows[0]?.[field as 'firstName' | 'lastName']).toBe('a'.repeat(100))
  })
})

describe('POST /api/registrations rejects a 101-character name @story:ST-10 @criterion:AC-6 @criterion:AC-3', () => {
  it.each([
    ['lastName', 'Last name must be 100 characters or fewer.'],
    ['firstName', 'First name must be 100 characters or fewer.'],
  ])('answers 400 with an error for %s and stores nothing', async (field, message) => {
    const store = new MemoryStore()
    const sentinel = `SENTINEL${'x'.repeat(93)}`
    expect(sentinel).toHaveLength(101)
    const res = await post(store, { ...valid, [field]: sentinel })
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    expect(res.json()).toEqual({ error: { message: 'Check the highlighted fields.', fields: [{ path: field, message }] } })
    expect(store.rows).toHaveLength(0)
  })

  it('answers 400 with no field list for an unknown field and stores nothing', async () => {
    const store = new MemoryStore()
    const res = await post(store, { ...valid, id: 'SENTINEL' })
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    expect(res.json()).toEqual({ error: { message: 'The request could not be read.' } })
    expect(store.rows).toHaveLength(0)
  })

  it('answers malformed JSON with the generic 400 and stores nothing', async () => {
    const store = new MemoryStore()
    const res = await post(store, '{"lastName":"SENTINEL"')
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    expect(res.body).not.toContain('SENTINEL')
    expect(store.rows).toHaveLength(0)
  })

  it('answers a body over the limit with 413 and stores nothing', async () => {
    const store = new MemoryStore()
    const res = await post(store, { ...valid, lastName: `SENTINEL${'x'.repeat(BODY_LIMIT)}` })
    expect(res.statusCode).toBe(413)
    expectDocumented(res)
    expect(store.rows).toHaveLength(0)
  })

  it('answers GET with the not-found envelope: there is no read route', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT, store: new MemoryStore() })
    const res = await app.inject({ method: 'GET', url: URL })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { message: 'Not found.' } })
  })

  it('answers a non-JSON body with 415 and stores nothing', async () => {
    const store = new MemoryStore()
    const res = await post(store, 'lastName=SENTINEL', { 'content-type': 'application/x-www-form-urlencoded' })
    expect(res.statusCode).toBe(415)
    expectDocumented(res)
    expect(res.body).not.toContain('SENTINEL')
    expect(store.rows).toHaveLength(0)
  })
})

describe('POST /api/registrations when storage fails @story:ST-10 @criterion:AC-6', () => {
  it('answers 500 with a generic envelope, logging only the SQLSTATE', async () => {
    const logged = vi.spyOn(logger, 'error')
    const failing: RegistrationStore = {
      insert: async () => {
        throw Object.assign(new Error('permission denied for table registrations SENTINEL'), { code: '42501' })
      },
    }
    const res = await post(failing, valid)
    expect(res.statusCode).toBe(500)
    expectDocumented(res)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
    expect(res.body).not.toMatch(/SENTINEL|permission/)
    expect(logged).toHaveBeenCalledWith({ code: '42501' }, 'request.failed')
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(ECHO)
    logged.mockRestore()
  })

  it('answers 500 when the app was built without a database', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await app.inject({ method: 'POST', url: URL, payload: valid })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
  })
})

describe('start() @story:ST-10 @criterion:AC-6', () => {
  it('refuses to start, releasing the pool, when the configured database cannot be reached', async () => {
    const config = { port: 0, host: '127.0.0.1', webRoot: NO_WEB_ROOT, databaseUrl: 'postgres://app@127.0.0.1:1/app' }
    await expect(start(config)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('releases what it opened when it cannot listen', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const address = blocker.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    try {
      await expect(start({ port, host: '127.0.0.1', webRoot: NO_WEB_ROOT })).rejects.toMatchObject({ code: 'EADDRINUSE' })
    } finally {
      await new Promise((resolve) => blocker.close(resolve))
    }
  })
})
