import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp, start } from '../main.js'
import { logger } from '../observability/index.js'
import { createPgStore } from './store.js'

// ST-2 AC-2, AC-3 and the persistence-and-roles anchors against a real PostgreSQL: the
// committed migrations apply, the app role may only INSERT, the reader may only SELECT,
// one submission adds exactly one trimmed row with a whole-second UTC created_at, and an
// insert the database refuses answers 500 with its SQLSTATE logged. Skips without a database.
const url = process.env.AGENTX_TEST_DATABASE_URL
const SCHEMA_OPTION = '-c search_path=st2_registrations_it'
const MIGRATIONS = new URL('../../drizzle/', import.meta.url)
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const JANE = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

let admin: pg.Pool
let appPool: pg.Pool
let reader: pg.Pool

function poolAs(role?: string): pg.Pool {
  const options = role === undefined ? SCHEMA_OPTION : `${SCHEMA_OPTION} -c role=${role}`
  return new pg.Pool({ connectionString: url, options, max: 2 })
}

async function count(): Promise<number> {
  const { rows } = await reader.query<{ n: string }>('SELECT COUNT(*) AS n FROM registrations')
  return Number(rows[0]?.n)
}

async function sqlstateOf(pool: pg.Pool, sql: string): Promise<string | undefined> {
  try {
    await pool.query(sql)
    return undefined
  } catch (err) {
    return (err as { code?: string }).code
  }
}

function submit(body: unknown) {
  const app = buildApp({ webRoot: '/nonexistent-web-root', store: createPgStore(appPool) })
  return app
    .inject({
      method: 'POST',
      url: '/api/registrations',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    })
    .finally(() => app.close())
}

