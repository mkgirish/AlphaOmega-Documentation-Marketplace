import { randomBytes } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import { openDatabase, type Database } from './database.js'
import { migrate, MIGRATIONS_DIR } from './migrate.js'
import { createRegistrationRepository } from './repository.js'

// ST-3 against a real PostgreSQL (AGENTX_TEST_DATABASE_URL, skipped when unset): a POST
// with any field blank or only whitespace answers 400 naming that field, and the
// registrations row count does not change. Each run gets its own schema.
const BASE_URL = process.env.AGENTX_TEST_DATABASE_URL || undefined
const SCHEMA = `st3_${randomBytes(6).toString('hex')}`
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const REQUIRED = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
} as const

// Only the migrations the drizzle journal lists, so a stray .sql file beside them is not applied.
function journalMigrations(): string {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[]
  }
  const directory = mkdtempSync(join(tmpdir(), 'st3-migrations-'))
  for (const { tag } of journal.entries) copyFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), join(directory, `${tag}.sql`))
  return directory
}

function schemaUrl(): string {
  const url = new URL(BASE_URL ?? 'postgresql://unset')
  url.searchParams.set('options', `-c search_path=${SCHEMA}`)
  return url.toString()
}

describe.skipIf(BASE_URL === undefined)('blank fields against PostgreSQL', () => {
  let admin: pg.Client
  let database: Database
  let app: FastifyInstance

  async function count(): Promise<number> {
    const { rows } = await admin.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${SCHEMA}.registrations`)
    return Number(rows[0]?.n)
  }

  function post(payload: unknown) {
    return app.inject({ method: 'POST', url: '/api/registrations', payload: payload as Record<string, unknown> })
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: BASE_URL })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${SCHEMA}`)
    database = openDatabase(schemaUrl())
    const migrations = journalMigrations()
    try {
      await migrate(database.pool, migrations)
    } finally {
      rmSync(migrations, { recursive: true, force: true })
    }
    app = buildApp({ webRoot: '/nonexistent-web-root', repository: createRegistrationRepository(database.db) })
    // One saved visit first, so "unchanged" is measured against a non-empty table.
    expect((await post(VALID)).statusCode).toBe(201)
  }, 30_000)

  afterAll(async () => {
    await app?.close()
    await database?.close()
    await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await admin?.end()
  })

  it.each(Object.keys(REQUIRED) as (keyof typeof REQUIRED)[])('an empty %s stores no row @story:ST-3 @criterion:AC-1', async (field) => {
    const before = await count()
    const res = await post({ ...VALID, [field]: '' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: { [field]: [REQUIRED[field]] } })
    expect(await count()).toBe(before)
  })

  it.each(Object.keys(REQUIRED) as (keyof typeof REQUIRED)[])(
    'a %s of only spaces stores no row @story:ST-3 @criterion:AC-2',
    async (field) => {
      const before = await count()
      const res = await post({ ...VALID, [field]: '   ' })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'validation', fields: { [field]: [REQUIRED[field]] } })
      expect(await count()).toBe(before)
    },
  )

  it('the Gherkin body answers 400 for lastName and leaves the row count unchanged @story:ST-3 @criterion:AC-6', async () => {
    const before = await count()
    expect(before).toBeGreaterThan(0)
    const res = await post({ firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: { lastName: [REQUIRED.lastName] } })
    expect(await count()).toBe(before)
  })

  it('an empty form stores no row and names all four fields @story:ST-3 @criterion:AC-3', async () => {
    const before = await count()
    const res = await post({ firstName: '', lastName: '', email: '', phone: '' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'validation',
      fields: Object.fromEntries(Object.entries(REQUIRED).map(([field, message]) => [field, [message]])),
    })
    expect(await count()).toBe(before)
  })
})
