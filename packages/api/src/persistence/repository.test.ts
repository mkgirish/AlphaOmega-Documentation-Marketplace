import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import { applyMigrations } from './migrate.js'
import { createPgRepository } from './repository.js'

// ST-9 against the disposable PostgreSQL: complete emails are stored exactly as entered,
// and every rejected email leaves the registrations row count unchanged. Skips cleanly
// when the sandbox provides no database (CI may not).
const DATABASE_URL = process.env.AGENTX_TEST_DATABASE_URL
const EMAIL_MESSAGE = 'Enter an email like name@example.com.'
const emailOf = (length: number, tag: string): string => `${tag}${'a'.repeat(length - tag.length - '@example.com'.length)}@example.com`

describe.skipIf(DATABASE_URL === undefined)('registrations in PostgreSQL @story:ST-9', () => {
  let pool: pg.Pool
  let app: FastifyInstance

  beforeAll(async () => {
    await applyMigrations(DATABASE_URL ?? '')
    // Applying the committed migrations twice is harmless.
    await applyMigrations(DATABASE_URL ?? '')
    pool = new pg.Pool({ connectionString: DATABASE_URL })
    app = buildApp({ webRoot: '/nonexistent-web-root', databaseUrl: DATABASE_URL })
    await app.ready()
  }, 30_000)

  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

  async function count(email?: string): Promise<number> {
    const result =
      email === undefined
        ? await pool.query<{ n: string }>('SELECT count(*) AS n FROM registrations')
        : await pool.query<{ n: string }>('SELECT count(*) AS n FROM registrations WHERE email = $1', [email])
    return Number(result.rows[0]?.n)
  }

  const submit = (email: string) => app.inject({ method: 'POST', url: '/api/registrations', payload: { fullName: 'Jane Doe', email } })

  it('stores jane.doe@example.com as entered, with a whole-second UTC created_at @criterion:AC-1', async () => {
    const before = await count('jane.doe@example.com')
    const res = await submit('jane.doe@example.com')
    expect(res.statusCode).toBe(201)
    expect(await count('jane.doe@example.com')).toBe(before + 1)
    const newest = await pool.query<{ email: string; full_name: string; created_at: Date }>(
      'SELECT email, full_name, created_at FROM registrations WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      ['jane.doe@example.com'],
    )
    expect(newest.rows[0]?.email).toBe('jane.doe@example.com')
    expect(newest.rows[0]?.full_name).toBe('Jane Doe')
    expect(newest.rows[0]?.created_at.getTime() % 1000).toBe(0)
    expect(res.json()).toEqual({ data: { createdAt: newest.rows[0]?.created_at.toISOString().replace('.000Z', 'Z') } })
  })

  it.each(['jane', 'jane@', 'jane@example', '@example.com'])(
    'rejects %j with 400, an error for email, and an unchanged row count @criterion:AC-2 @criterion:AC-5',
    async (email) => {
      const before = await count()
      const res = await submit(email)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.fields).toEqual([{ path: 'email', message: EMAIL_MESSAGE }])
      expect(await count()).toBe(before)
    },
  )

  it('stores a 254-character email and refuses a 255-character one @criterion:AC-3', async () => {
    const tag = `t${Date.now()}`
    const accepted = emailOf(254, tag)
    const res = await submit(accepted)
    expect(res.statusCode).toBe(201)
    expect(await count(accepted)).toBe(1)

    const before = await count()
    const refused = await submit(emailOf(255, tag))
    expect(refused.statusCode).toBe(400)
    expect(await count()).toBe(before)
  })

  it('writes through the repository without returning the row', async () => {
    const repository = createPgRepository(DATABASE_URL ?? '')
    try {
      const email = `${Date.now()}.repo@example.com`
      const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000)
      await expect(repository.insert({ fullName: 'Repo Test', email, createdAt })).resolves.toBeUndefined()
      const row = await pool.query<{ created_at: Date }>('SELECT created_at FROM registrations WHERE email = $1', [email])
      expect(row.rows.map((r) => r.created_at.getTime())).toEqual([createdAt.getTime()])
    } finally {
      await repository.close()
    }
  })
})
