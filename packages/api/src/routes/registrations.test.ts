import { readdirSync, readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { buildApp } from '../main.js'
import { createPgRepository, type NewRegistration, type RegistrationRepository } from '../persistence/repository.js'
import { PHONE_MESSAGE } from '../registration/phone.js'

// ST-8 on CMP-3: POST /api/registrations applies the US phone rule, answers 400 with an
// error for phone and stores nothing when it fails, and stores the ten digits when it holds.
const NO_WEB_ROOT = '/nonexistent-web-root'
const URL_PATH = '/api/registrations'
const VALID = { fullName: 'Ada Lovelace', email: 'ada@example.com' }
const ACCEPTED = ['4155550132', '(415) 555-0132', '415.555.0132']
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
      return [`${at}: unsupported schema`]
  }
}

/** Asserts the response's status and JSON body are documented for POST /api/registrations. */
function expectDocumented(res: { statusCode: number; headers: Record<string, unknown>; json: () => unknown }): void {
  const documented = openapi.paths[URL_PATH]?.post?.responses[String(res.statusCode)]
  expect(documented, `POST ${URL_PATH} ${res.statusCode} documented`).toBeDefined()
  expect(String(res.headers['content-type'])).toMatch(/^application\/json/)
  const schema = documented?.content?.['application/json']?.schema
  expect(schema, `application/json documented for ${res.statusCode}`).toBeDefined()
  expect(violations(res.json(), schema ?? {})).toEqual([])
  expect(res.headers['cache-control']).toBe('no-store')
}

class RecordingRepository implements RegistrationRepository {
  readonly rows: NewRegistration[] = []
  async insert(row: NewRegistration): Promise<void> {
    this.rows.push(row)
  }
}

function post(app: FastifyInstance, body: unknown, contentType = 'application/json') {
  return app.inject({
    method: 'POST',
    url: URL_PATH,
    headers: { 'content-type': contentType },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT, repository: new RecordingRepository() })
  await post(warm, { ...VALID, phone: '4155550132' })
  await warm.close()
}, 60_000)

// Route tests: an in-memory repository records what would be stored; the database itself
// is exercised by the PostgreSQL block below.
describe('the API applies the same phone rule @story:ST-8 @criterion:AC-8', () => {
  it.each(REJECTED)('%s answers 400 with an error for phone and stores nothing', async (phone) => {
    const repository = new RecordingRepository()
    const app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await post(app, { ...VALID, phone })
    await app.close()
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    expect(res.json()).toEqual({
      error: { message: expect.any(String), fields: [{ path: 'phone', message: PHONE_MESSAGE }] },
    })
    expect(repository.rows).toEqual([])
  })

  it.each([
    ['a missing phone', VALID],
    ['a numeric phone', { ...VALID, phone: 4155550132 }],
    ['a null phone', { ...VALID, phone: null }],
  ])('%s answers 400 with an error for phone', async (_name, body) => {
    const repository = new RecordingRepository()
    const app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await post(app, body)
    await app.close()
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    expect(res.json().error.fields).toEqual([{ path: 'phone', message: PHONE_MESSAGE }])
    expect(repository.rows).toEqual([])
  })

  it('reports every failing field at once, phone among them', async () => {
    const repository = new RecordingRepository()
    const app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await post(app, { fullName: '   ', email: 'not-an-email', phone: '5550132' })
    await app.close()
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    const paths = (res.json().error.fields as { path: string }[]).map((f) => f.path).sort()
    expect(paths).toEqual(['email', 'fullName', 'phone'])
    expect(repository.rows).toEqual([])
  })

  it('names a non-string full name as a full-name error, not a crash', async () => {
    const app = buildApp({ webRoot: NO_WEB_ROOT, repository: new RecordingRepository() })
    const res = await post(app, { ...VALID, fullName: 42, phone: '4155550132' })
    await app.close()
    expect(res.statusCode).toBe(400)
    expectDocumented(res)
    expect(res.json().error.fields).toEqual([{ path: 'fullName', message: 'Full name is required.' }])
  })

  it('refuses a body sent without a content type with 415', async () => {
    const repository = new RecordingRepository()
    const app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await app.inject({ method: 'POST', url: URL_PATH })
    await app.close()
    expect(res.statusCode).toBe(415)
    expectDocumented(res)
    expect(repository.rows).toEqual([])
  })

  it('never echoes a submitted value in the 400 body', async () => {
    const sentinel = 'SENTINEL-5c1d-415-555-0132'
    const app = buildApp({ webRoot: NO_WEB_ROOT, repository: new RecordingRepository() })
    const res = await post(app, {
      fullName: `${sentinel}${'x'.repeat(300)}`,
      email: `${sentinel}@`,
      phone: sentinel,
    })
    await app.close()
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain('SENTINEL')
    expect(res.body).not.toContain('415-555-0132')
  })

  it.each([
    ['an unknown field', JSON.stringify({ ...VALID, phone: '4155550132', id: 'x' }), 'application/json', 400],
    ['malformed JSON', '{"phone": ', 'application/json', 400],
    ['a JSON array', '[]', 'application/json', 400],
    ['a non-JSON body', 'phone=4155550132', 'text/plain', 415],
  ])('%s is refused and stores nothing', async (_name, payload, contentType, status) => {
    const repository = new RecordingRepository()
    const app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await post(app, payload, contentType)
    await app.close()
    expect(res.statusCode).toBe(status)
    expectDocumented(res)
    expect(res.body).not.toContain('4155550132')
    expect(repository.rows).toEqual([])
  })
})

