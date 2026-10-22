import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp, start } from '../main.js'
import { applyMigrations } from './migrate.js'
import { createPgStore } from './repository.js'

// ST-10 against a real PostgreSQL: the committed migrations, the repository and the route
// together store names exactly as entered and add no row for an over-long name. The file
// works in its own schema of the fresh per-run database, so no other file sees its rows.
const DATABASE_URL = process.env.AGENTX_TEST_DATABASE_URL
const NO_WEB_ROOT = '/nonexistent-web-root'
const URL = '/api/registrations'
const valid = { firstName: 'Siobhan', lastName: "O'Brien", email: 'visitor@example.com', phone: '(415) 555-0132' }
const options = '-c search_path=st10_registrations'

let admin: pg.Pool
let pool: pg.Pool
let app: FastifyInstance | undefined

async function count(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM registrations')
  return rows[0]?.n ?? -1
}

interface Row {
  first_name: string
  last_name: string
  email: string
  phone: string
  created_at: Date
}

/** The newest row; each test starts from an empty table, so it is the only one. */
async function newest(): Promise<Row | undefined> {
  const { rows } = await pool.query<Row>('SELECT first_name, last_name, email, phone, created_at FROM registrations')
  expect(rows).toHaveLength(1)
  return rows[0]
}

function post(payload: unknown) {
  app ??= buildApp({ webRoot: NO_WEB_ROOT, store: createPgStore(pool) })
  return app.inject({ method: 'POST', url: URL, payload: payload as Record<string, unknown> })
}

describe.skipIf(!DATABASE_URL)('registrations in PostgreSQL @story:ST-10', () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: DATABASE_URL, max: 1 })
    await admin.query('DROP SCHEMA IF EXISTS st10_registrations CASCADE')
    await admin.query('CREATE SCHEMA st10_registrations')
    pool = new pg.Pool({ connectionString: DATABASE_URL, options, max: 2 })
    await applyMigrations(pool)
    // Warm Fastify's first-use compilation outside any test's timeout.
    const warm = buildApp({ webRoot: NO_WEB_ROOT, store: createPgStore(pool) })
    await warm.inject({ method: 'POST', url: URL, payload: {} })
    await warm.close()
  }, 60_000)

  beforeEach(async () => {
    await pool.query('TRUNCATE registrations')
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  afterAll(async () => {
    await pool?.end()
    await admin?.query('DROP SCHEMA IF EXISTS st10_registrations CASCADE')
    await admin?.end()
  })

  it('applies the committed migrations once, so a second run changes nothing', async () => {
    await applyMigrations(pool)
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'st10_registrations' AND table_name = 'registrations' ORDER BY column_name",
    )
    expect(rows.map((r) => r.column_name)).toEqual(['created_at', 'email', 'first_name', 'id', 'last_name', 'phone'])
  })

  it.each([
    ['Siobhan', "O'Brien"],
    ['Anne-Marie', 'Dupont'],
    ['José', 'Anne-Marie'],
  ])('stores "%s" "%s" exactly as entered @criterion:AC-1', async (firstName, lastName) => {
    const res = await post({ ...valid, firstName, lastName })
    expect(res.statusCode).toBe(201)
    const row = await newest()
    expect([row?.first_name, row?.last_name]).toEqual([firstName, lastName])
    expect([row?.email, row?.phone]).toEqual([valid.email, valid.phone])
    expect(row?.created_at.getUTCMilliseconds()).toBe(0)
    expect((res.json() as { data: { createdAt: string } }).data.createdAt).toBe(row?.created_at.toISOString().replace('.000Z', 'Z'))
  })

  it('stores trimmed values', async () => {
    const res = await post({ ...valid, firstName: '  Anne-Marie ', lastName: ' Dupont\t' })
    expect(res.statusCode).toBe(201)
    const row = await newest()
    expect([row?.first_name, row?.last_name]).toEqual(['Anne-Marie', 'Dupont'])
  })

  it.each([
    ['firstName', 'first_name'],
    ['lastName', 'last_name'],
  ] as const)('stores a %s of exactly 100 characters @criterion:AC-2', async (field, column) => {
    const res = await post({ ...valid, [field]: 'é'.repeat(100) })
    expect(res.statusCode).toBe(201)
    expect((await newest())?.[column]).toBe('é'.repeat(100))
  })

  it('stores two rows for two identical submissions and never answers with a row id', async () => {
    const first = await post(valid)
    const second = await post(valid)
    expect([first.statusCode, second.statusCode]).toEqual([201, 201])
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM registrations')
    expect(rows).toHaveLength(2)
    for (const { id } of rows) {
      expect(first.body + second.body).not.toContain(id)
    }
  })

  it.each([
    ['lastName', 'Last name must be 100 characters or fewer.'],
    ['firstName', 'First name must be 100 characters or fewer.'],
  ])('answers a 101-character %s with 400 and adds no row @criterion:AC-6 @criterion:AC-3', async (field, message) => {
    const before = await count()
    const res = await post({ ...valid, [field]: 'a'.repeat(101) })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { message: 'Check the highlighted fields.', fields: [{ path: field, message }] } })
    expect(await count()).toBe(before)
  })

  it('refuses an over-long name in the table itself, whatever the caller', async () => {
    await expect(
      pool.query("INSERT INTO registrations (first_name, last_name, email, phone) VALUES ($1, 'x', 'e@x.io', '4155550132')", [
        'a'.repeat(101),
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('serves the route from start() when DATABASE_URL is configured', async () => {
    const url = new globalThis.URL(DATABASE_URL ?? '')
    url.searchParams.set('options', options)
    const started = await start({ port: 0, host: '127.0.0.1', webRoot: NO_WEB_ROOT, databaseUrl: url.toString() })
    try {
      const before = await count()
      const res = await started.inject({ method: 'POST', url: URL, payload: valid })
      expect(res.statusCode).toBe(201)
      expect(await count()).toBe(before + 1)
    } finally {
      await started.close()
    }
  })
})
