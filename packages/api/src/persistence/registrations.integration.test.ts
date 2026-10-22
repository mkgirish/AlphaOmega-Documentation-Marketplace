import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp, start } from '../main.js'
import { logger } from '../observability/index.js'
import { openDatabase, type Database } from './database.js'
import { migrate } from './migrate.js'
import { createRegistrationRepository } from './repository.js'

// ST-2 against a real PostgreSQL (AGENTX_TEST_DATABASE_URL, skipped when unset): the
// committed migrations, the INSERT-only app and SELECT-only reader roles, and rows that
// arrive trimmed, normalised and stamped in whole UTC seconds. Each run gets its own schema.
const BASE_URL = process.env.AGENTX_TEST_DATABASE_URL || undefined
const SCHEMA = `st2_${randomBytes(6).toString('hex')}`
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const NO_WEB_ROOT = '/nonexistent-web-root'

function urlFor(options: string): string {
  const url = new URL(BASE_URL ?? 'postgresql://unset')
  url.searchParams.set('options', options)
  return url.toString()
}

const SCHEMA_URL = urlFor(`-c search_path=${SCHEMA}`)

describe.skipIf(BASE_URL === undefined)('registrations in PostgreSQL', () => {
  let admin: pg.Client
  let database: Database

  async function count(): Promise<number> {
    const { rows } = await admin.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${SCHEMA}.registrations`)
    return Number(rows[0]?.n)
  }

  async function newest(): Promise<Record<string, unknown> | undefined> {
    const { rows } = await admin.query(
      `SELECT first_name, last_name, email, phone, created_at FROM ${SCHEMA}.registrations ORDER BY created_at DESC LIMIT 1`,
    )
    return rows[0]
  }

  /** Runs one statement as a role inside a rolled-back transaction; returns the SQLSTATE or 'ok'. */
  async function asRole(role: string, statement: string): Promise<string> {
    const client = new pg.Client({ connectionString: SCHEMA_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL ROLE ${role}`)
      await client.query(statement)
      return 'ok'
    } catch (err) {
      return (err as { code?: string }).code ?? 'unknown'
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
    }
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: BASE_URL })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${SCHEMA}`)
    database = openDatabase(SCHEMA_URL)
    await migrate(database.pool)
    // A non-superuser test login needs membership to SET ROLE to the roles it just created.
    await admin.query('GRANT registrations_app, registrations_reader TO CURRENT_USER').catch(() => undefined)
  }, 30_000)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await database?.close()
    await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await admin?.end()
  })

  describe('the committed migrations @story:ST-2 @criterion:AC-3', () => {
    it('create the four visitor columns and a text created_at, and re-running applies nothing', async () => {
      const { rows } = await admin.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'registrations' ORDER BY column_name`,
        [SCHEMA],
      )
      expect(rows).toEqual([
        { column_name: 'created_at', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'first_name', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'last_name', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'phone', data_type: 'text', is_nullable: 'NO' },
      ])
      expect(await migrate(database.pool)).toEqual([])
    })

    it('refuse a created_at that is not whole UTC seconds and a phone that is not normalised', async () => {
      const insert = (createdAt: string, phone: string) =>
        admin
          .query(
            `INSERT INTO ${SCHEMA}.registrations (first_name, last_name, email, phone, created_at) VALUES ('a', 'b', 'c@d.ef', $1, $2)`,
            [phone, createdAt],
          )
          .then(
            () => 'ok',
            (err: { code?: string }) => err.code,
          )
      await admin.query('BEGIN')
      try {
        expect(await insert('2026-10-20T14:03:27.123Z', '4155550132')).toBe('23514')
      } finally {
        await admin.query('ROLLBACK')
      }
      await admin.query('BEGIN')
      try {
        expect(await insert('2026-10-20T14:03:27Z', '(415) 555-0132')).toBe('23514')
      } finally {
        await admin.query('ROLLBACK')
      }
    })
  })

  describe('least-privilege roles @story:ST-2 @criterion:AC-2', () => {
    const insert = `INSERT INTO registrations (first_name, last_name, email, phone, created_at)
                    VALUES ('Jane', 'Doe', 'jane.doe@example.com', '4155550132', '2026-10-20T14:03:27Z')`

    it('lets the app role INSERT and nothing else', async () => {
      expect(await asRole('registrations_app', insert)).toBe('ok')
      expect(await asRole('registrations_app', `${insert} RETURNING id`)).toBe('42501')
      expect(await asRole('registrations_app', 'SELECT COUNT(*) FROM registrations')).toBe('42501')
      expect(await asRole('registrations_app', "UPDATE registrations SET first_name = 'x'")).toBe('42501')
      expect(await asRole('registrations_app', 'DELETE FROM registrations')).toBe('42501')
      expect(await asRole('registrations_app', 'TRUNCATE registrations')).toBe('42501')
    })

    it('lets the reader role SELECT and nothing else', async () => {
      expect(await asRole('registrations_reader', 'SELECT COUNT(*) FROM registrations')).toBe('ok')
      expect(await asRole('registrations_reader', insert)).toBe('42501')
      expect(await asRole('registrations_reader', 'DELETE FROM registrations')).toBe('42501')
    })
  })

  describe('one valid submission adds exactly one row @story:ST-2 @criterion:AC-2', () => {
    it('raises the row count by exactly 1, and a duplicate is a second visit', async () => {
      const app = buildApp({ webRoot: NO_WEB_ROOT, repository: createRegistrationRepository(database.db) })
      try {
        const before = await count()
        const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: VALID })
        expect(res.statusCode).toBe(201)
        expect(await count()).toBe(before + 1)
        expect((await app.inject({ method: 'POST', url: '/api/registrations', payload: VALID })).statusCode).toBe(201)
        expect(await count()).toBe(before + 2)
      } finally {
        await app.close()
      }
    })

    it('stores no row for a refused submission', async () => {
      const app = buildApp({ webRoot: NO_WEB_ROOT, repository: createRegistrationRepository(database.db) })
      try {
        const before = await count()
        const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: { ...VALID, phone: '+1' } })
        expect(res.statusCode).toBe(400)
        expect(await count()).toBe(before)
      } finally {
        await app.close()
      }
    })
  })

  describe('the stored row is trimmed, normalised and timestamped in UTC @story:ST-2 @criterion:AC-3', () => {
    it('stores Jane / Doe / jane.doe@example.com / 4155550132 and the created_at the 201 returned', async () => {
      // Start empty so the one row read back is the one this request wrote.
      await admin.query(`TRUNCATE ${SCHEMA}.registrations`)
      const app = buildApp({ webRoot: NO_WEB_ROOT, repository: createRegistrationRepository(database.db) })
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/registrations',
          payload: { firstName: ' Jane ', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' },
        })
        expect(res.statusCode).toBe(201)
        const body = res.json() as { firstName: string; createdAt: string }
        expect(body.firstName).toBe('Jane')
        const row = await newest()
        expect(row).toEqual({
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane.doe@example.com',
          phone: '4155550132',
          created_at: body.createdAt,
        })
        expect(row?.created_at).toMatch(UTC_SECONDS)
        expect(res.body).not.toMatch(/"id"/)
      } finally {
        await app.close()
      }
    })
  })

  describe('a refused insert @story:ST-2 @criterion:AC-5', () => {
    it('answers 500 and logs SQLSTATE 42501 when the connection may not INSERT', async () => {
      const calls: unknown[][] = []
      vi.spyOn(logger, 'error').mockImplementation(((...args: unknown[]) => calls.push(args)) as never)
      const readOnly = openDatabase(urlFor(`-c search_path=${SCHEMA} -c role=registrations_reader`))
      const app = buildApp({ webRoot: NO_WEB_ROOT, repository: createRegistrationRepository(readOnly.db) })
      try {
        const before = await count()
        const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: VALID })
        expect(res.statusCode).toBe(500)
        expect(res.json()).toEqual({ error: 'internal' })
        expect(calls).toContainEqual([{ sqlstate: '42501' }, 'db.insert_failed'])
        expect(JSON.stringify(calls)).not.toContain('jane.doe@example.com')
        expect(await count()).toBe(before)
      } finally {
        await app.close()
        await readOnly.close()
      }
    })
  })

  describe('start() with DATABASE_URL @story:ST-2 @criterion:AC-1', () => {
    it('applies the migrations, saves over HTTP and closes its pool', async () => {
      const app = await start({ port: 0, host: '127.0.0.1', webRoot: NO_WEB_ROOT, databaseUrl: SCHEMA_URL })
      try {
        const address = app.server.address()
        if (address === null || typeof address === 'string') throw new Error('no TCP address')
        const before = await count()
        const res = await fetch(`http://127.0.0.1:${address.port}/api/registrations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(VALID),
        })
        expect(res.status).toBe(201)
        expect(await res.json()).toEqual({ firstName: 'Jane', createdAt: expect.stringMatching(UTC_SECONDS) })
        expect(await count()).toBe(before + 1)
      } finally {
        await app.close()
      }
    })
  })
})
