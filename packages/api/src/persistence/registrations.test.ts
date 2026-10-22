import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import pino from 'pino'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp, start } from '../main.js'
import { createPgRegistrationStore } from './registrations.js'

// ST-11 against a real PostgreSQL: every refusal leaves the registrations row count
// unchanged, while a valid registration (the positive control) adds exactly one row.
// The committed migrations run in a schema of their own; skips cleanly when the
// disposable database is not provided.
const DATABASE_URL = process.env.AGENTX_TEST_DATABASE_URL
const ENDPOINT = '/api/registrations'
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const SEARCH_PATH = '-c search_path=st11_registrations'
const migrations = new URL('../../drizzle/', import.meta.url)
const json = { 'content-type': 'application/json' }

let admin: pg.Pool
let pool: pg.Pool
let app: FastifyInstance

async function rowCount(): Promise<number> {
  const { rows } = await admin.query<{ n: string }>('SELECT count(*) AS n FROM registrations')
  return Number(rows[0]?.n)
}

describe.skipIf(DATABASE_URL === undefined)('registrations in PostgreSQL @story:ST-11', () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: DATABASE_URL, max: 1, options: SEARCH_PATH })
    await admin.query('DROP SCHEMA IF EXISTS st11_registrations CASCADE')
    await admin.query('CREATE SCHEMA st11_registrations')
    for (const file of readdirSync(migrations)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await admin.query(readFileSync(new URL(file, migrations), 'utf8'))
    }
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2, options: SEARCH_PATH })
    app = buildApp({
      webRoot: '/nonexistent-web-root',
      registrations: createPgRegistrationStore(pool),
      logger: pino({ level: 'silent' }),
      now: () => new Date(Date.UTC(2026, 9, 22, 8, 30, 15, 987)),
    })
    await app.ready()
  }, 30_000)

  afterAll(async () => {
    await app?.close()
    await pool?.end()
    await admin?.query('DROP SCHEMA IF EXISTS st11_registrations CASCADE')
    await admin?.end()
  })

  let before: number
  beforeEach(async () => {
    before = await rowCount()
  })

  const refusals: [string, string, Record<string, string>, number][] = [
    ['a missing email @criterion:AC-1', JSON.stringify({ firstName: 'Jane', lastName: 'Doe', phone: '4155550132' }), {}, 400],
    ['several invalid fields @criterion:AC-2', JSON.stringify({ ...VALID, email: 'jane@', phone: '5550132' }), {}, 400],
    ['malformed JSON @criterion:AC-3', '{firstName:', {}, 400],
    ['an extra "id" @criterion:AC-3', JSON.stringify({ ...VALID, id: 5 }), {}, 400],
    ['text/plain @criterion:AC-4', JSON.stringify(VALID), { 'content-type': 'text/plain' }, 415],
    ['a 5 KB body @criterion:AC-4', JSON.stringify({ ...VALID, lastName: 'x'.repeat(5 * 1024) }), {}, 413],
    ['Sec-Fetch-Site cross-site @criterion:AC-4', JSON.stringify(VALID), { 'sec-fetch-site': 'cross-site' }, 403],
    ['"leak-check@bad" @criterion:AC-5', JSON.stringify({ ...VALID, email: 'leak-check@bad' }), {}, 400],
  ]

  it.each(refusals)('refusing %s leaves the row count unchanged', async (_name, payload, headers, status) => {
    const res = await app.inject({ method: 'POST', url: ENDPOINT, headers: { ...json, ...headers }, payload })
    expect(res.statusCode).toBe(status)
    expect(await rowCount()).toBe(before)
  })

  it('stores a valid registration as one trimmed row with whole-second UTC created_at, and never returns its id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: ENDPOINT,
      headers: json,
      payload: JSON.stringify({ firstName: '  Jane ', lastName: 'Doe ', email: ' jane.doe@example.com', phone: '(415) 555-0132' }),
    })
    expect(res.statusCode).toBe(201)
    expect(await rowCount()).toBe(before + 1)
    const { rows } = await admin.query(
      `SELECT id, first_name, last_name, full_name, email, phone,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at
         FROM registrations ORDER BY created_at DESC, id LIMIT 1`,
    )
    expect(rows[0]).toMatchObject({
      first_name: 'Jane',
      last_name: 'Doe',
      full_name: 'Jane Doe',
      email: 'jane.doe@example.com',
      phone: '4155550132',
      at: '2026-10-22T08:30:15.000000',
    })
    expect(res.body).not.toContain(String(rows[0]?.id))
  })

  it('keeps two rows for the same registration sent twice', async () => {
    for (const _ of [1, 2]) {
      const res = await app.inject({ method: 'POST', url: ENDPOINT, headers: json, payload: JSON.stringify(VALID) })
      expect(res.statusCode).toBe(201)
    }
    expect(await rowCount()).toBe(before + 2)
  })

  it('start() stores through DATABASE_URL and closes its pool with the server', async () => {
    const url = new URL(DATABASE_URL ?? '')
    url.searchParams.set('options', SEARCH_PATH)
    const server = await start({ port: 0, host: '127.0.0.1', webRoot: '/nonexistent-web-root', databaseUrl: url.toString() })
    try {
      const address = server.server.address()
      if (address === null || typeof address === 'string') throw new Error('no TCP address')
      const res = await fetch(`http://127.0.0.1:${address.port}${ENDPOINT}`, { method: 'POST', headers: json, body: JSON.stringify(VALID) })
      expect(res.status).toBe(201)
      expect(await rowCount()).toBe(before + 1)
    } finally {
      await server.close()
    }
  })
})
