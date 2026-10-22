import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, start } from '../main.js'
import { migrate, openDatabase, type Database } from '../persistence/database.js'
import { registrationRepository } from '../persistence/registrations.js'

// ST-10 through POST /api/registrations: real names are accepted and stored as written,
// a 101-character name is a 400 naming that field, and no response echoes what was sent.
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
    default:
      return []
  }
}

/** Asserts the response is a documented status of POST /api/registrations with a conforming JSON body. */
function expectDocumented(res: { statusCode: number; headers: Record<string, unknown>; json: () => unknown }): void {
  const documented = openapi.paths['/api/registrations']?.post?.responses[String(res.statusCode)]
  expect(documented, `POST /api/registrations ${res.statusCode} documented`).toBeDefined()
  expect(String(res.headers['content-type'])).toMatch(/^application\/json/)
  const schema = documented?.content?.['application/json']?.schema
  expect(schema).toBeDefined()
  expect(violations(res.json(), schema ?? {})).toEqual([])
  expect(res.headers['cache-control']).toBe('no-store')
}

const SENTINEL = 'SENTINEL-c41e'
const VALID = { firstName: 'Siobhan', lastName: "O'Brien", email: 'siobhan@example.com', phone: '(212) 555-0142' }
const NO_WEB_ROOT = '/nonexistent-web-root'

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

function post(target: FastifyInstance, body: unknown, contentType = 'application/json') {
  return target.inject({
    method: 'POST',
    url: '/api/registrations',
    headers: { 'content-type': contentType },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT })
  await post(warm, VALID)
  await warm.close()
}, 30_000)

describe('the API applies the length rule @story:ST-10 @criterion:AC-6 @criterion:AC-3', () => {
  it.each([
    ['firstName', 'First name must be 100 characters or fewer.'],
    ['lastName', 'Last name must be 100 characters or fewer.'],
  ] as const)('a 101-character %s is a documented 400 naming that field and echoing nothing', async (field, message) => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const value = `${SENTINEL}${'x'.repeat(101 - SENTINEL.length)}`
    expect(value).toHaveLength(101)
    const res = await post(app, { ...VALID, [field]: value })
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    expect(res.json()).toEqual({ error: { message: expect.any(String), fields: [{ path: field, message }] } })
    expect(res.body).not.toContain(SENTINEL)
  })

  it('a 400 never echoes any submitted field, nor an unknown key', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await post(app, {
      firstName: SENTINEL.repeat(20),
      lastName: SENTINEL.repeat(20),
      email: `${SENTINEL}@`,
      phone: SENTINEL,
      [SENTINEL]: SENTINEL,
    })
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    expect(res.body).not.toContain(SENTINEL)
  })

  it('an unknown field is a documented 400', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await post(app, { ...VALID, id: '00000000-0000-0000-0000-000000000000' })
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
  })

  it('malformed JSON is a documented 400 that echoes nothing', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await post(app, `{"firstName": "${SENTINEL}"`)
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    expect(res.body).not.toContain(SENTINEL)
  })

  it('a body that is not JSON is a documented 415', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await post(app, `firstName=${SENTINEL}`, 'text/plain')
    expect(res.statusCode).toBe(415)
    expectDocumented(res)
    expect(res.body).not.toContain(SENTINEL)
  })

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)('%s on the collection is 405, allowing POST only', async (method) => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await app.inject({ method, url: '/api/registrations' })
    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('POST')
    expect(violations(res.json(), { $ref: '#/components/schemas/ErrorEnvelope' })).toEqual([])
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('a valid body with no database reachable is a documented 500 with no detail', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await post(app, { ...VALID, firstName: SENTINEL })
    expect(res.statusCode).toBe(500)
    expectDocumented(res)
    expect(res.body).not.toContain(SENTINEL)
  })
})

const url = process.env.AGENTX_TEST_DATABASE_URL
const schema = `st10_route_${randomBytes(4).toString('hex')}`
let database: Database
let admin: pg.Client

async function rowCount(): Promise<number> {
  const res = await admin.query(`SELECT count(*)::int AS n FROM ${schema}.registrations`)
  return (res.rows[0] as { n: number }).n
}

async function newestRow(): Promise<Record<string, unknown>> {
  const res = await admin.query(`SELECT * FROM ${schema}.registrations ORDER BY created_at DESC, ctid DESC LIMIT 1`)
  return res.rows[0] as Record<string, unknown>
}

describe.skipIf(url === undefined)('POST /api/registrations against PostgreSQL @story:ST-10', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    database = openDatabase(url ?? '', { searchPath: schema })
    await migrate(database, { migrationsSchema: schema })
  }, 30_000)

  afterAll(async () => {
    await database?.close()
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin?.end()
  })

  const withDatabase = (): FastifyInstance => (app = buildApp({ webRoot: NO_WEB_ROOT, registrations: registrationRepository(database) }))

  it.each([
    ['Siobhan', "O'Brien"],
    ['Anne-Marie', 'Dupont'],
    ['José', 'Anne-Marie'],
  ])('%s %s is created and the newest row stores the names as written @criterion:AC-1', async (firstName, lastName) => {
    const res = await post(withDatabase(), { ...VALID, firstName, lastName })
    expect(res.statusCode).toBe(201)
    expectDocumented(res)
    expect(res.body).not.toContain(firstName)
    expect(res.body).not.toContain(lastName)
    const row = await newestRow()
    expect(row).toMatchObject({ first_name: firstName, last_name: lastName })
    expect(res.body).not.toContain(String(row.id))
    expect((res.json() as { data: { createdAt: string } }).data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it.each(['firstName', 'lastName'] as const)('a %s of exactly 100 characters is created @criterion:AC-2', async (field) => {
    const before = await rowCount()
    const res = await post(withDatabase(), { ...VALID, [field]: 'n'.repeat(100) })
    expect(res.statusCode).toBe(201)
    expect(await rowCount()).toBe(before + 1)
  })

  it.each(['firstName', 'lastName'] as const)(
    'a %s of 101 characters is a 400 and adds no row @criterion:AC-3 @criterion:AC-6',
    async (field) => {
      const before = await rowCount()
      const res = await post(withDatabase(), { ...VALID, [field]: 'n'.repeat(101) })
      expect(res.statusCode).toBe(400)
      expect((res.json() as { error: { fields: { path: string }[] } }).error.fields.map((f) => f.path)).toEqual([field])
      expect(await rowCount()).toBe(before)
    },
  )

  it('stores names trimmed of surrounding whitespace', async () => {
    const res = await post(withDatabase(), { ...VALID, firstName: '  José ', lastName: ' Anne-Marie  ' })
    expect(res.statusCode).toBe(201)
    expect(await newestRow()).toMatchObject({ first_name: 'José', last_name: 'Anne-Marie' })
  })

  it('start() migrates the configured database and accepts a registration over HTTP', async () => {
    const server = await start({ port: 0, host: '127.0.0.1', webRoot: NO_WEB_ROOT, databaseUrl: url })
    try {
      const address = server.server.address()
      if (address === null || typeof address === 'string') throw new Error('no TCP address')
      const res = await fetch(`http://127.0.0.1:${address.port}/api/registrations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...VALID, lastName: 'L'.repeat(100) }),
      })
      expect(res.status).toBe(201)
      const tooLong = await fetch(`http://127.0.0.1:${address.port}/api/registrations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...VALID, lastName: 'L'.repeat(101) }),
      })
      expect(tooLong.status).toBe(400)
    } finally {
      await server.close()
    }
  })
})
