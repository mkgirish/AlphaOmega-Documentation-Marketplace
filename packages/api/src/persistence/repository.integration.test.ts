import { readdirSync, readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp, start } from '../main.js'
import { createLogger } from '../observability/index.js'
import { createPgStore } from './repository.js'

// ST-11 against a real PostgreSQL: the committed migrations are applied to a schema of this
// run's own, and every refusal leaves the registrations row count where it was.
const DATABASE_URL = process.env.AGENTX_TEST_DATABASE_URL
// The database is fresh per run; this suite owns the schema and recreates it.
const SCHEMA = 'st11_registrations'
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

// The app pool runs as a role holding only INSERT, as the app role does; the test user may
// be a superuser, whom no REVOKE would stop.
function scopedUrl(url: string, role?: string): string {
  const scoped = new URL(url)
  scoped.searchParams.set('options', `-c search_path=${SCHEMA}${role === undefined ? '' : ` -c role=${role}`}`)
  return scoped.toString()
}

let admin: pg.Pool
const log: string[] = []
let app: FastifyInstance
let before: number

async function rowCount(): Promise<number> {
  const { rows } = await admin.query<{ n: string }>('SELECT count(*) AS n FROM registrations')
  return Number(rows[0]?.n)
}

function post(payload: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/registrations',
    headers: { 'content-type': 'application/json', ...headers },
    payload,
  })
}

describe.skipIf(DATABASE_URL === undefined)('registrations in PostgreSQL @story:ST-11', () => {
  beforeAll(async () => {
    const url = scopedUrl(DATABASE_URL ?? '')
    admin = new pg.Pool({ connectionString: url })
    await admin.query('DROP SCHEMA IF EXISTS st11_registrations CASCADE')
    await admin.query('CREATE SCHEMA st11_registrations')
    const dir = new URL('../../drizzle/', import.meta.url)
    await admin.query('DROP ROLE IF EXISTS st11_app')
    await admin.query('CREATE ROLE st11_app NOLOGIN')
    await admin.query('GRANT USAGE ON SCHEMA st11_registrations TO st11_app')
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await admin.query(readFileSync(new URL(file, dir), 'utf8'))
    }
    await admin.query('GRANT INSERT ON registrations TO st11_app')
    app = buildApp({
      webRoot: '/nonexistent-web-root',
      logger: createLogger({ write: (line: string) => void log.push(line) }, 'info'),
      store: createPgStore(new pg.Pool({ connectionString: scopedUrl(DATABASE_URL ?? '', 'st11_app') })),
    })
  }, 30_000)

  afterAll(async () => {
    await app?.close()
    await admin?.query('DROP SCHEMA IF EXISTS st11_registrations CASCADE')
    await admin?.query('DROP ROLE IF EXISTS st11_app')
    await admin?.end()
  })

  beforeEach(async () => {
    before = await rowCount()
  })

  it('a missing email adds no row @criterion:AC-1', async () => {
    const res = await post(JSON.stringify({ firstName: 'Jane', lastName: 'Doe', phone: '4155550132' }))
    expect(res.statusCode).toBe(400)
    expect(res.json().fields.email).toHaveLength(1)
    expect(await rowCount()).toBe(before)
  })

  it('several invalid fields add no row @criterion:AC-2', async () => {
    const res = await post(JSON.stringify({ firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '5550132' }))
    expect(res.statusCode).toBe(400)
    expect(Object.keys(res.json().fields).sort()).toEqual(['email', 'phone'])
    expect(await rowCount()).toBe(before)
  })

  it.each([
    ['malformed JSON', '{firstName:'],
    ['an extra "id": 5', JSON.stringify({ ...VALID, id: 5 })],
  ])('%s adds no row @criterion:AC-3', async (_name, payload) => {
    const res = await post(payload)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: {} })
    expect(await rowCount()).toBe(before)
  })

  it.each([
    ['text/plain', JSON.stringify(VALID), { 'content-type': 'text/plain' }, 415],
    ['a 5 KB body', JSON.stringify({ ...VALID, lastName: 'x'.repeat(5120) }), {}, 413],
    ['cross-site', JSON.stringify(VALID), { 'sec-fetch-site': 'cross-site' }, 403],
  ])('%s answers %i and adds no row @criterion:AC-4', async (_name, payload, headers, status) => {
    expect((await post(payload, headers)).statusCode).toBe(status)
    expect(await rowCount()).toBe(before)
  })

  it('a valid registration adds one row holding the normalised values @criterion:AC-1', async () => {
    const res = await post(
      JSON.stringify({ firstName: ' Jane ', lastName: 'Doe', email: 'jane.doe@example.com ', phone: '(415) 555-0132' }),
    )
    expect(res.statusCode).toBe(201)
    expect(await rowCount()).toBe(before + 1)
    const { rows } = await admin.query('SELECT id, first_name, last_name, email, phone FROM registrations ORDER BY created_at DESC LIMIT 1')
    expect(rows[0]).toMatchObject({ first_name: 'Jane', last_name: 'Doe', email: VALID.email, phone: VALID.phone })
    expect(res.body).not.toContain(String(rows[0]?.id))
  })

  it('the same registration sent twice is kept twice @criterion:AC-1', async () => {
    expect((await post(JSON.stringify(VALID))).statusCode).toBe(201)
    expect((await post(JSON.stringify(VALID))).statusCode).toBe(201)
    expect(await rowCount()).toBe(before + 2)
  })

  it('a save the database refuses answers 500 and logs only SQLSTATE 42501 @criterion:AC-5', async () => {
    await admin.query('REVOKE INSERT ON registrations FROM st11_app')
    try {
      log.length = 0
      const res = await post(JSON.stringify({ ...VALID, email: 'revoked-sentinel@example.com' }))
      expect(res.statusCode).toBe(500)
      expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
      const events = log.map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(events.filter((e) => e.msg === 'request.failed')).toEqual([expect.objectContaining({ code: '42501' })])
      expect(res.body + log.join('')).not.toMatch(/revoked-sentinel|permission|registrations/)
    } finally {
      await admin.query('GRANT INSERT ON registrations TO st11_app')
    }
    expect(await rowCount()).toBe(before)
  })

  it('start() writes to the configured database and closes its pool @criterion:AC-1', async () => {
    const served = await start({ port: 0, host: '127.0.0.1', webRoot: '/nonexistent-web-root', databaseUrl: scopedUrl(DATABASE_URL ?? '') })
    try {
      const res = await served.inject({
        method: 'POST',
        url: '/api/registrations',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(VALID),
      })
      expect(res.statusCode).toBe(201)
      expect(await rowCount()).toBe(before + 1)
    } finally {
      await served.close()
    }
  })
})
