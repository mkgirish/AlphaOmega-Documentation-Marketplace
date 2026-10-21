import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import type { RegistrationRecord, RegistrationRepository } from '../persistence/repository.js'

// ST-3 (CMP-3): POST /api/registrations refuses any blank or spaces-only field with a 400
// naming that field, and never reaches the repository, so no row is written (AC-6).
const NO_WEB_ROOT = '/nonexistent-web-root'
const SENTINEL = 'SENTINEL-3b8e1d'
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' } as const
type Field = keyof typeof VALID

const FIELD_MESSAGES: Readonly<Record<Field, string>> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
}
const FIELDS = Object.keys(FIELD_MESSAGES) as Field[]
const UNREADABLE = { error: { message: 'The request could not be read.' } }

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; " +
  "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

class SpyRepository implements RegistrationRepository {
  readonly inserted: RegistrationRecord[] = []
  async insert(record: RegistrationRecord): Promise<void> {
    this.inserted.push(record)
  }
}

let app: FastifyInstance | undefined
let repository: SpyRepository

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT, repository: new SpyRepository() })
  await warm.inject({ method: 'POST', url: '/api/registrations', payload: VALID })
  await warm.close()
}, 30_000)

afterEach(async () => {
  await app?.close()
  app = undefined
})

async function post(payload: unknown, contentType = 'application/json') {
  repository = new SpyRepository()
  app = buildApp({ webRoot: NO_WEB_ROOT, repository })
  return app.inject({
    method: 'POST',
    url: '/api/registrations',
    headers: { 'content-type': contentType },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

function summary(count: number): string {
  return count === 1 ? '1 field needs attention. Check the messages below.' : `${count} fields need attention. Check the messages below.`
}

describe('a blank field is refused @story:ST-3 @criterion:AC-1 @criterion:AC-6', () => {
  it.each(FIELDS)('an empty %s answers 400 naming it and stores nothing', async (field) => {
    const res = await post({ ...VALID, [field]: '' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: { message: summary(1), fields: [{ path: field, message: FIELD_MESSAGES[field] }] },
    })
    expect(repository.inserted).toEqual([])
  })

  it.each(FIELDS)('a missing %s answers 400 naming it and stores nothing', async (field) => {
    const body: Record<string, string> = { ...VALID }
    delete body[field]
    const res = await post(body)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.fields).toEqual([{ path: field, message: FIELD_MESSAGES[field] }])
    expect(repository.inserted).toEqual([])
  })

  it.each([null, 42, true, ['Jane'], { value: 'Jane' }])('a %j first name answers 400 naming it', async (value) => {
    const res = await post({ ...VALID, firstName: value })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.fields).toEqual([{ path: 'firstName', message: FIELD_MESSAGES.firstName }])
    expect(repository.inserted).toEqual([])
  })

  it('an all-empty form names every field in form order with the summary count', async () => {
    const res = await post({ firstName: '', lastName: '', email: '', phone: '' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: {
        message: '4 fields need attention. Check the messages below.',
        fields: FIELDS.map((path) => ({ path, message: FIELD_MESSAGES[path] })),
      },
    })
    expect(repository.inserted).toEqual([])
  })

  it('an empty object names every field', async () => {
    const res = await post({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error.fields.map((f: { path: string }) => f.path)).toEqual(FIELDS)
    expect(repository.inserted).toEqual([])
  })

  it('two blank fields are both named and counted', async () => {
    const res = await post({ ...VALID, lastName: '', phone: '  ' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: {
        message: summary(2),
        fields: [
          { path: 'lastName', message: FIELD_MESSAGES.lastName },
          { path: 'phone', message: FIELD_MESSAGES.phone },
        ],
      },
    })
  })
})

describe('a field of only spaces counts as empty @story:ST-3 @criterion:AC-2 @criterion:AC-6', () => {
  it('the scenario body with a last name of three spaces answers 400 for lastName', async () => {
    const res = await post({ firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: { message: summary(1), fields: [{ path: 'lastName', message: FIELD_MESSAGES.lastName }] },
    })
    expect(repository.inserted).toEqual([])
  })

  it.each(
    FIELDS.flatMap((field) => ['   ', '\t', '\n\r ', '\u00a0', ' \u3000'].map((blank) => [field, JSON.stringify(blank), blank] as const)),
  )('%s holding %s answers 400 naming it', async (field, _label, blank) => {
    const res = await post({ ...VALID, [field]: blank })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.fields).toEqual([{ path: field, message: FIELD_MESSAGES[field] }])
    expect(repository.inserted).toEqual([])
  })
})

describe('a complete registration passes the blank check @story:ST-3 @criterion:AC-6', () => {
  it('stores the trimmed values once and answers 201 without echoing them or a row id', async () => {
    const res = await post({
      firstName: '  Jane ',
      lastName: ' Doe',
      email: 'jane.doe@example.com  ',
      phone: ' 4155550132 ',
    })
    expect(res.statusCode).toBe(201)
    expect(repository.inserted).toEqual([VALID])
    const body = res.json()
    expect(Object.keys(body)).toEqual(['data'])
    expect(Object.keys(body.data)).toEqual(['createdAt'])
    expect(body.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    for (const value of Object.values(VALID)) expect(res.body).not.toContain(value)
  })

  it('answers 500 with no detail when no repository is wired', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: VALID })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
  })

  it('answers 500 with no detail when the repository fails', async () => {
    app = buildApp({
      webRoot: NO_WEB_ROOT,
      repository: {
        insert: async () => {
          throw new Error(`database said: ${SENTINEL}`)
        },
      },
    })
    const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: VALID })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
    expect(res.body).not.toContain(SENTINEL)
  })
})

