import { randomBytes } from 'node:crypto'
import { messages } from '@app/shared'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import { openDatabase, type Database } from '../persistence/database.js'
import { migrate } from '../persistence/migrate.js'
import { createRegistrationRepository, type NewRegistration, type RegistrationRepository } from '../persistence/repository.js'

// ST-3 AC-6 — a JSON body sent straight to POST /api/registrations with a field that is
// blank, only spaces, or only invisible characters (zero-width space, joiners, word joiner,
// soft hyphen) is refused with 400 naming that field, and no row is written. The real
// PostgreSQL row count is checked when AGENTX_TEST_DATABASE_URL is set.
const URL = '/api/registrations'
const NO_WEB_ROOT = '/nonexistent-web-root'
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const FIELDS = [
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['email', 'Email'],
  ['phone', 'Phone number'],
] as const
const BLANKS = ['', '   ', '\t  \n', '\u200b', ' \u200b\u2060 ', '\u200c\u200d', '\u00ad', '\ufeff\u200b']

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
  await app?.close()
  app = undefined
})

function post(target: FastifyInstance, payload: Record<string, unknown>) {
  return target.inject({ method: 'POST', url: URL, payload })
}

describe('the API refuses a blank field sent directly @story:ST-3 @criterion:AC-6', () => {
  it.each(FIELDS)('%s blank, spaces or invisible answers 400 naming only that field and stores nothing', async (field, label) => {
    const repository = new MemoryRepository()
    app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    for (const blank of BLANKS) {
      const res = await post(app, { ...VALID, [field]: blank })
      expect(res.statusCode, JSON.stringify(blank)).toBe(400)
      expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.json(), JSON.stringify(blank)).toEqual({ error: 'validation', fields: { [field]: [messages.required(label)] } })
    }
    expect(repository.rows).toHaveLength(0)
  })

  it('names every field that is blank or invisible at once, and none that is filled', async () => {
    const repository = new MemoryRepository()
    app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await post(app, { firstName: 'Jane', lastName: '  ', email: '\u200b', phone: ' \u2060 ' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'validation',
      fields: {
        lastName: [messages.required('Last name')],
        email: [messages.required('Email')],
        phone: [messages.required('Phone number')],
      },
    })
    expect(repository.rows).toHaveLength(0)
  })

  it('never echoes the values of the filled fields when another is blank or invisible', async () => {
    const sentinels = { firstName: 'SentinelFirst', email: 'sentinel.mail@example.com', phone: '(212) 867-5309' }
    app = buildApp({ webRoot: NO_WEB_ROOT, repository: new MemoryRepository() })
    for (const lastName of ['  ', '\u200b']) {
      const res = await post(app, { ...sentinels, lastName })
      expect(res.statusCode).toBe(400)
      for (const sentinel of Object.values(sentinels)) expect(res.body).not.toContain(sentinel)
    }
  })

  it('still accepts the same visitor once every field is filled', async () => {
    const repository = new MemoryRepository()
    app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    expect((await post(app, { ...VALID, lastName: '\u200b' })).statusCode).toBe(400)
    expect((await post(app, VALID)).statusCode).toBe(201)
    expect(repository.rows).toHaveLength(1)
  })
})

const BASE_URL = process.env.AGENTX_TEST_DATABASE_URL || undefined
const SCHEMA = `st3_${randomBytes(6).toString('hex')}`

describe.skipIf(BASE_URL === undefined)('a blank field leaves the PostgreSQL row count unchanged @story:ST-3 @criterion:AC-6', () => {
  let admin: pg.Client
  let database: Database

  async function count(): Promise<number> {
    const { rows } = await admin.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${SCHEMA}.registrations`)
    return Number(rows[0]?.n)
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: BASE_URL })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${SCHEMA}`)
    const url = new globalThis.URL(BASE_URL ?? 'postgresql://unset')
    url.searchParams.set('options', `-c search_path=${SCHEMA}`)
    database = openDatabase(url.toString())
    await migrate(database.pool)
  }, 30_000)

  afterAll(async () => {
    await database?.close()
    await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await admin?.end()
  })

  it('answers 400 for the lastName "  " body and for every blank or invisible field, writing no row', async () => {
    // 34 requests from one address: lift the rate limit so only validation answers.
    const rateLimits = { perIpPerMin: 1000, globalPerMin: 1000 }
    app = buildApp({ webRoot: NO_WEB_ROOT, repository: createRegistrationRepository(database.db), rateLimits })
    const before = await count()

    const res = await post(app, { firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: { lastName: [messages.required('Last name')] } })

    for (const [field] of FIELDS) {
      for (const blank of BLANKS) {
        const refused = await post(app, { ...VALID, [field]: blank })
        expect(refused.statusCode, `${field} ${JSON.stringify(blank)}`).toBe(400)
        expect(Object.keys((refused.json() as { fields: object }).fields)).toEqual([field])
      }
    }
    expect(await count()).toBe(before)

    expect((await post(app, VALID)).statusCode).toBe(201)
    expect(await count()).toBe(before + 1)
  })
})
