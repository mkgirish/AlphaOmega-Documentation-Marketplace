// CMP-4 — the committed migrations, applied the way CMP-3's supervisor applies them (the
// drizzle-orm migrator), against the disposable PostgreSQL at AGENTX_TEST_DATABASE_URL.
// Proves the ST-2 registrations shape, the INSERT-only app role and the SELECT-only reader.
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migrationsFolder = fileURLToPath(new URL('..', import.meta.url))
const databaseUrl = process.env.AGENTX_TEST_DATABASE_URL

const ISO_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

interface Journal {
  dialect: string
  entries: { idx: number; tag: string; breakpoints: boolean }[]
}

const readJournal = (): Journal => JSON.parse(readFileSync(new URL('../meta/_journal.json', import.meta.url), 'utf8')) as Journal

const sqlFiles = (): string[] =>
  readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .sort()

describe('the committed migration files', () => {
  it('lists every SQL file in the drizzle journal, in order, so the migrator applies them all', () => {
    const journal = readJournal()
    expect(journal.dialect).toBe('postgresql')
    expect(journal.entries.map((entry) => `${entry.tag}.sql`)).toEqual(sqlFiles())
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, index) => index))
    expect(journal.entries.every((entry) => entry.breakpoints)).toBe(true)
  })

  it('holds no password or secret: the roles log in over the local socket only', () => {
    for (const { tag } of readJournal().entries) {
      const text = readFileSync(new URL(`../${tag}.sql`, import.meta.url), 'utf8')
      expect(text).not.toMatch(/password|secret/i)
    }
  })
})

const errorCode = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run()
  } catch (error) {
    return (error as { code?: string }).code
  }
  return undefined
}

