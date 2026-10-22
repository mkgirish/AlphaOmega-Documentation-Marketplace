import { Readable } from 'node:stream'
import pino from 'pino'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { buildApp } from '../main.js'
import type { RegistrationStore, StoredRegistration } from '../persistence/registrations.js'
import { PHONE_MESSAGE } from './registration-rules.js'
import { REGISTRATION_BODY_LIMIT } from './registrations.js'

// ST-11 — POST /api/registrations refuses whatever the form would never send, answers
// in the validation envelope, never repeats a value and logs one redacted rejection.
const NO_WEB_ROOT = '/nonexistent-web-root'
const URL = '/api/registrations'
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const NOW = new Date(Date.UTC(2026, 9, 22, 8, 30, 15, 987))

interface Harness {
  app: FastifyInstance
  saved: StoredRegistration[]
  log: () => Record<string, unknown>[]
}

let app: FastifyInstance | undefined

beforeAll(async () => {
  const warm = buildApp({ webRoot: NO_WEB_ROOT })
  await warm.inject({ method: 'POST', url: URL, headers: { 'content-type': 'application/json' }, payload: '{}' })
  await warm.close()
}, 30_000)

afterEach(async () => {
  await app?.close()
  app = undefined
})

function harness(store?: RegistrationStore): Harness {
  const lines: string[] = []
  const logger = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) })
  const saved: StoredRegistration[] = []
  const recording: RegistrationStore = store ?? { save: async (row) => void saved.push(row) }
  app = buildApp({ webRoot: NO_WEB_ROOT, registrations: recording, logger, now: () => NOW })
  return { app, saved, log: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) }
}

function post(h: Harness, payload: string | object, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
  const options: InjectOptions = {
    method: 'POST',
    url: URL,
    headers: { 'content-type': 'application/json', ...headers },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  }
  return h.app.inject(options)
}

function rejections(h: Harness): Record<string, unknown>[] {
  return h.log().filter((entry) => entry.event === 'registration.rejected')
}

describe('a missing email is refused @story:ST-11 @criterion:AC-1', () => {
  it('answers 400 with an error under fields.email and saves nothing', async () => {
    const h = harness()
    const res = await post(h, { firstName: 'Jane', lastName: 'Doe', phone: '4155550132' })
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.headers['cache-control']).toBe('no-store')
    const body = res.json()
    expect(body).toEqual({ error: 'validation', fields: { email: [expect.any(String)] } })
    expect(body.fields.email[0].length).toBeGreaterThan(0)
    expect(h.saved).toEqual([])
  })
})

describe('every invalid field is reported at once @story:ST-11 @criterion:AC-2', () => {
  it('lists email and phone and nothing for the valid names', async () => {
    const h = harness()
    const res = await post(h, { firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '5550132' })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(Object.keys(body.fields).sort()).toEqual(['email', 'phone'])
    expect(body.fields.phone).toEqual([PHONE_MESSAGE])
    expect(body.fields.email).toHaveLength(1)
    expect(body.fields).not.toHaveProperty('firstName')
    expect(body.fields).not.toHaveProperty('lastName')
    expect(h.saved).toEqual([])
  })

  it('reports all four fields of an empty object', async () => {
    const h = harness()
    const res = await post(h, {})
    expect(res.statusCode).toBe(400)
    expect(Object.keys(res.json().fields).sort()).toEqual(['email', 'firstName', 'lastName', 'phone'])
    expect(h.saved).toEqual([])
  })
})

describe('bodies the form never sends are refused @story:ST-11 @criterion:AC-3', () => {
  it.each(['{firstName:', '{"firstName":"Jane"', '', 'null', '[]', '"Jane"', '42', '{"__proto__":{"x":1}}'])(
    'answers %j with 400 and "fields" {}',
    async (payload) => {
      const h = harness()
      const res = await post(h, payload)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'validation', fields: {} })
      expect(h.saved).toEqual([])
    },
  )

  it('refuses a valid registration carrying an extra "id"', async () => {
    const h = harness()
    const res = await post(h, { ...VALID, id: 5 })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: {} })
    expect(h.saved).toEqual([])
  })
})

