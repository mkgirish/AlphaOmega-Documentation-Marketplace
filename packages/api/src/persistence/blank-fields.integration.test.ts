import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import { openDatabase, type Database } from './database.js'
import { migrate } from './migrate.js'
import { createRegistrationRepository } from './repository.js'

// ST-3 AC-6 against a real PostgreSQL (AGENTX_TEST_DATABASE_URL, skipped when unset): a
// blank, spaces-only or invisible-only field leaves the registrations row count unchanged.
const BASE_URL = process.env.AGENTX_TEST_DATABASE_URL || undefined
const SCHEMA = `st3_${randomBytes(6).toString('hex')}`
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const
const BLANKS = ['', '   ', '​']

describe.skipIf(BASE_URL === undefined)('blank fields store no row @story:ST-3 @criterion:AC-6', () => {
  let admin: pg.Client
  let database: Database
  let app: FastifyInstance

  async function count(): Promise<number> {
    const { rows } = await admin.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${SCHEMA}.registrations`)
    return Number(rows[0]?.n)
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: BASE_URL })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${SCHEMA}`)
    const url = new URL(BASE_URL ?? 'postgresql://unset')
    url.searchParams.set('options', `-c search_path=${SCHEMA}`)
    database = openDatabase(url.toString())
    await migrate(database.pool)
    app = buildApp({ webRoot: '/nonexistent-web-root', repository: createRegistrationRepository(database.db) })
    await app.ready()
  }, 30_000)

  afterAll(async () => {
    await app?.close()
    await database?.close()
    await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await admin?.end()
  })

  it.each(FIELDS.flatMap((field) => BLANKS.map((blank) => [field, blank] as const)))(
    '%s holding %j answers 400 and leaves the row count unchanged',
    async (field, blank) => {
      const before = await count()
      const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: { ...VALID, [field]: blank } })
      expect(res.statusCode).toBe(400)
      expect(await count()).toBe(before)
    },
  )
})
