import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// ST-2 (CMP-4): the committed migrations create the visitor registrations table the
// story stores into, with the app role able only to INSERT and the reader role only to
// SELECT (AC-2, AC-3). Each run migrates a throwaway database on the disposable cluster.
const MIGRATIONS = fileURLToPath(new URL('..', import.meta.url))
const DATABASE_URL = process.env.AGENTX_TEST_DATABASE_URL
const ISO_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const APP = 'registrations_app'
const READER = 'registrations_reader'
const INSUFFICIENT_PRIVILEGE = '42501'
const CHECK_VIOLATION = '23514'
const NOT_NULL_VIOLATION = '23502'

const JANE = { first_name: 'Jane', last_name: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const INSERT_JANE = 'INSERT INTO registrations (first_name, last_name, email, phone) VALUES ($1, $2, $3, $4)'
const janeValues = (overrides: Partial<typeof JANE> = {}) => {
  const row = { ...JANE, ...overrides }
  return [row.first_name, row.last_name, row.email, row.phone]
}

const databaseUrl = (name: string) => {
  const url = new URL(DATABASE_URL ?? 'postgresql://unset')
  url.pathname = `/${name}`
  return url.toString()
}

const sqlState = async (work: Promise<unknown>): Promise<string | undefined> => {
  try {
    await work
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

const applyMigrations = async (client: pg.Client) => {
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
}

// The journal is what drizzle's migrator replays, so it is checked even where no database is.
describe('CMP-4 migration journal', () => {
  it('lists every committed .sql file in the drizzle journal, in order, and nothing else', () => {
    const journal = JSON.parse(readFileSync(new URL('../meta/_journal.json', import.meta.url), 'utf8')) as {
      dialect: string
      entries: { idx: number; tag: string; when: number; breakpoints: boolean }[]
    }
    const files = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => file.replace(/\.sql$/, ''))
    expect(journal.dialect).toBe('postgresql')
    expect(journal.entries.map((entry) => entry.tag)).toEqual(files)
    expect(journal.entries.map((entry) => entry.idx)).toEqual(files.map((_, index) => index))
    const whens = journal.entries.map((entry) => entry.when)
    expect(whens).toEqual([...whens].sort((a, b) => a - b))
    expect(new Set(whens).size).toBe(whens.length)
    expect(journal.entries.every((entry) => entry.breakpoints)).toBe(true)
  })
})

describe.skipIf(DATABASE_URL === undefined)('CMP-4 migrations against PostgreSQL', () => {
  const created: string[] = []
  let admin: pg.Client
  let db: pg.Client
  let migrationError: unknown

  const createDatabase = async () => {
    const name = `st2_${randomBytes(6).toString('hex')}`
    await admin.query(`CREATE DATABASE ${name}`)
    created.push(name)
    const client = new pg.Client({ connectionString: databaseUrl(name) })
    await client.connect()
    return client
  }

  // Run one statement as a role, the way the API and the psql reader connect.
  const as = async <T extends pg.QueryResultRow = pg.QueryResultRow>(role: string, text: string, values: unknown[] = []) => {
    await db.query(`SET ROLE ${role}`)
    try {
      return await db.query<T>(text, values)
    } finally {
      await db.query('RESET ROLE')
    }
  }

  const count = async () => Number((await as<{ count: string }>(READER, 'SELECT COUNT(*) FROM registrations')).rows[0].count)

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL })
    await admin.connect()
    db = await createDatabase()
    // Held, not thrown, so every test reports the failed migration as its own failure.
    migrationError = await applyMigrations(db).then(
      () => undefined,
      (error: unknown) => error,
    )
  })

  afterAll(async () => {
    await db?.end()
    for (const name of created) await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await admin?.end()
  })

  beforeEach(async () => {
    if (migrationError !== undefined) throw migrationError
    await db.query('TRUNCATE registrations')
  })

  describe('the committed migration history', () => {
    it('re-applies as a no-op on an already migrated database', async () => {
      await applyMigrations(db)
      const applied = await db.query('SELECT hash FROM drizzle.__drizzle_migrations')
      expect(applied.rowCount).toBe(readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).length)
    })

    it('migrates a second database on a cluster where the roles already exist, resetting their attributes', async () => {
      await admin.query(`ALTER ROLE ${APP} CREATEDB CREATEROLE INHERIT`)
      await admin.query(`ALTER ROLE ${READER} NOLOGIN CREATEDB`)
      const second = await createDatabase()
      try {
        await applyMigrations(second)
        const roles = await second.query<{ rolcanlogin: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolinherit: boolean }>(
          'SELECT rolcanlogin, rolcreatedb, rolcreaterole, rolinherit FROM pg_roles WHERE rolname = ANY($1)',
          [[APP, READER]],
        )
        expect(roles.rows).toEqual([
          { rolcanlogin: true, rolcreatedb: false, rolcreaterole: false, rolinherit: false },
          { rolcanlogin: true, rolcreatedb: false, rolcreaterole: false, rolinherit: false },
        ])
        const tables = await second.query("SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'registrations'")
        expect(tables.rowCount).toBe(1)
      } finally {
        await second.end()
      }
    })

    it('creates both roles able to log in, without superuser, role or database creation rights', async () => {
      const roles = await db.query<{
        rolname: string
        rolcanlogin: boolean
        rolsuper: boolean
        rolcreaterole: boolean
        rolcreatedb: boolean
      }>('SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname', [
        [APP, READER],
      ])
      expect(roles.rows).toEqual([
        { rolname: APP, rolcanlogin: true, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
        { rolname: READER, rolcanlogin: true, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
      ])
    })
  })

  describe('the registrations table', () => {
    it('holds the four visitor fields, created_at and an internal id, and no full_name', async () => {
      const columns = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'registrations' ORDER BY column_name",
      )
      expect(columns.rows).toEqual([
        { column_name: 'created_at', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'first_name', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'last_name', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'phone', data_type: 'text', is_nullable: 'NO' },
      ])
    })

    it('AC-3: stores the trimmed, normalised values exactly as the reader reads them back', async () => {
      await as(APP, INSERT_JANE, janeValues())
      const rows = await as(READER, 'SELECT first_name, last_name, email, phone FROM registrations ORDER BY created_at DESC LIMIT 1')
      expect(rows.rows).toEqual([JANE])
    })

    it('AC-3: stamps created_at in ISO 8601 UTC whole seconds when the app leaves it out', async () => {
      // Bounded by the database clock, the one that stamps the row.
      const clock = async () =>
        Number((await db.query<{ ms: string }>('SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms')).rows[0].ms)
      const before = Math.floor((await clock()) / 1000) * 1000
      await as(APP, INSERT_JANE, janeValues())
      const after = await clock()
      const { rows } = await as<{ created_at: string }>(READER, 'SELECT created_at FROM registrations')
      expect(rows[0].created_at).toMatch(ISO_UTC_SECONDS)
      const at = Date.parse(rows[0].created_at)
      expect(at).toBeGreaterThanOrEqual(before)
      expect(at).toBeLessThanOrEqual(after)
    })

    it('AC-3: keeps the UTC format whatever time zone the session uses', async () => {
      await db.query("SET TIME ZONE 'America/Los_Angeles'")
      try {
        await as(APP, INSERT_JANE, janeValues())
      } finally {
        await db.query('RESET TIME ZONE')
      }
      const { rows } = await as<{ created_at: string }>(READER, 'SELECT created_at FROM registrations')
      expect(rows[0].created_at).toMatch(ISO_UTC_SECONDS)
      expect(Math.abs(Date.parse(rows[0].created_at) - Date.now())).toBeLessThan(5000)
    })

    it('AC-3: stores a created_at the API formatted with formatUtcSeconds() unchanged', async () => {
      await as(APP, `INSERT INTO registrations (first_name, last_name, email, phone, created_at) VALUES ($1, $2, $3, $4, $5)`, [
        ...janeValues(),
        '2026-10-20T14:03:27Z',
      ])
      const { rows } = await as<{ created_at: string }>(READER, 'SELECT created_at FROM registrations')
      expect(rows).toEqual([{ created_at: '2026-10-20T14:03:27Z' }])
    })

    it('AC-3: accepts a UTC instant that falls in a local daylight-saving gap', async () => {
      await db.query("SET TIME ZONE 'America/Los_Angeles'")
      try {
        await as(APP, `INSERT INTO registrations (first_name, last_name, email, phone, created_at) VALUES ($1, $2, $3, $4, $5)`, [
          ...janeValues(),
          '2026-03-08T02:30:00Z',
        ])
      } finally {
        await db.query('RESET TIME ZONE')
      }
      const { rows } = await as<{ created_at: string }>(READER, 'SELECT created_at FROM registrations')
      expect(rows).toEqual([{ created_at: '2026-03-08T02:30:00Z' }])
    })

    it.each([
      ['fractional seconds', '2026-10-20T14:03:27.123Z'],
      ['an offset instead of Z', '2026-10-20T14:03:27+00:00'],
      ['a space separator', '2026-10-20 14:03:27Z'],
      ['no seconds', '2026-10-20T14:03Z'],
      ['an impossible date', '2026-13-40T14:03:27Z'],
      ['a day the month does not have', '2026-02-30T14:03:27Z'],
      ['a 29 February outside a leap year', '2026-02-29T14:03:27Z'],
      ['year zero', '0000-01-01T00:00:00Z'],
      ['an impossible time', '2026-10-20T25:61:61Z'],
      ['an empty string', ''],
    ])('AC-3: refuses a created_at with %s', async (_label, createdAt) => {
      const code = await sqlState(
        as(APP, `INSERT INTO registrations (first_name, last_name, email, phone, created_at) VALUES ($1, $2, $3, $4, $5)`, [
          ...janeValues(),
          createdAt,
        ]),
      )
      expect(code).toBe(CHECK_VIOLATION)
      expect(await count()).toBe(0)
    })

    it.each([
      ['an untrimmed first name', { first_name: ' Jane ' }],
      ['an untrimmed last name', { last_name: 'Doe ' }],
      ['an untrimmed email', { email: ' jane.doe@example.com' }],
      ['an empty first name', { first_name: '' }],
      ['an empty last name', { last_name: '' }],
      ['an empty email', { email: '' }],
      ['a 101-character first name', { first_name: 'J'.repeat(101) }],
      ['a 101-character last name', { last_name: 'D'.repeat(101) }],
      ['a 255-character email', { email: `${'j'.repeat(243)}@example.com` }],
      ['a formatted phone', { phone: '(415) 555-0132' }],
      ['a nine-digit phone', { phone: '415555013' }],
      ['an eleven-digit phone', { phone: '14155550132' }],
      ['a phone with letters', { phone: '415555013a' }],
    ])('refuses %s that skipped normalisation', async (_label, overrides) => {
      expect(await sqlState(as(APP, INSERT_JANE, janeValues(overrides)))).toBe(CHECK_VIOLATION)
      expect(await count()).toBe(0)
    })

    it.each([
      ['a 100-character first name', { first_name: 'J'.repeat(100) }],
      ['a 100-character last name', { last_name: 'D'.repeat(100) }],
      ['a 254-character email', { email: `${'j'.repeat(242)}@example.com` }],
      ['a name with an inner space', { first_name: 'Mary Jane' }],
      ['a one-character name', { last_name: 'D' }],
    ])('accepts %s at the boundary', async (_label, overrides) => {
      await as(APP, INSERT_JANE, janeValues(overrides))
      expect(await count()).toBe(1)
    })

    it('refuses a missing field', async () => {
      const code = await sqlState(
        as(APP, 'INSERT INTO registrations (first_name, last_name, email) VALUES ($1, $2, $3)', janeValues().slice(0, 3)),
      )
      expect(code).toBe(NOT_NULL_VIOLATION)
    })

    it('AC-2: one insert raises the row count the reader sees by exactly 1', async () => {
      const before = await count()
      await as(APP, INSERT_JANE, janeValues())
      expect(await count()).toBe(before + 1)
    })

    it('AC-4: keeps two identical submissions as two rows — duplicates are not the database’s to drop', async () => {
      await as(APP, INSERT_JANE, janeValues())
      await as(APP, INSERT_JANE, janeValues())
      expect(await count()).toBe(2)
      const ids = await db.query<{ id: string }>('SELECT DISTINCT id FROM registrations')
      expect(ids.rowCount).toBe(2)
    })
  })

  describe('the app role (registrations_app) may only INSERT', () => {
    it.each([
      ['SELECT', 'SELECT * FROM registrations'],
      ['SELECT COUNT', 'SELECT COUNT(*) FROM registrations'],
      ['UPDATE', "UPDATE registrations SET first_name = 'X'"],
      ['DELETE', 'DELETE FROM registrations'],
      ['TRUNCATE', 'TRUNCATE registrations'],
      ['INSERT … RETURNING id', `${INSERT_JANE} RETURNING id`],
      [
        'INSERT with a chosen id',
        "INSERT INTO registrations (id, first_name, last_name, email, phone) VALUES (gen_random_uuid(), 'Jane', 'Doe', 'j@example.com', '4155550132')",
      ],
      ['CREATE TABLE', 'CREATE TABLE intruder (x int)'],
      ['DROP TABLE', 'DROP TABLE registrations'],
      ['the migration journal', 'SELECT * FROM drizzle.__drizzle_migrations'],
      ['CREATE TEMP TABLE', 'CREATE TEMP TABLE intruder (x int)'],
    ])('is refused %s with SQLSTATE 42501', async (_label, statement) => {
      await as(APP, INSERT_JANE, janeValues())
      const values = statement.includes('$1') ? janeValues() : []
      expect(await sqlState(as(APP, statement, values))).toBe(INSUFFICIENT_PRIVILEGE)
      expect(await count()).toBe(1)
    })
  })

  describe('the reader role (registrations_reader) may only SELECT', () => {
    it('reads every column of every row', async () => {
      await as(APP, INSERT_JANE, janeValues())
      const { rows } = await as(READER, 'SELECT id, first_name, last_name, email, phone, created_at FROM registrations')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject(JANE)
    })

    it.each([
      ['INSERT', INSERT_JANE],
      ['UPDATE', "UPDATE registrations SET first_name = 'X'"],
      ['DELETE', 'DELETE FROM registrations'],
      ['TRUNCATE', 'TRUNCATE registrations'],
      ['CREATE TABLE', 'CREATE TABLE intruder (x int)'],
      ['DROP TABLE', 'DROP TABLE registrations'],
      ['the migration journal', 'SELECT * FROM drizzle.__drizzle_migrations'],
      ['CREATE TEMP TABLE', 'CREATE TEMP TABLE intruder (x int)'],
    ])('is refused %s with SQLSTATE 42501', async (_label, statement) => {
      await as(APP, INSERT_JANE, janeValues())
      const values = statement.includes('$1') ? janeValues() : []
      expect(await sqlState(as(READER, statement, values))).toBe(INSUFFICIENT_PRIVILEGE)
      expect(await count()).toBe(1)
    })
  })

  it('grants nothing on registrations to PUBLIC', async () => {
    const { rows } = await db.query<{ granted: boolean }>(
      "SELECT has_table_privilege('public', 'registrations', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS granted",
    )
    expect(rows).toEqual([{ granted: false }])
  })
})