describe('requests the form would never send are refused @story:ST-11 @criterion:AC-4', () => {
  it('answers a valid registration sent as text/plain with 415', async () => {
    const h = harness()
    const res = await post(h, JSON.stringify(VALID), { 'content-type': 'text/plain' })
    expect(res.statusCode).toBe(415)
    expect(res.json()).toEqual({ error: { message: 'Unsupported content type.' } })
    expect(h.saved).toEqual([])
  })

  it.each(['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp', 'text/json'])(
    'answers content type %s with 415',
    async (type) => {
      const h = harness()
      const res = await post(h, JSON.stringify(VALID), { 'content-type': type })
      expect(res.statusCode).toBe(415)
      expect(h.saved).toEqual([])
    },
  )

  it('answers a body with no content type with 415', async () => {
    const h = harness()
    const res = await h.app.inject({ method: 'POST', url: URL, payload: Buffer.from(JSON.stringify(VALID)) })
    expect(res.statusCode).toBe(415)
    expect(h.saved).toEqual([])
  })

  it('accepts application/json with a charset parameter, in any case', async () => {
    const h = harness()
    const res = await post(h, VALID, { 'content-type': 'Application/JSON; charset=utf-8' })
    expect(res.statusCode).toBe(201)
    expect(h.saved).toHaveLength(1)
  })

  it('answers a 5 KB JSON body with 413 and holds the limit at 4 KB', async () => {
    expect(REGISTRATION_BODY_LIMIT).toBe(4 * 1024)
    const h = harness()
    const big = JSON.stringify({ ...VALID, firstName: 'x'.repeat(5 * 1024) })
    const res = await post(h, big)
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({ error: { message: 'The request is too large.' } })
    expect(h.saved).toEqual([])
  })

  it('answers a chunked body over 4 KB with no content-length with 413', async () => {
    const h = harness()
    const big = JSON.stringify({ ...VALID, firstName: 'x'.repeat(5 * 1024) })
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      headers: { 'content-type': 'application/json' },
      payload: Readable.from([Buffer.from(big.slice(0, 2048)), Buffer.from(big.slice(2048))]),
    })
    expect(res.statusCode).toBe(413)
    expect(h.saved).toEqual([])
  })

  it('reads a body of exactly 4 KB and validates it', async () => {
    const h = harness()
    const base = JSON.stringify({ ...VALID, firstName: '' })
    const exact = JSON.stringify({ ...VALID, firstName: 'x'.repeat(REGISTRATION_BODY_LIMIT - base.length) })
    expect(Buffer.byteLength(exact)).toBe(REGISTRATION_BODY_LIMIT)
    const res = await post(h, exact)
    expect(res.statusCode).toBe(400)
    expect(Object.keys(res.json().fields)).toEqual(['firstName'])
  })

  it.each(['cross-site', 'same-site', 'CROSS-SITE'])('answers Sec-Fetch-Site %s with 403', async (site) => {
    const h = harness()
    const res = await post(h, VALID, { 'sec-fetch-site': site })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { message: 'Cross-site requests are refused.' } })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(h.saved).toEqual([])
  })

  it('checks the origin before the content type', async () => {
    const h = harness()
    const res = await post(h, 'x', { 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' })
    expect(res.statusCode).toBe(403)
  })

  it.each(['same-origin', 'none'])('accepts Sec-Fetch-Site %s', async (site) => {
    const h = harness()
    const res = await post(h, VALID, { 'sec-fetch-site': site })
    expect(res.statusCode).toBe(201)
  })
})

describe('a valid registration is kept (the positive control for "adds no row")', () => {
  it('saves the normalised values once with whole-second UTC time and answers 201 without the row id', async () => {
    const h = harness()
    const res = await post(h, { firstName: ' Jane ', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ data: { createdAt: '2026-10-22T08:30:15Z' } })
    expect(h.saved).toEqual([{ ...VALID, createdAt: new Date(Date.UTC(2026, 9, 22, 8, 30, 15)) }])
    expect(rejections(h)).toEqual([])
  })

  it('answers 503 when no store is configured', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT, logger: pino({ level: 'silent' }) })
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(VALID),
    })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: { message: 'Registrations cannot be saved right now.' } })
  })

  it('answers 500 with no detail when the store fails', async () => {
    const h = harness({
      save: async () => {
        throw Object.assign(new Error('permission denied for table registrations SENTINEL-db'), { code: '42501' })
      },
    })
    const res = await post(h, VALID)
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
    expect(res.body).not.toContain('SENTINEL-db')
    expect(JSON.stringify(h.log())).not.toContain('SENTINEL-db')
    expect(h.log().find((e) => e.msg === 'request.failed')).toMatchObject({ code: '42501' })
  })

  it('reads the database location from DATABASE_URL and needs none', () => {
    expect(loadConfig({}).databaseUrl).toBeUndefined()
    expect(loadConfig({ DATABASE_URL: 'postgres://app@localhost/registrations' }).databaseUrl).toBe(
      'postgres://app@localhost/registrations',
    )
  })

  it('offers no read route', async () => {
    const h = harness()
    const res = await h.app.inject({ method: 'GET', url: URL })
    expect(res.statusCode).toBe(404)
  })
})