describe.skipIf(databaseUrl === undefined)('the migrated registrations database', () => {
  const databases: string[] = []
  let admin: pg.Client
  let db: pg.Client

  const createMigratedDatabase = async (): Promise<pg.Client> => {
    const name = `cmp4_${randomBytes(6).toString('hex')}`
    await admin.query(`CREATE DATABASE ${name}`)
    databases.push(name)
    const url = new URL(databaseUrl as string)
    url.pathname = `/${name}`
    const client = new pg.Client(url.toString())
    // DROP DATABASE … WITH (FORCE) in afterAll ends any session a failed test left open.
    client.on('error', () => undefined)
    await client.connect()
    try {
      await migrate(drizzle(client), { migrationsFolder })
    } catch (error) {
      await client.end()
      throw error
    }
    return client
  }

  /** Runs one statement as the given role inside a transaction that is always rolled back. */
  const asRole = async (role: string, text: string, values: unknown[] = []) => {
    await db.query('BEGIN')
    try {
      await db.query(`SET LOCAL ROLE ${role}`)
      return await db.query(text, values)
    } finally {
      await db.query('ROLLBACK')
    }
  }

  /** Inserts as the app role and commits, the way the repository saves one submission. */
  const insertAsApp = async (row: Record<string, string>) => {
    const columns = Object.keys(row)
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE registrations_app')
      await db.query(
        `INSERT INTO registrations (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values(row),
      )
      await db.query('COMMIT')
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    }
  }

  const insertJane = (overrides: Record<string, string> = {}) =>
    insertAsApp({
      first_name: jane.firstName,
      last_name: jane.lastName,
      email: jane.email,
      phone: jane.phone,
      ...overrides,
    })

  const readerCount = async (): Promise<number> => {
    const result = await asRole('registrations_reader', 'SELECT COUNT(*) FROM registrations;')
    return Number(result.rows[0].count)
  }

  beforeAll(async () => {
    admin = new pg.Client(databaseUrl)
    await admin.connect()
    db = await createMigratedDatabase()
  })

  afterAll(async () => {
    await db?.end()
    for (const name of databases) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await admin?.end()
  })

  it('has exactly the ST-2 columns: id, first_name, last_name, email, phone and created_at', async () => {
    const result = await db.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'registrations' ORDER BY column_name`,
    )
    expect(result.rows).toEqual([
      { column_name: 'created_at', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'first_name', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'last_name', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'phone', data_type: 'text', is_nullable: 'NO' },
    ])
  })

  it('creates both roles as plain login roles with no elevated attributes', async () => {
    const result = await db.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname IN ('registrations_app', 'registrations_reader') ORDER BY rolname`,
    )
    const plain = { rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false }
    expect(result.rows).toEqual([
      { rolname: 'registrations_app', ...plain, rolreplication: false, rolbypassrls: false },
      { rolname: 'registrations_reader', ...plain, rolreplication: false, rolbypassrls: false },
    ])
  })

  it('grants the app role INSERT and nothing else on registrations', async () => {
    const result = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'registrations_app' AND table_name = 'registrations' ORDER BY privilege_type`,
    )
    expect(result.rows.map((row) => row.privilege_type)).toEqual(['INSERT'])
  })

  it('grants the reader role SELECT and nothing else on registrations', async () => {
    const result = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'registrations_reader' AND table_name = 'registrations' ORDER BY privilege_type`,
    )
    expect(result.rows.map((row) => row.privilege_type)).toEqual(['SELECT'])
  })

  it('grants PUBLIC nothing on registrations', async () => {
    const result = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'PUBLIC' AND table_name = 'registrations'`,
    )
    expect(result.rows).toEqual([])
  })

  it('lets the app role insert one submission without RETURNING', async () => {
    const result = await asRole(
      'registrations_app',
      'INSERT INTO registrations (first_name, last_name, email, phone) VALUES ($1, $2, $3, $4)',
      [jane.firstName, jane.lastName, jane.email, jane.phone],
    )
    expect(result.rowCount).toBe(1)
  })

  it.each([
    ['SELECT', 'SELECT * FROM registrations'],
    ['SELECT COUNT', 'SELECT COUNT(*) FROM registrations'],
    ['UPDATE', "UPDATE registrations SET first_name = 'X'"],
    ['DELETE', 'DELETE FROM registrations'],
    ['TRUNCATE', 'TRUNCATE registrations'],
    [
      'INSERT … RETURNING id',
      "INSERT INTO registrations (first_name, last_name, email, phone) VALUES ('Jane', 'Doe', 'jane.doe@example.com', '4155550132') RETURNING id",
    ],
  ])('refuses the app role %s with SQLSTATE 42501', async (_name, text) => {
    expect(await errorCode(() => asRole('registrations_app', text))).toBe('42501')
  })

  it('lets the reader role count and read the newest row', async () => {
    await insertJane()
    const result = await asRole(
      'registrations_reader',
      'SELECT first_name, last_name, email, phone, created_at FROM registrations ORDER BY created_at DESC LIMIT 1',
    )
    expect(result.rows[0]).toMatchObject({ first_name: 'Jane', last_name: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(await readerCount()).toBeGreaterThan(0)
  })

  it.each([
    [
      'INSERT',
      "INSERT INTO registrations (first_name, last_name, email, phone) VALUES ('Jane', 'Doe', 'jane.doe@example.com', '4155550132')",
    ],
    ['UPDATE', "UPDATE registrations SET first_name = 'X'"],
    ['DELETE', 'DELETE FROM registrations'],
    ['TRUNCATE', 'TRUNCATE registrations'],
  ])('refuses the reader role %s with SQLSTATE 42501', async (_name, text) => {
    expect(await errorCode(() => asRole('registrations_reader', text))).toBe('42501')
  })

  it('raises the reader row count by exactly 1 for one submission (AC-2)', async () => {
    const before = await readerCount()
    await insertJane()
    expect(await readerCount()).toBe(before + 1)
  })

  it('stores two rows when the same details are submitted twice: no uniqueness on a visit', async () => {
    const before = await readerCount()
    await insertJane()
    await insertJane()
    expect(await readerCount()).toBe(before + 2)
  })

  it('stamps created_at itself as ISO 8601 UTC whole seconds when the app supplies none (AC-3)', async () => {
    const email = `stamp.${randomBytes(4).toString('hex')}@example.com`
    const startedAt = Math.floor(Date.now() / 1000) * 1000
    await insertJane({ email })
    const finishedAt = Date.now()
    const result = await asRole('registrations_reader', 'SELECT created_at FROM registrations WHERE email = $1', [email])
    const createdAt: string = result.rows[0].created_at
    expect(createdAt).toMatch(ISO_UTC_SECONDS)
    expect(Date.parse(createdAt)).toBeGreaterThanOrEqual(startedAt - 1000)
    expect(Date.parse(createdAt)).toBeLessThanOrEqual(finishedAt + 1000)
  })

  it('stamps UTC whatever the session time zone is', async () => {
    await db.query("SET TIME ZONE 'America/Los_Angeles'")
    try {
      const email = `tz.${randomBytes(4).toString('hex')}@example.com`
      await insertJane({ email })
      const result = await asRole('registrations_reader', 'SELECT created_at FROM registrations WHERE email = $1', [email])
      expect(result.rows[0].created_at).toMatch(ISO_UTC_SECONDS)
      expect(Math.abs(Date.parse(result.rows[0].created_at) - Date.now())).toBeLessThan(5000)
    } finally {
      await db.query('SET TIME ZONE UTC')
    }
  })

  it('stores the normalised AC-3 row verbatim, created_at included', async () => {
    const email = `ac3.${randomBytes(4).toString('hex')}@example.com`
    await insertJane({ email, created_at: '2026-10-20T14:03:27Z' })
    const result = await asRole(
      'registrations_reader',
      'SELECT first_name, last_name, email, phone, created_at FROM registrations WHERE email = $1',
      [email],
    )
    expect(result.rows).toEqual([{ first_name: 'Jane', last_name: 'Doe', email, phone: '4155550132', created_at: '2026-10-20T14:03:27Z' }])
  })

  it.each([
    ['fractional seconds', '2026-10-20T14:03:27.123Z'],
    ['an offset instead of Z', '2026-10-20T14:03:27+00:00'],
    ['the PostgreSQL text form', '2026-10-20 14:03:27+00'],
    ['no seconds', '2026-10-20T14:03Z'],
    ['an impossible month', '2026-13-20T14:03:27Z'],
    ['an impossible hour', '2026-10-20T24:03:27Z'],
    ['an impossible day', '2026-02-30T14:03:27Z'],
    ['an empty string', ''],
  ])('refuses a created_at with %s (SQLSTATE 23514 or 22008)', async (_name, createdAt) => {
    expect(['23514', '22008', '22007']).toContain(await errorCode(() => insertJane({ created_at: createdAt })))
  })

  it.each([
    ['first_name', ' Jane '],
    ['first_name', 'Jane '],
    ['last_name', ' Doe'],
    ['email', ' jane.doe@example.com'],
    ['first_name', ''],
    ['last_name', ''],
    ['email', ''],
    ['phone', '(415) 555-0132'],
    ['phone', '415555013'],
    ['phone', '41555501322'],
    ['phone', '+14155550132'],
  ])('refuses an un-normalised %s %j with SQLSTATE 23514', async (column, value) => {
    expect(await errorCode(() => insertJane({ [column]: value }))).toBe('23514')
  })

  it('accepts names of exactly 100 characters and refuses 101', async () => {
    await expect(insertJane({ first_name: 'a'.repeat(100), last_name: 'b'.repeat(100) })).resolves.toBeUndefined()
    expect(await errorCode(() => insertJane({ first_name: 'a'.repeat(101) }))).toBe('23514')
    expect(await errorCode(() => insertJane({ last_name: 'b'.repeat(101) }))).toBe('23514')
  })

  it('accepts an email of exactly 254 characters and refuses 255', async () => {
    const domain = '@example.com'
    await expect(insertJane({ email: 'a'.repeat(254 - domain.length) + domain })).resolves.toBeUndefined()
    expect(await errorCode(() => insertJane({ email: 'a'.repeat(255 - domain.length) + domain }))).toBe('23514')
  })

  it('re-running the migrator is a no-op', async () => {
    const before = await readerCount()
    await migrate(drizzle(db), { migrationsFolder })
    expect(await readerCount()).toBe(before)
  })

  it('migrates a second database in the same cluster where the roles already exist', async () => {
    const second = await createMigratedDatabase()
    try {
      const result = await second.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'registrations' AND grantee LIKE 'registrations_%' ORDER BY grantee`,
      )
      expect(result.rows).toEqual([
        { grantee: 'registrations_app', privilege_type: 'INSERT' },
        { grantee: 'registrations_reader', privilege_type: 'SELECT' },
      ])
    } finally {
      await second.end()
    }
  })
})
