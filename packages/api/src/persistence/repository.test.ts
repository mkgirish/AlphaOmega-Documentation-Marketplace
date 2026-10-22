import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import { createRegistrationRepository } from './repository.js'

// ST-9 against the real database: the email rule decides what reaches the registrations
// table. Needs the disposable PostgreSQL at AGENTX_TEST_DATABASE_URL; skips without it.
const DATABASE_URL = process.env.AGENTX_TEST_DATABASE_URL
const NO_WEB_ROOT = '/nonexistent-web-root'
const VALID_NAME = 'Jane Doe'

let pool: pg.Pool
let app: FastifyInstance

async function rowCount(): Promise<number> {
  const result = await pool.query<{ n: string }>('SELECT count(*) AS n FROM registrations')
  return Number(result.rows[0]?.n)
}

async function newestRow(): Promise<{ full_name: string; email: string; created_at: Date }> {
  const result = await pool.query<{ full_name: string; email: string; created_at: Date }>(
    'SELECT full_name, email, created_at FROM registrations ORDER BY created_at DESC, id DESC LIMIT 1',
  )
  const row = result.rows[0]
  if (row === undefined) throw new Error('no rows')
  return row
}

function post(email: string) {
  return app.inject({ method: 'POST', url: '/api/registrations', payload: { fullName: VALID_NAME, email } })
}

describe.skipIf(DATABASE_URL === undefined)('registrations in PostgreSQL @story:ST-9', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL })
    await pool.query(readFileSync(new URL('../../drizzle/0000_init.sql', import.meta.url), 'utf8'))
    app = buildApp({ webRoot: NO_WEB_ROOT, repository: createRegistrationRepository(pool) })
  }, 30_000)

  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

  it('stores "jane.doe@example.com" as entered @criterion:AC-1', async () => {
    const before = await rowCount()
    const res = await post('jane.doe@example.com')
    expect(res.statusCode).toBe(201)
    expect(await rowCount()).toBe(before + 1)
    const row = await newestRow()
    expect(row).toMatchObject({ full_name: VALID_NAME, email: 'jane.doe@example.com' })
    expect(row.created_at.getTime() % 1000).toBe(0)
    expect(res.json<{ data: { createdAt: string } }>().data.createdAt).toBe(row.created_at.toISOString().replace('.000Z', 'Z'))
  })

  it('stores a 254-character address as entered @criterion:AC-3', async () => {
    const email = 'a'.repeat(254 - '@example.com'.length) + '@example.com'
    const res = await post(email)
    expect(res.statusCode).toBe(201)
    expect((await newestRow()).email).toBe(email)
  })

  it.each(['jane', 'jane@', 'jane@example', '@example.com'])(
    '"%s" returns 400 for email and adds no row @criterion:AC-2 @criterion:AC-5',
    async (email) => {
      const before = await rowCount()
      const res = await post(email)
      expect(res.statusCode).toBe(400)
      expect(res.json<{ error: { fields: { path: string }[] } }>().error.fields.map((f) => f.path)).toEqual(['email'])
      expect(await rowCount()).toBe(before)
    },
  )
})
