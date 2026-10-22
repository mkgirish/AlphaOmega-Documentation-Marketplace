import { readFileSync } from 'node:fs'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../main.js'
import { logger } from '../observability/index.js'
import type { NewRegistration, RegistrationStore } from '../persistence/store.js'
import { CONTENT_SECURITY_POLICY } from '../plugins/security.js'
import { PHONE_MESSAGE } from '../registration/rules.js'
import { REGISTRATION_BODY_LIMIT, registrationCreatedSchema } from './registrations.js'

// ST-2 AC-1, AC-5, AC-6 and the envelope-contract anchors: POST /api/registrations answers
// every IF-2 status with a body that conforms to the committed openapi.json, never echoes
// a submitted value, never carries the row id, and writes nothing when a gate refuses.
type Schema = {
  $ref?: string
  type?: string
  const?: unknown
  enum?: unknown[]
  pattern?: string
  allOf?: Schema[]
  required?: string[]
  additionalProperties?: boolean
  properties?: Record<string, Schema>
  items?: Schema
}
type Media = Record<string, { schema?: Schema }>
type Operation = { responses: Record<string, { headers?: Record<string, unknown>; content?: Media }> }
type OpenApi = {
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, Schema>; headers?: Record<string, { schema: Schema }> }
}

const openapi = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as OpenApi
const post = openapi.paths['/api/registrations']?.post

