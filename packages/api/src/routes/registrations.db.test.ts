import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import type { RegistrationRecord, RegistrationRepository } from '../persistence/repository.js'

// ST-3 AC-1, AC-2 and AC-6 against a real PostgreSQL: a refused POST leaves the
// registrations row count unchanged. Each run gets its own schema built from the committed
// migration and dropped afterwards. Skips cleanly when CI provides no database.
const DATABASE_URL = process.env.AGENTX_TEST_DATABASE_URL
const SCHEMA = `st3_${randomBytes(6).toString('hex')}`
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' } as const

let pool: pg.Pool
let app: FastifyInstance

// A real INSERT, so the count proves a refusal wrote nothing rather than that nothing could.
class TableRepository implements RegistrationRepository {
  async insert(record: RegistrationRecord): Promise<void> {
    await pool.query('INSERT INTO registrations (full_name, email) VALUES ($1, $2)', [
      `${record.firstName} ${record.lastName}`,
      record.email,
    ])
  }
}

async function rowCount(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) AS count FROM registrations')
  return Number(rows[0]?.count)
}

function post(payload: unknown) {
  return app.inject({ method: 'POST', url: '/api/registrations', payload: payload as Record<string, unknown> })
}

describe.skipIf(DATABASE_URL === undefined)('the registrations row count @story:ST-3', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2, options: `-c search_path=${SCHEMA}` })
    await pool.query(`CREATE SCHEMA ${SCHEMA}`)
    await pool.query(readFileSync(new URL('../../drizzle/0000_init.sql', import.meta.url), 'utf8'))
    app = buildApp({ webRoot: '/nonexistent-web-root', repository: new TableRepository() })
    await app.ready()
  }, 30_000)

  afterAll(async () => {
    await app?.close()
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await pool?.end()
  })

  it.each(['firstName', 'lastName', 'email', 'phone'])(
    'is unchanged after a POST with %s empty @criterion:AC-1 @criterion:AC-6',
    async (field) => {
      const before = await rowCount()
      const res = await post({ ...VALID, [field]: '' })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.fields).toEqual([{ path: field, message: expect.any(String) }])
      expect(await rowCount()).toBe(before)
    },
  )

  it('is unchanged after the scenario POST with a last name of spaces @criterion:AC-2 @criterion:AC-6', async () => {
    const before = await rowCount()
    const res = await post({ firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.fields.map((f: { path: string }) => f.path)).toEqual(['lastName'])
    expect(await rowCount()).toBe(before)
  })

  it('grows by one for a complete POST, so the count is a real witness @criterion:AC-6', async () => {
    const before = await rowCount()
    const res = await post(VALID)
    expect(res.statusCode).toBe(201)
    expect(await rowCount()).toBe(before + 1)
  })
})