describe('accepted numbers are stored as ten digits @story:ST-8 @criterion:AC-1', () => {
  it.each(ACCEPTED)('%s is stored as phone 4155550132 and answers 201', async (phone) => {
    const repository = new RecordingRepository()
    const app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await post(app, { fullName: '  Ada   Lovelace ', email: ' ada@example.com ', phone })
    await app.close()
    expect(res.statusCode).toBe(201)
    expectDocumented(res)
    expect(repository.rows).toHaveLength(1)
    const [row] = repository.rows
    expect(row).toMatchObject({ fullName: 'Ada Lovelace', email: 'ada@example.com', phone: '4155550132' })
    expect(row?.createdAt.getUTCMilliseconds()).toBe(0)
    expect(res.json()).toEqual({ data: { createdAt: row?.createdAt.toISOString().replace('.000Z', 'Z') } })
    expect(res.body).not.toContain('Ada')
    expect(res.body).not.toContain('4155550132')
  })
})

describe('storage failures stay generic @story:ST-8', () => {
  it('answers 500 without detail when the insert fails', async () => {
    const failing: RegistrationRepository = {
      insert: async () => {
        throw Object.assign(new Error('permission denied for table registrations 4155550132'), { code: '42501' })
      },
    }
    const app = buildApp({ webRoot: NO_WEB_ROOT, repository: failing })
    const res = await post(app, { ...VALID, phone: '4155550132' })
    await app.close()
    expect(res.statusCode).toBe(500)
    expectDocumented(res)
    expect(res.body).not.toContain('permission')
    expect(res.body).not.toContain('4155550132')
  })

  it('answers 500 when no database is configured', async () => {
    const app = buildApp({ webRoot: NO_WEB_ROOT, databaseUrl: undefined })
    const res = await post(app, { ...VALID, phone: '4155550132' })
    await app.close()
    expect(res.statusCode).toBe(500)
    expectDocumented(res)
  })

  it('answers 500 when the configured database cannot be reached, and closes its pool', async () => {
    const app = buildApp({ webRoot: NO_WEB_ROOT, databaseUrl: 'postgresql://nobody:nothing@127.0.0.1:1/none' })
    const res = await post(app, { ...VALID, phone: '4155550132' })
    expect(res.statusCode).toBe(500)
    expectDocumented(res)
    await expect(app.close()).resolves.toBeUndefined()
  }, 30_000)

  it('reads the database from DATABASE_URL', () => {
    expect(loadConfig({}).databaseUrl).toBeUndefined()
    expect(loadConfig({ DATABASE_URL: 'postgresql://app@db/registrations' }).databaseUrl).toBe('postgresql://app@db/registrations')
  })
})

// Integration against the disposable PostgreSQL: the committed migrations applied in a
// schema of this file's own, the real repository, and row counts read back with SQL.
const DATABASE_URL = process.env.AGENTX_TEST_DATABASE_URL
const SCHEMA = `st8_${process.pid}_${Date.now()}`

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('against PostgreSQL @story:ST-8', () => {
  let pool: pg.Pool
  let app: FastifyInstance

  const count = async (): Promise<number> => Number((await pool.query<{ n: string }>('SELECT count(*) AS n FROM registrations')).rows[0]?.n)

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: DATABASE_URL })
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`)
    await admin.end()
    pool = new pg.Pool({ connectionString: DATABASE_URL, options: `-c search_path="${SCHEMA}"` })
    const dir = new URL('../../drizzle/', import.meta.url)
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await pool.query(readFileSync(new URL(file, dir), 'utf8'))
    }
    app = buildApp({ webRoot: NO_WEB_ROOT, repository: createPgRepository(pool) })
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await pool?.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
    await pool?.end()
  })

  it.each(ACCEPTED)('%s lands as the newest row with phone 4155550132 @criterion:AC-1', async (phone) => {
    const before = await count()
    const res = await post(app, { ...VALID, phone })
    expect(res.statusCode).toBe(201)
    expect(await count()).toBe(before + 1)
    const newest = await pool.query<{ phone: string; full_name: string; email: string; created_at: Date }>(
      'SELECT phone, full_name, email, created_at FROM registrations ORDER BY created_at DESC, ctid DESC LIMIT 1',
    )
    expect(newest.rows[0]).toMatchObject({ phone: '4155550132', full_name: VALID.fullName, email: VALID.email })
    expect(newest.rows[0]?.created_at.getUTCMilliseconds()).toBe(0)
  })

  it.each(REJECTED)(
    '%s answers 400 for phone and leaves the row count unchanged @criterion:AC-2 @criterion:AC-3 @criterion:AC-8',
    async (phone) => {
      const before = await count()
      const res = await post(app, { ...VALID, phone })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.fields).toEqual([{ path: 'phone', message: PHONE_MESSAGE }])
      expect(await count()).toBe(before)
    },
  )

  it('stores two rows for the same submission twice @criterion:AC-1', async () => {
    const before = await count()
    expect((await post(app, { ...VALID, phone: '(415) 555-0132' })).statusCode).toBe(201)
    expect((await post(app, { ...VALID, phone: '(415) 555-0132' })).statusCode).toBe(201)
    expect(await count()).toBe(before + 2)
  })

  it('refuses a malformed phone at the table as well @criterion:AC-8', async () => {
    await expect(
      pool.query(`INSERT INTO registrations (full_name, email, phone) VALUES ('A', 'a@example.com', '+14155550132')`),
    ).rejects.toMatchObject({ code: '23514' })
  })
})
