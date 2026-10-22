import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { migrate, openDatabase, type Database } from './database.js'
import { registrationRepository } from './registrations.js'

// ST-10 against the real PostgreSQL (never a mock): names are stored exactly as accepted,
// and the table itself refuses a name over 100 characters as a second line of defence.
const url = process.env.AGENTX_TEST_DATABASE_URL
const schema = `st10_repo_${randomBytes(4).toString('hex')}`
const VALID = { firstName: 'Siobhan', lastName: "O'Brien", email: 'siobhan@example.com', phone: '(212) 555-0142' }

let database: Database
let admin: pg.Client

async function newest(): Promise<Record<string, unknown>> {
  const res = await admin.query(`SELECT * FROM ${schema}.registrations ORDER BY created_at DESC, ctid DESC LIMIT 1`)
  return res.rows[0] as Record<string, unknown>
}

describe.skipIf(url === undefined)('the registrations table @story:ST-10', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${schema}`)
    database = openDatabase(url ?? '', { searchPath: schema })
    await migrate(database, { migrationsSchema: schema })
  }, 30_000)

  afterAll(async () => {
    await database?.close()
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin?.end()
  })

  it('migrates to first_name, last_name, email, phone and created_at, and migrating again changes nothing', async () => {
    await migrate(database, { migrationsSchema: schema })
    const res = await admin.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY column_name',
      [schema, 'registrations'],
    )
    expect(res.rows.map((r: { column_name: string }) => r.column_name)).toEqual([
      'created_at',
      'email',
      'first_name',
      'id',
      'last_name',
      'phone',
    ])
  })

  it.each([
    ['Siobhan', "O'Brien"],
    ['Anne-Marie', 'Dupont'],
    ['José', 'Anne-Marie'],
  ])('stores %s %s exactly as entered @criterion:AC-1', async (firstName, lastName) => {
    await registrationRepository(database).insert({ ...VALID, firstName, lastName }, new Date('2026-10-21T10:00:00.789Z'))
    const row = await newest()
    expect(row).toMatchObject({ first_name: firstName, last_name: lastName, email: VALID.email, phone: VALID.phone })
  })

  it('stores created_at in whole UTC seconds', async () => {
    await registrationRepository(database).insert(VALID, new Date('2030-01-02T03:04:05.678Z'))
    const res = await admin.query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS at FROM ${schema}.registrations ORDER BY created_at DESC LIMIT 1`,
    )
    expect(res.rows[0]).toEqual({ at: '2030-01-02T03:04:05.000' })
  })

  it('accepts names of exactly 100 characters, counted as characters @criterion:AC-2', async () => {
    const repo = registrationRepository(database)
    await repo.insert({ ...VALID, firstName: 'a'.repeat(100), lastName: '😀'.repeat(100) }, new Date('2031-01-01T00:00:00Z'))
    const row = await newest()
    expect(row).toMatchObject({ first_name: 'a'.repeat(100), last_name: '😀'.repeat(100) })
  })

  it.each(['firstName', 'lastName'] as const)(
    'refuses a %s of 101 characters at the table, storing nothing @criterion:AC-6',
    async (field) => {
      const before = await admin.query(`SELECT count(*)::int AS n FROM ${schema}.registrations`)
      await expect(registrationRepository(database).insert({ ...VALID, [field]: 'a'.repeat(101) }, new Date())).rejects.toMatchObject({
        code: '23514',
      })
      const after = await admin.query(`SELECT count(*)::int AS n FROM ${schema}.registrations`)
      expect(after.rows[0]).toEqual(before.rows[0])
    },
  )
})

describe('the database is configured from the environment @story:ST-10', () => {
  it('reads DATABASE_URL, and leaves it unset when absent so the screen still starts', () => {
    expect(loadConfig({}).databaseUrl).toBeUndefined()
    expect(loadConfig({ DATABASE_URL: '' }).databaseUrl).toBeUndefined()
    expect(loadConfig({ DATABASE_URL: 'postgresql://app@localhost/registrations' }).databaseUrl).toBe(
      'postgresql://app@localhost/registrations',
    )
  })
})
