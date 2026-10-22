import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import type { NewRegistration, RegistrationRepository } from '../persistence/repository.js'
import { unavailableRepository } from '../persistence/repository.js'

// ST-9 — POST /api/registrations applies the shared email rule: complete addresses are
// stored as entered, incomplete ones answer 400 with an error for "email" and store nothing.
const NO_WEB_ROOT = '/nonexistent-web-root'
const URL_PATH = '/api/registrations'
const VALID_NAME = 'Jane Doe'
const INCOMPLETE = ['jane', 'jane@', 'jane@example', '@example.com']
const SENTINEL = 'SENTINEL-4c1e'

/** An address of exactly `length` characters in local@domain.tld form. */
function emailOfLength(length: number): string {
  const domain = '@example.com'
  return 'a'.repeat(length - domain.length) + domain
}

type Schema = {
  $ref?: string
  type?: string
  required?: string[]
  additionalProperties?: boolean
  properties?: Record<string, Schema>
  items?: Schema
}
type OpenApi = {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: Schema }> }> }>>
  components: { schemas: Record<string, Schema> }
}
const openapi = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as OpenApi

function violations(value: unknown, raw: Schema, at = '$'): string[] {
  const schema = raw.$ref === undefined ? raw : openapi.components.schemas[raw.$ref.replace('#/components/schemas/', '')]
  if (schema === undefined) return [`${at}: unresolved ${raw.$ref}`]
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' ? [] : [`${at} is not a string`]
    case 'array':
      if (!Array.isArray(value)) return [`${at} is not an array`]
      return value.flatMap((item, i) => violations(item, schema.items ?? {}, `${at}[${i}]`))
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${at} is not an object`]
      const record = value as Record<string, unknown>
      const props = schema.properties ?? {}
      const missing = (schema.required ?? []).filter((k) => !(k in record)).map((k) => `${at}.${k} is missing`)
      const extra =
        schema.additionalProperties === false
          ? Object.keys(record)
              .filter((k) => !(k in props))
              .map((k) => `${at}.${k} is not allowed`)
          : []
      const nested = Object.entries(props)
        .filter(([k]) => k in record)
        .flatMap(([k, s]) => violations(record[k], s, `${at}.${k}`))
      return [...missing, ...extra, ...nested]
    }
    default:
      return []
  }
}

function expectDocumented(status: number, body: unknown): void {
  const documented = openapi.paths[URL_PATH]?.post?.responses[String(status)]
  expect(documented, `POST ${URL_PATH} ${status} is documented`).toBeDefined()
  const schema = documented?.content?.['application/json']?.schema
  expect(schema).toBeDefined()
  expect(violations(body, schema ?? {})).toEqual([])
}

function memoryRepository(): RegistrationRepository & { rows: NewRegistration[] } {
  const rows: NewRegistration[] = []
  return {
    rows,
    async insert(row) {
      rows.push(row)
    },
  }
}

let app: FastifyInstance | undefined

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT, repository: memoryRepository() })
  await warm.inject({ method: 'POST', url: URL_PATH, payload: {} })
  await warm.close()
}, 30_000)

afterEach(async () => {
  await app?.close()
  app = undefined
})

function post(repository: RegistrationRepository, payload: unknown) {
  app = buildApp({ webRoot: NO_WEB_ROOT, repository })
  return app.inject({ method: 'POST', url: URL_PATH, payload: payload as Record<string, unknown> })
}

describe('a complete email is accepted @story:ST-9 @criterion:AC-1', () => {
  it('stores "jane.doe@example.com" as entered and answers 201', async () => {
    const repository = memoryRepository()
    const res = await post(repository, { fullName: VALID_NAME, email: 'jane.doe@example.com' })
    expect(res.statusCode).toBe(201)
    expect(repository.rows).toHaveLength(1)
    expect(repository.rows[0]).toMatchObject({ fullName: VALID_NAME, email: 'jane.doe@example.com' })
    expectDocumented(201, res.json())
  })

  it('stores the row with whole-second UTC created_at and returns only that timestamp', async () => {
    const repository = memoryRepository()
    const res = await post(repository, { fullName: `  ${VALID_NAME}  `, email: ' jane.doe@example.com ' })
    expect(res.statusCode).toBe(201)
    const row = repository.rows[0]
    expect(row).toMatchObject({ fullName: VALID_NAME, email: 'jane.doe@example.com' })
    expect((row?.createdAt.getTime() ?? 1) % 1000).toBe(0)
    const body = res.json<{ data: { createdAt: string } }>()
    expect(body.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(body.data.createdAt).toBe(row?.createdAt.toISOString().replace('.000Z', 'Z'))
    expect(res.body).not.toContain('jane.doe')
    expect(res.body).not.toContain(VALID_NAME)
  })
})

describe('an incomplete email is rejected @story:ST-9 @criterion:AC-2', () => {
  it.each(INCOMPLETE)('"%s" answers 400 with an error for email and stores nothing', async (email) => {
    const repository = memoryRepository()
    const res = await post(repository, { fullName: VALID_NAME, email })
    expect(res.statusCode).toBe(400)
    const body = res.json<{ error: { message: string; fields: { path: string; message: string }[] } }>()
    expect(body.error.fields.map((field) => field.path)).toEqual(['email'])
    expect(body.error.fields[0]?.message).not.toBe('')
    expect(repository.rows).toHaveLength(0)
    expectDocumented(400, body)
  })
})

describe('an email of exactly 254 characters is accepted @story:ST-9 @criterion:AC-3', () => {
  it('stores the 254-character address as entered', async () => {
    const repository = memoryRepository()
    const email = emailOfLength(254)
    expect(email).toHaveLength(254)
    const res = await post(repository, { fullName: VALID_NAME, email })
    expect(res.statusCode).toBe(201)
    expect(repository.rows[0]?.email).toBe(email)
  })
})

describe('the API applies the same email rule to a direct JSON body @story:ST-9 @criterion:AC-5', () => {
  it.each(INCOMPLETE)('"%s" sent directly returns 400 for email, adds no row and echoes nothing', async (email) => {
    const repository = memoryRepository()
    app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ fullName: SENTINEL, email }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: { fields: { path: string }[] } }>().error.fields.some((f) => f.path === 'email')).toBe(true)
    expect(repository.rows).toHaveLength(0)
    expect(res.body).not.toContain(SENTINEL)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('a missing email is an error for email', async () => {
    const repository = memoryRepository()
    const res = await post(repository, { fullName: VALID_NAME })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: { fields: { path: string }[] } }>().error.fields.map((f) => f.path)).toEqual(['email'])
    expect(repository.rows).toHaveLength(0)
  })

  it('a body that is not an object answers 400 without fields and stores nothing', async () => {
    const repository = memoryRepository()
    app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify([SENTINEL]),
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain(SENTINEL)
    expect(repository.rows).toHaveLength(0)
    expectDocumented(400, res.json())
  })

  it('malformed JSON answers 400 in the envelope and stores nothing', async () => {
    const repository = memoryRepository()
    app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json' },
      payload: `{"email": "${SENTINEL}`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain(SENTINEL)
    expect(repository.rows).toHaveLength(0)
    expectDocumented(400, res.json())
  })

  it('a non-JSON body answers 415 in the envelope and stores nothing', async () => {
    const repository = memoryRepository()
    app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const res = await app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'text/plain' },
      payload: `email=${SENTINEL}`,
    })
    expect(res.statusCode).toBe(415)
    expect(res.body).not.toContain(SENTINEL)
    expect(repository.rows).toHaveLength(0)
    expectDocumented(415, res.json())
  })

  it('a storage failure answers 500 without detail', async () => {
    const res = await post(unavailableRepository, { fullName: VALID_NAME, email: `${SENTINEL}@example.com` })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain(SENTINEL)
    expectDocumented(500, res.json())
  })
})
