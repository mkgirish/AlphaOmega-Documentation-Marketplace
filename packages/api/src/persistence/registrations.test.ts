import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { buildApp, start } from '../main.js'
import { migrate, pgRegistrations } from './registrations.js'

// ST-8 AC-1, AC-2, AC-3 and AC-8 against the real PostgreSQL the sandbox provides: the
// phone the API accepts is stored as ten digits, and a rejected one adds no row.
const url = process.env.AGENTX_TEST_DATABASE_URL
const NO_WEB_ROOT = '/nonexistent-web-root'
const VALID = { fullName: 'Grace Hopper', email: 'grace@example.com' }
const UNREACHABLE = 'postgres://nobody@127.0.0.1:1/none'
// Each test writes under its own address, so other writers to the table cannot move its counts.
const marker = (): string => `grace+${randomUUID()}@example.com`

describe('loadConfig reads DATABASE_URL @story:ST-8', () => {
  it('leaves the database unset by default and takes it from DATABASE_URL', () => {
    expect(loadConfig({}).databaseUrl).toBeUndefined()
    expect(loadConfig({ DATABASE_URL: 'postgres://x@db/y' }).databaseUrl).toBe('postgres://x@db/y')
  })

  it('start() fails, and releases its pool, when the database cannot be reached', async () => {
    await expect(start({ port: 0, host: '127.0.0.1', webRoot: NO_WEB_ROOT, databaseUrl: UNREACHABLE })).rejects.toThrow()
  })

  it('an insert fails, rather than hangs or succeeds, when the database cannot be reached', async () => {
    const pool = new pg.Pool({ connectionString: UNREACHABLE })
    try {
      await expect(pgRegistrations(pool).insert({ ...VALID, phone: '4155550132', createdAt: new Date() })).rejects.toThrow()
      await expect(migrate(pool)).rejects.toThrow()
    } finally {
      await pool.end()
    }
  })
})

describe.skipIf(!url)('registrations in PostgreSQL @story:ST-8', () => {
  let pool: pg.Pool
  let app: FastifyInstance

  const rows = async (email: string) =>
    (
      await pool.query<{ phone: string; full_name: string; email: string; created_at: Date }>(
        'SELECT phone, full_name, email, created_at FROM registrations WHERE email = $1',
        [email],
      )
    ).rows

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url })
    await migrate(pool)
    // Migrations are idempotent: a restart re-applies them without failing.
    await migrate(pool)
    app = buildApp({ webRoot: NO_WEB_ROOT, registrations: pgRegistrations(pool) })
  }, 30_000)

  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

  it.each(['4155550132', '(415) 555-0132', '415.555.0132'])('stores %j as phone 4155550132 @criterion:AC-1', async (phone) => {
    const email = marker()
    const res = await app.inject({
      method: 'POST',
      url: '/api/registrations',
      payload: { fullName: '  Grace   Hopper ', email: ` ${email} `, phone },
    })
    expect(res.statusCode).toBe(201)
    const stored = await rows(email)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ phone: '4155550132', full_name: 'Grace Hopper', email })
    expect((stored[0]?.created_at.getTime() ?? 1) % 1000).toBe(0)
  })

  it.each([
    'abc123',
    '5550132',
    '41555501329',
    '0155550132',
    '+44 20 7946 0958',
    '+1 415 555 0132',
    '1-415-555-0132',
    '4150550132',
    '4151550132',
    '1155550132',
  ])('rejects %j with 400 for phone and adds no row @criterion:AC-8', async (phone) => {
    const email = marker()
    const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: { ...VALID, email, phone } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.fields).toEqual([expect.objectContaining({ path: 'phone' })])
    expect(await rows(email)).toEqual([])
  })

  it('refuses a phone column value that is not ten NANP digits at the database too', async () => {
    const email = marker()
    await expect(pgRegistrations(pool).insert({ ...VALID, email, phone: '+14155550132', createdAt: new Date() })).rejects.toMatchObject({
      code: '23514',
    })
    expect(await rows(email)).toEqual([])
  })

  it('start() connects to DATABASE_URL, migrates and stores through the listening server', async () => {
    const email = marker()
    const server = await start({ port: 0, host: '127.0.0.1', webRoot: NO_WEB_ROOT, databaseUrl: url })
    try {
      const address = server.server.address()
      if (address === null || typeof address === 'string') throw new Error('no TCP address')
      const res = await fetch(`http://127.0.0.1:${address.port}/api/registrations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...VALID, email, phone: '(415) 555-0132' }),
      })
      expect(res.status).toBe(201)
      expect((await rows(email)).map((row) => row.phone)).toEqual(['4155550132'])
    } finally {
      await server.close()
    }
  })
})