describe('refusals do not repeat or log what was sent @story:ST-11 @criterion:AC-5', () => {
  it('never puts "leak-check@bad" in the response or the log, and logs one rejection naming email', async () => {
    const h = harness()
    const res = await post(h, { ...VALID, email: 'leak-check@bad' })
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain('leak-check@bad')
    const raw = h.log()
    expect(JSON.stringify(raw)).not.toContain('leak-check')
    const events = rejections(h)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: 'registration.rejected', status: 400, failures: [{ field: 'email', rule: 'email' }] })
  })

  const sentinel = (field: string) => `SENTINEL-${field}-9e7b`
  const perField: [string, Record<string, unknown>][] = [
    ['firstName', { ...VALID, firstName: `${sentinel('firstName')}${'x'.repeat(100)}` }],
    ['lastName', { ...VALID, lastName: `${sentinel('lastName')}\u0000` }],
    ['email', { ...VALID, email: `${sentinel('email')}@` }],
    ['phone', { ...VALID, phone: sentinel('phone') }],
  ]

  it.each(perField)('names only the field and rule for a bad %s, never the value', async (field, body) => {
    const h = harness()
    const res = await post(h, body)
    expect(res.statusCode).toBe(400)
    expect(Object.keys(res.json().fields)).toEqual([field])
    expect(res.body).not.toContain(sentinel(field))
    expect(JSON.stringify(h.log())).not.toContain(sentinel(field))
    const events = rejections(h)
    expect(events).toHaveLength(1)
    const failures = events[0]?.failures as { field: string; rule: string }[]
    expect(failures).toHaveLength(1)
    expect(Object.keys(failures[0] ?? {}).sort()).toEqual(['field', 'rule'])
    expect(failures[0]?.field).toBe(field)
  })

  const SECRET = 'SENTINEL-gate-31d8'
  const gates: [string, number, string, () => [string, Record<string, string>]][] = [
    ['malformed JSON', 400, 'malformed_json', () => [`{"email":"${SECRET}"`, {}]],
    ['an unexpected field', 400, 'unknown_field', () => [JSON.stringify({ ...VALID, [SECRET]: SECRET }), {}]],
    ['a non-object body', 400, 'not_object', () => [JSON.stringify([SECRET]), {}]],
    ['text/plain', 415, 'content_type', () => [SECRET, { 'content-type': 'text/plain' }]],
    ['a 5 KB body', 413, 'body_size', () => [JSON.stringify({ email: SECRET, pad: 'x'.repeat(5 * 1024) }), {}]],
    ['a cross-site request', 403, 'cross_site', () => [JSON.stringify({ ...VALID, email: SECRET }), { 'sec-fetch-site': 'cross-site' }]],
  ]

  it.each(gates)('logs one rejection for %s with status %i and rule %s and no value', async (_name, status, rule, request) => {
    const h = harness()
    const [payload, headers] = request()
    const res = await post(h, payload, headers)
    expect(res.statusCode).toBe(status)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).not.toContain(SECRET)
    expect(JSON.stringify(h.log())).not.toContain(SECRET)
    expect(rejections(h)).toEqual([expect.objectContaining({ event: 'registration.rejected', status, failures: [{ rule }] })])
    expect(h.saved).toEqual([])
  })

  it('logs no client IP or forwarded address', async () => {
    const h = harness()
    await h.app.inject({
      method: 'POST',
      url: URL,
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
      remoteAddress: '198.51.100.23',
      payload: JSON.stringify({}),
    })
    const raw = JSON.stringify(h.log())
    expect(raw).not.toContain('203.0.113.77')
    expect(raw).not.toContain('198.51.100.23')
  })
})