describe('unreadable bodies are refused without a field list @story:ST-3 @criterion:AC-6', () => {
  it.each([
    ['an unknown field', { ...VALID, [SENTINEL]: SENTINEL }],
    ['an array', [VALID]],
    ['a string', JSON.stringify('Jane')],
    ['null', 'null'],
    ['malformed JSON', `{"firstName":"${SENTINEL}"`],
  ])('%s answers 400 with the generic envelope and stores nothing', async (_name, payload) => {
    const res = await post(payload)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual(UNREADABLE)
    expect(res.body).not.toContain(SENTINEL)
    expect(repository.inserted).toEqual([])
    // The same app still accepts a complete body: only the unreadable one was refused.
    const ok = await app?.inject({ method: 'POST', url: '/api/registrations', payload: VALID })
    expect(ok?.statusCode).toBe(201)
    expect(repository.inserted).toHaveLength(1)
  })

  it('a form-encoded body answers 415 and stores nothing', async () => {
    const res = await post(`firstName=${SENTINEL}`, 'application/x-www-form-urlencoded')
    expect(res.statusCode).toBe(415)
    expect(res.json()).toEqual({ error: { message: 'Unsupported content type.' } })
    expect(res.body).not.toContain(SENTINEL)
    expect(repository.inserted).toEqual([])
  })
})

describe('refusals never echo what was sent @story:ST-3 @criterion:AC-6', () => {
  it.each(FIELDS)('a per-field sentinel stays out of the 400 when %s is blank', async (blank) => {
    const payload = Object.fromEntries(FIELDS.map((f) => [f, f === blank ? ' ' : `${SENTINEL}-${f}`]))
    const res = await post(payload)
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain(SENTINEL)
    expect(Object.keys(res.headers)).not.toContain('location')
  })

  it('carries the hardening headers and no-store on a refusal', async () => {
    const res = await post({ ...VALID, email: '' })
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-security-policy']).toBe(EXPECTED_CSP)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})

// Contract tests via inject: every status POST /api/registrations answers is documented in
// the committed openapi.json with a conforming body.
type Schema = {
  $ref?: string
  type?: string
  required?: string[]
  additionalProperties?: boolean
  properties?: Record<string, Schema>
  items?: Schema
}
type Operation = {
  requestBody?: { content?: Record<string, { schema?: Schema }> }
  responses: Record<string, { content?: Record<string, { schema?: Schema }> }>
}
type OpenApi = { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } }

const openapi = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as OpenApi

function resolveRef(raw: Schema): Schema | undefined {
  return raw.$ref === undefined ? raw : openapi.components.schemas[raw.$ref.replace('#/components/schemas/', '')]
}

function violations(value: unknown, raw: Schema, at = '$'): string[] {
  const schema = resolveRef(raw)
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

describe('POST /api/registrations honours the committed openapi.json @story:ST-3 @criterion:AC-6', () => {
  const operation = (): Operation | undefined => openapi.paths['/api/registrations']?.post

  it('documents the request body as the four required string fields and nothing else', () => {
    const schema = resolveRef(operation()?.requestBody?.content?.['application/json']?.schema ?? {})
    expect(schema?.type).toBe('object')
    expect(schema?.additionalProperties).toBe(false)
    expect([...(schema?.required ?? [])].sort()).toEqual([...FIELDS].sort())
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([...FIELDS].sort())
    expect(violations(VALID, schema ?? {})).toEqual([])
  })

  it.each([
    ['201 created', VALID, 'application/json', 201],
    ['400 blank field', { ...VALID, lastName: '  ' }, 'application/json', 400],
    ['400 unknown field', { ...VALID, extra: 'x' }, 'application/json', 400],
    ['400 malformed JSON', '{', 'application/json', 400],
    ['413 too large', { ...VALID, firstName: 'x'.repeat(20_000) }, 'application/json', 413],
    ['415 wrong type', 'firstName=Jane', 'text/plain', 415],
  ] as const)('%s is a documented status with a conforming body', async (_name, payload, contentType, status) => {
    const res = await post(payload, contentType)
    expect(res.statusCode).toBe(status)
    const documented = operation()?.responses[String(status)]?.content?.['application/json']
    expect(documented, `POST /api/registrations ${status} documented`).toBeDefined()
    expect(violations(res.json(), documented?.schema ?? {})).toEqual([])
  })

  it('documents 500 with the error envelope', () => {
    expect(operation()?.responses['500']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ErrorEnvelope',
    })
  })
})