describe.skipIf(url === undefined)('registrations in PostgreSQL @story:ST-2 @criterion:AC-2 @criterion:AC-3', () => {
  beforeAll(async () => {
    admin = poolAs()
    await admin.query('DROP SCHEMA IF EXISTS st2_registrations_it CASCADE')
    await admin.query('CREATE SCHEMA st2_registrations_it')
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    // Applied twice: reusing an existing cluster re-runs the committed files harmlessly.
    for (const file of [...files, ...files]) {
      await admin.query(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
    }
    // Lets a non-superuser test login act as both roles; a no-op for a superuser.
    await admin.query('GRANT registrations_app, registrations_reader TO CURRENT_USER')
    appPool = poolAs('registrations_app')
    reader = poolAs('registrations_reader')
    // Warm the first-use compilation of Fastify and drizzle outside any test's timeout.
    await submit(JANE)
  }, 30_000)

  afterAll(async () => {
    await appPool?.end()
    await reader?.end()
    await admin?.query('DROP SCHEMA IF EXISTS st2_registrations_it CASCADE')
    await admin?.end()
  })

  it('lets the app role INSERT and nothing else', async () => {
    await createPgStore(appPool).insert({ ...JANE, createdAt: '2026-10-20T14:03:27Z' })
    expect(await sqlstateOf(appPool, 'SELECT * FROM registrations')).toBe('42501')
    expect(await sqlstateOf(appPool, "UPDATE registrations SET first_name = 'X'")).toBe('42501')
    expect(await sqlstateOf(appPool, 'DELETE FROM registrations')).toBe('42501')
    expect(await sqlstateOf(appPool, 'TRUNCATE registrations')).toBe('42501')
  })

  it('lets the reader role SELECT and nothing else', async () => {
    expect(await count()).toBeGreaterThanOrEqual(0)
    const insert =
      "INSERT INTO registrations (first_name, last_name, email, phone, created_at) VALUES ('a', 'b', 'c', 'd', '2026-10-20T14:03:27Z')"
    expect(await sqlstateOf(reader, insert)).toBe('42501')
    expect(await sqlstateOf(reader, 'DELETE FROM registrations')).toBe('42501')
    expect(await sqlstateOf(reader, "UPDATE registrations SET first_name = 'X'")).toBe('42501')
    expect(await sqlstateOf(reader, 'TRUNCATE registrations')).toBe('42501')
  })

  it('grants exactly INSERT to the app role and exactly SELECT to the reader', async () => {
    const { rows } = await admin.query(
      'SELECT grantee, privilege_type FROM information_schema.role_table_grants' +
        " WHERE table_schema = 'st2_registrations_it' AND table_name = 'registrations'" +
        " AND grantee IN ('registrations_app', 'registrations_reader', 'PUBLIC') ORDER BY grantee, privilege_type",
    )
    expect(rows).toEqual([
      { grantee: 'registrations_app', privilege_type: 'INSERT' },
      { grantee: 'registrations_reader', privilege_type: 'SELECT' },
    ])
  })

  it('refuses a created_at that is not whole UTC seconds', async () => {
    const insert = createPgStore(appPool).insert({ ...JANE, createdAt: '2026-10-20 14:03:27+00' })
    await expect(insert).rejects.toMatchObject({ code: '23514' })
  })

  it('adds exactly one row per valid submission', async () => {
    const before = await count()
    const res = await submit(JANE)
    expect(res.statusCode).toBe(201)
    expect(await count()).toBe(before + 1)
  })

  it('stores the trimmed, normalised row with a whole-second UTC created_at', async () => {
    const before = Date.now()
    const res = await submit({ ...JANE, firstName: ' Jane ', lastName: ' Doe-AC3 ', phone: '(415) 555-0132' })
    expect(res.statusCode).toBe(201)
    const { rows } = await reader.query(
      'SELECT id, first_name, last_name, email, phone, created_at FROM registrations WHERE last_name = $1',
      ['Doe-AC3'],
    )
    expect(rows).toHaveLength(1)
    const row = rows[0] as Record<string, string>
    expect(row).toMatchObject({ first_name: 'Jane', last_name: 'Doe-AC3', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(row.created_at).toMatch(UTC_SECONDS)
    const at = Date.parse(row.created_at ?? '')
    expect(at).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000)
    expect(at).toBeLessThanOrEqual(Date.now())
    expect(res.json()).toEqual({ firstName: 'Jane', createdAt: row.created_at })
    expect(res.body).not.toContain(row.id)
  })

  it('stores two rows for two identical submissions', async () => {
    const before = await count()
    const responses = await Promise.all([submit(JANE), submit(JANE)])
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201])
    expect(await count()).toBe(before + 2)
  })

  it('answers 500 and logs SQLSTATE 42501 when INSERT is revoked', async () => {
    const error = vi.spyOn(logger, 'error')
    await admin.query('REVOKE INSERT ON registrations FROM registrations_app')
    try {
      const before = await count()
      const res = await submit(JANE)
      expect(res.statusCode).toBe(500)
      expect(res.json()).toEqual({ error: 'internal' })
      expect(res.body).not.toMatch(/permission|registrations_app|Jane/)
      expect(error).toHaveBeenCalledWith({ event: 'db.insert_failed', sqlstate: '42501' }, 'db.insert_failed')
      expect(await count()).toBe(before)
    } finally {
      await admin.query('GRANT INSERT ON registrations TO registrations_app')
      error.mockRestore()
    }
  })

  it('start() writes through DATABASE_URL and closes its pool', async () => {
    const databaseUrl = new URL(url ?? '')
    databaseUrl.searchParams.set('options', `${SCHEMA_OPTION} -c role=registrations_app`)
    const app = await start({ port: 0, host: '127.0.0.1', webRoot: '/nonexistent-web-root', databaseUrl: databaseUrl.href })
    try {
      const address = app.server.address()
      if (address === null || typeof address === 'string') throw new Error('no TCP address')
      const before = await count()
      const res = await fetch(`http://127.0.0.1:${address.port}/api/registrations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(JANE),
      })
      expect(res.status).toBe(201)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(await count()).toBe(before + 1)
    } finally {
      await app.close()
    }
  })
})

describe('start() without a database @story:ST-2 @criterion:AC-5', () => {
  it('logs startup.db_unavailable and answers POST with 500', async () => {
    const error = vi.spyOn(logger, 'error')
    const app = await start({ port: 0, host: '127.0.0.1', webRoot: '/nonexistent-web-root' })
    try {
      expect(error).toHaveBeenCalledWith({ event: 'startup.db_unavailable' }, 'startup.db_unavailable')
      const res = await app.inject({
        method: 'POST',
        url: '/api/registrations',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(JANE),
      })
      expect(res.statusCode).toBe(500)
      expect(res.json()).toEqual({ error: 'internal' })
      expect(error).toHaveBeenCalledWith({ event: 'db.insert_failed', sqlstate: 'store_unavailable' }, 'db.insert_failed')
    } finally {
      await app.close()
      error.mockRestore()
    }
  })

  it('answers 500 when the configured database cannot be reached', async () => {
    const error = vi.spyOn(logger, 'error')
    const app = await start({
      port: 0,
      host: '127.0.0.1',
      webRoot: '/nonexistent-web-root',
      databaseUrl: 'postgres://nobody@127.0.0.1:1/registrations',
    })
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/registrations',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(JANE),
      })
      expect(res.statusCode).toBe(500)
      expect(res.json()).toEqual({ error: 'internal' })
      expect(error).not.toHaveBeenCalledWith({ event: 'startup.db_unavailable' }, 'startup.db_unavailable')
      expect(error).toHaveBeenCalledWith({ event: 'db.insert_failed', sqlstate: 'ECONNREFUSED' }, 'db.insert_failed')
    } finally {
      await app.close()
      error.mockRestore()
    }
  })
})