function violations(value: unknown, raw: Schema, at = '$'): string[] {
  const schema = raw.$ref === undefined ? raw : openapi.components.schemas[raw.$ref.replace('#/components/schemas/', '')]
  if (schema === undefined) return [`${at}: unresolved ${raw.$ref}`]
  const own: string[] = []
  if (schema.allOf) own.push(...schema.allOf.flatMap((part) => violations(value, part, at)))
  if ('const' in schema && value !== schema.const) own.push(`${at} is not ${String(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) own.push(`${at} is not one of ${schema.enum.join(', ')}`)
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return [...own, `${at} is not a string`]
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) own.push(`${at} breaks ${schema.pattern}`)
      return own
    case 'array':
      if (!Array.isArray(value)) return [...own, `${at} is not an array`]
      return [...own, ...value.flatMap((item, i) => violations(item, schema.items ?? {}, `${at}[${i}]`))]
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [...own, `${at} is not an object`]
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
      return [...own, ...missing, ...extra, ...nested]
    }
    default:
      return own
  }
}

/** The response is a documented status, media type and header set, with a conforming body. */
function expectDocumented(res: LightMyRequestResponse): void {
  const documented = post?.responses[String(res.statusCode)]
  expect(documented, `POST /api/registrations ${res.statusCode} documented`).toBeDefined()
  const mediaType = String(res.headers['content-type']).split(';')[0] ?? ''
  const media = documented?.content?.[mediaType]
  expect(media, `${mediaType} documented for ${res.statusCode}`).toBeDefined()
  expect(violations(res.json(), media?.schema ?? {})).toEqual([])
  expect(Object.keys(documented?.headers ?? {})).toContain('Cache-Control')
  expect(res.headers['cache-control']).toBe('no-store')
}

class MemoryStore implements RegistrationStore {
  readonly rows: NewRegistration[] = []
  failure: unknown = undefined
  async insert(row: NewRegistration): Promise<void> {
    if (this.failure !== undefined) throw this.failure
    this.rows.push(row)
  }
}

const NOW = Date.UTC(2026, 9, 20, 14, 3, 27, 999)
const JANE = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const SENTINEL = 'SENTINEL-c41e'

let app: FastifyInstance | undefined
let store: MemoryStore

function appWith(limits = { perIpPerMinute: 1000, globalPerMinute: 1000 }, now = () => NOW): FastifyInstance {
  store = new MemoryStore()
  app = buildApp({ webRoot: '/nonexistent-web-root', store, rateLimits: limits, now })
  return app
}

function submit(target: FastifyInstance, body: unknown, extra: Partial<InjectOptions> = {}) {
  return target.inject({
    method: 'POST',
    url: '/api/registrations',
    headers: { 'content-type': 'application/json', ...(extra.headers ?? {}) },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
    ...(extra.remoteAddress === undefined ? {} : { remoteAddress: extra.remoteAddress }),
  })
}

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  await submit(appWith(), JANE)
  await app?.close()
}, 30_000)

afterEach(async () => {
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

describe('a valid registration is saved and confirmed @story:ST-2 @criterion:AC-1 @criterion:AC-5', () => {
  it('answers 201 with firstName and createdAt only, after the row is stored', async () => {
    const res = await submit(appWith(), JANE)
    expect(res.statusCode).toBe(201)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.json()).toEqual({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    expect(store.rows).toEqual([{ ...JANE, createdAt: '2026-10-20T14:03:27Z' }])
    expectDocumented(res)
  })

  it('answers with the normalised first name and stores the normalised row @criterion:AC-3', async () => {
    const res = await submit(appWith(), { ...JANE, firstName: ' Jane ', phone: '(415) 555-0132' })
    expect(res.json()).toEqual({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    expect(store.rows).toEqual([{ ...JANE, createdAt: '2026-10-20T14:03:27Z' }])
  })

  it('carries no row id, no reqId and no other submitted value @criterion:AC-6', async () => {
    const res = await submit(appWith(), {
      firstName: 'Jane',
      lastName: `Doe${SENTINEL}`,
      email: `${SENTINEL}@example.com`,
      phone: '415 555 0132',
    })
    expect(res.statusCode).toBe(201)
    expect(Object.keys(res.json()).sort()).toEqual(['createdAt', 'firstName'])
    expect(res.body).not.toMatch(/"id"|reqId|req-/)
    expect(res.body).not.toContain(SENTINEL)
    expect(res.body).not.toContain('4155550132')
  })

  it('stores a second row for the same details: duplicates are allowed @criterion:AC-2', async () => {
    const target = appWith()
    const [first, second] = await Promise.all([submit(target, JANE), submit(target, JANE)])
    expect([first?.statusCode, second?.statusCode]).toEqual([201, 201])
    expect(store.rows).toHaveLength(2)
  })

  it('logs registration.created with no submitted value', async () => {
    const info = vi.spyOn(logger, 'info')
    await submit(appWith(), JANE)
    expect(info).toHaveBeenCalledWith({ event: 'registration.created' }, 'registration.created')
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/Jane|Doe|example\.com|4155550132/)
  })

  it('serialises the 201 through the documented RegistrationCreated schema', () => {
    expect(registrationCreatedSchema).toEqual(openapi.components.schemas.RegistrationCreated)
  })
})

describe('no response or log line carries a submitted value or the client address @story:ST-2 @criterion:AC-6', () => {
  const IP = '198.51.100.77'
  it.each([
    ['firstName with a control character', { ...JANE, firstName: `Ja\u0000${SENTINEL}` }, 'firstName'],
    ['an over-long lastName', { ...JANE, lastName: SENTINEL.repeat(20) }, 'lastName'],
    ['an invalid email', { ...JANE, email: SENTINEL }, 'email'],
    ['an invalid phone', { ...JANE, phone: SENTINEL }, 'phone'],
    ['a non-string firstName', { ...JANE, firstName: 42 }, 'firstName'],
  ])('answers %s with 400 naming only that field', async (_name, body, field) => {
    const spies = [vi.spyOn(logger, 'info'), vi.spyOn(logger, 'warn'), vi.spyOn(logger, 'error')]
    const res = await submit(appWith(), body, { remoteAddress: IP })
    expect(res.statusCode).toBe(400)
    expect(Object.keys(res.json().fields)).toEqual([field])
    expect(res.body).not.toContain(SENTINEL)
    expect(JSON.stringify(spies.map((spy) => spy.mock.calls))).not.toMatch(new RegExp(`${SENTINEL}|${IP.replace(/\./g, '\\.')}`))
    expect(store.rows).toEqual([])
  })

  it('logs a saved registration without any field or the address', async () => {
    const spies = [vi.spyOn(logger, 'info'), vi.spyOn(logger, 'warn'), vi.spyOn(logger, 'error')]
    const res = await submit(
      appWith(),
      { firstName: `J${SENTINEL}`, lastName: SENTINEL, email: `${SENTINEL}@example.com`, phone: '(415) 555-0132' },
      { remoteAddress: IP },
    )
    expect(res.statusCode).toBe(201)
    expect(JSON.stringify(spies.map((spy) => spy.mock.calls))).not.toMatch(new RegExp(`${SENTINEL}|198\\.51|4155550132`))
  })

  it('sends the exact AD-16 headers on a 201 and on a refusal', async () => {
    const target = appWith()
    for (const res of [await submit(target, JANE), await submit(target, { ...JANE, phone: 'x' })]) {
      expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-frame-options']).toBe('DENY')
      expect(res.headers['referrer-policy']).toBe('no-referrer')
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
      expect(res.headers['cache-control']).toBe('no-store')
    }
  })
})

describe('refusals are fixed problem envelopes and write nothing @story:ST-2 @criterion:AC-5', () => {
  it.each([
    ['an invalid phone', { ...JANE, phone: `+1 ${SENTINEL}` }, { phone: [PHONE_MESSAGE] }],
    ['an empty first name', { ...JANE, firstName: '  ' }, { firstName: ['First name is required.'] }],
    ['an unknown property', { ...JANE, id: SENTINEL }, {}],
    ['a non-object body', [SENTINEL], {}],
    ['JSON null', null, {}],
  ])('answers %s with 400 validation', async (_name, body, fields) => {
    const res = await submit(appWith(), body)
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
    expect(res.json()).toEqual({ error: 'validation', fields })
    expect(res.body).not.toContain(SENTINEL)
    expect(store.rows).toEqual([])
    expectDocumented(res)
  })

  it.each([
    ['malformed JSON', `{"firstName":"${SENTINEL}"`],
    ['an empty JSON body', ''],
  ])('answers %s with 400 validation and fields {}', async (_name, payload) => {
    const res = await submit(appWith(), payload)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: {} })
    expect(res.body).not.toContain(SENTINEL)
    expectDocumented(res)
  })

  it('answers a cross-site request with 403 before reading the body', async () => {
    const res = await submit(appWith(), SENTINEL.repeat(1000), {
      headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' },
    })
    expect(res.body).not.toContain(SENTINEL)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'forbidden' })
    expect(store.rows).toEqual([])
    expectDocumented(res)
  })

  it.each(['same-origin', 'none'])('accepts Sec-Fetch-Site: %s', async (site) => {
    const res = await submit(appWith(), JANE, { headers: { 'sec-fetch-site': site } })
    expect(res.statusCode).toBe(201)
  })

  it.each([
    ['text/plain', JSON.stringify(JANE)],
    ['application/jsonx', JSON.stringify(JANE)],
    ['application/problem+json', JSON.stringify(JANE)],
    ['application/x-www-form-urlencoded', `firstName=${SENTINEL}`],
    ['text/xml', `<a>${SENTINEL}</a>`],
  ])('answers Content-Type %s with 415', async (type, payload) => {
    const res = await submit(appWith(), payload, { headers: { 'content-type': type } })
    expect(res.statusCode).toBe(415)
    expect(res.json()).toEqual({ error: 'unsupported_media_type' })
    expect(res.body).not.toContain(SENTINEL)
    expect(store.rows).toEqual([])
    expectDocumented(res)
  })

  it('answers a request with no Content-Type with 415', async () => {
    const res = await appWith().inject({ method: 'POST', url: '/api/registrations' })
    expect(res.statusCode).toBe(415)
    expect(res.json()).toEqual({ error: 'unsupported_media_type' })
  })

  it('accepts application/json with a charset', async () => {
    const res = await submit(appWith(), JANE, { headers: { 'content-type': 'Application/JSON; charset=utf-8' } })
    expect(res.statusCode).toBe(201)
  })

  it('reads a body of exactly 4 KB', async () => {
    expect(REGISTRATION_BODY_LIMIT).toBe(4096)
    const base = JSON.stringify({ ...JANE, lastName: '' })
    const payload = JSON.stringify({ ...JANE, lastName: 'D'.repeat(REGISTRATION_BODY_LIMIT - base.length) })
    expect(Buffer.byteLength(payload)).toBe(REGISTRATION_BODY_LIMIT)
    const res = await submit(appWith(), payload)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: { lastName: ['Last name must be 100 characters or fewer.'] } })
  })

  it('answers a body over 4 KB with 413', async () => {
    const payload = JSON.stringify({ ...JANE, lastName: SENTINEL.repeat(REGISTRATION_BODY_LIMIT / SENTINEL.length + 1) })
    const res = await submit(appWith(), payload)
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({ error: 'too_large' })
    expect(res.body).not.toContain(SENTINEL)
    expect(store.rows).toEqual([])
    expectDocumented(res)
  })

  it('answers a failed insert with 500 and logs only its SQLSTATE', async () => {
    const error = vi.spyOn(logger, 'error')
    const target = appWith()
    store.failure = Object.assign(new Error(`permission denied: ${SENTINEL}`), { code: '42501' })
    const res = await submit(target, { ...JANE, lastName: SENTINEL })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'internal' })
    expect(res.body).not.toContain(SENTINEL)
    expect(res.body).not.toContain('permission')
    expect(error).toHaveBeenCalledWith({ event: 'db.insert_failed', sqlstate: '42501' }, 'db.insert_failed')
    expect(JSON.stringify(error.mock.calls)).not.toContain(SENTINEL)
    expectDocumented(res)
  })

  it('logs an insert failure with no SQLSTATE as unknown', async () => {
    const error = vi.spyOn(logger, 'error')
    const target = appWith()
    store.failure = null
    const res = await submit(target, JANE)
    expect(res.statusCode).toBe(500)
    expect(error).toHaveBeenCalledWith({ event: 'db.insert_failed', sqlstate: 'unknown' }, 'db.insert_failed')
  })
})

describe('rate limits key on the socket address only @story:ST-2', () => {
  it('answers 429 once the per-address limit is spent, whatever X-Forwarded-For says', async () => {
    const target = appWith({ perIpPerMinute: 2, globalPerMinute: 100 })
    const from = (xff: string, remoteAddress = '10.0.0.1') => submit(target, JANE, { headers: { 'x-forwarded-for': xff }, remoteAddress })
    expect((await from('203.0.113.1')).statusCode).toBe(201)
    expect((await from('203.0.113.2')).statusCode).toBe(201)
    const limited = await from('203.0.113.3')
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toEqual({ error: 'rate_limited' })
    expectDocumented(limited)
    expect((await from('203.0.113.1', '10.0.0.2')).statusCode).toBe(201)
    expect(store.rows).toHaveLength(3)
  })

  it('answers 429 to everyone once the global limit is spent, and recovers next minute', async () => {
    let now = NOW
    const target = appWith({ perIpPerMinute: 100, globalPerMinute: 1 }, () => now)
    expect((await submit(target, JANE, { remoteAddress: '10.0.0.1' })).statusCode).toBe(201)
    expect((await submit(target, JANE, { remoteAddress: '10.0.0.2' })).statusCode).toBe(429)
    now += 60_000
    expect((await submit(target, JANE, { remoteAddress: '10.0.0.2' })).statusCode).toBe(201)
  })
})

describe('the path serves POST only @story:ST-2 @criterion:AC-6', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)('answers %s with 405, Allow: POST and no data', async (method) => {
    const target = appWith()
    await submit(target, JANE)
    const res = await target.inject({ method, url: '/api/registrations?x=1' })
    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('POST')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body).not.toMatch(/Jane|"id"/)
  })

  it.each(['/api/%72egistrations', '/api/registration%73?x=1'])('answers GET %s, an encoded spelling, with 405', async (url) => {
    const res = await appWith().inject({ method: 'GET', url })
    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('POST')
  })

  it('answers a badly encoded /api path with a 4xx and no-store', async () => {
    const res = await appWith().inject({ method: 'GET', url: '/api/%E0%A4%A' })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.statusCode).toBeLessThan(500)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('answers HEAD with 405 and Allow: POST', async () => {
    const res = await appWith().inject({ method: 'HEAD', url: '/api/registrations' })
    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('POST')
  })

  it('answers any other /api path with 404 and no-store', async () => {
    const res = await appWith().inject({ method: 'POST', url: '/api/registrations/1' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.json()).toEqual({ error: { message: 'Not found.' } })
  })

  it('documents POST as the only operation on /api/registrations', () => {
    expect(Object.keys(openapi.paths['/api/registrations'] ?? {}).filter((k) => k !== 'description')).toEqual(['post'])
    expect(Object.keys(post?.responses ?? {}).sort()).toEqual(['201', '400', '403', '413', '415', '429', '500'])
  })
})
