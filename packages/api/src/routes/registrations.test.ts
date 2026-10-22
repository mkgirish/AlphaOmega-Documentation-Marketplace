import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { buildApp, start } from '../main.js'
import { createLogger } from '../observability/index.js'
import type { RegistrationStore } from '../persistence/repository.js'
import type { NewRegistration } from '../registrations/rules.js'

// ST-11 — POST /api/registrations through inject, with the store recording every insert and
// the logger captured, so each refusal is shown to write nothing and to log only names.
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const NO_WEB_ROOT = '/nonexistent-web-root'
const CLIENT_IP = '198.51.100.23'

interface Harness {
  readonly app: FastifyInstance
  readonly rows: NewRegistration[]
  readonly log: string[]
  events(): Record<string, unknown>[]
}

let open: FastifyInstance | undefined

function harness(insert?: RegistrationStore['insert']): Harness {
  const rows: NewRegistration[] = []
  const log: string[] = []
  const logger = createLogger({ write: (line: string) => void log.push(line) }, 'info')
  const store: RegistrationStore = {
    insert: insert ?? (async (registration) => void rows.push(registration)),
    close: async () => {},
  }
  const app = buildApp({ webRoot: NO_WEB_ROOT, store, logger })
  open = app
  return { app, rows, log, events: () => log.map((line) => JSON.parse(line) as Record<string, unknown>) }
}

function post(app: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) {
  const options: InjectOptions = {
    method: 'POST',
    url: '/api/registrations',
    remoteAddress: CLIENT_IP,
    headers: { 'content-type': 'application/json', ...headers },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  }
  return app.inject(options)
}

function rejections(h: Harness): Record<string, unknown>[] {
  return h.events().filter((e) => e.msg === 'registration.rejected')
}

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = harness().app
  await post(warm, VALID)
  await warm.close()
}, 30_000)

afterEach(async () => {
  await open?.close()
  open = undefined
})

describe('a missing email is refused @story:ST-11 @criterion:AC-1', () => {
  it('answers 400 with an error under fields.email only and adds no row', async () => {
    const h = harness()
    const { email: _omit, ...body } = VALID
    const res = await post(h.app, body)
    expect(res.statusCode).toBe(400)
    const json = res.json()
    expect(json.error).toBe('validation')
    expect(Object.keys(json.fields)).toEqual(['email'])
    expect(json.fields.email).toEqual(['Email is required.'])
    expect(res.headers['cache-control']).toBe('no-store')
    expect(h.rows).toHaveLength(0)
  })
})

describe('every invalid field is reported at once @story:ST-11 @criterion:AC-2', () => {
  it('lists errors under email and phone, none under the names, and adds no row', async () => {
    const h = harness()
    const res = await post(h.app, { firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '5550132' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'validation',
      fields: {
        email: ['Enter a valid email address.'],
        phone: ['Enter a 10-digit US number without +1, e.g. (415) 555-0132.'],
      },
    })
    expect(h.rows).toHaveLength(0)
  })

  it('lists all four fields for an empty object', async () => {
    const h = harness()
    const res = await post(h.app, {})
    expect(res.statusCode).toBe(400)
    expect(Object.keys(res.json().fields)).toEqual(['firstName', 'lastName', 'email', 'phone'])
    expect(h.rows).toHaveLength(0)
  })
})

describe('malformed JSON and unexpected fields are refused @story:ST-11 @criterion:AC-3', () => {
  it.each([
    ['broken JSON', '{firstName:'],
    ['an empty body', ''],
    ['an array', '[]'],
    ['null', 'null'],
    ['a bare string', '"Jane"'],
    ['a prototype key', '{"__proto__":{"admin":true},"firstName":"Jane"}'],
  ])('answers %s with 400 and "fields" {} and adds no row', async (_name, payload) => {
    const h = harness()
    const res = await post(h.app, payload)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: {} })
    expect(h.rows).toHaveLength(0)
    expect(rejections(h)).toEqual([expect.objectContaining({ reason: 'malformed', fields: [] })])
  })

  it('answers an extra "id": 5 with 400 without naming it, and adds no row', async () => {
    const h = harness()
    const res = await post(h.app, { ...VALID, id: 5 })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'validation', fields: {} })
    expect(h.rows).toHaveLength(0)
    expect(rejections(h)).toEqual([expect.objectContaining({ reason: 'unknown_field', fields: [] })])
  })
})

describe('requests the form would never send are refused @story:ST-11 @criterion:AC-4', () => {
  it.each([
    ['content type text/plain', JSON.stringify(VALID), { 'content-type': 'text/plain' }, 415, 'content_type'],
    ['content type text/xml', '<firstName/>', { 'content-type': 'text/xml' }, 415, 'content_type'],
    ['a form post', 'firstName=Jane', { 'content-type': 'application/x-www-form-urlencoded' }, 415, 'content_type'],
    ['no content type', JSON.stringify(VALID), { 'content-type': '' }, 415, 'content_type'],
    ['a JSON body of 5 KB', JSON.stringify({ ...VALID, firstName: 'x'.repeat(5 * 1024) }), {}, 413, 'too_large'],
    ['Sec-Fetch-Site cross-site', JSON.stringify(VALID), { 'sec-fetch-site': 'cross-site' }, 403, 'cross_site'],
    ['Sec-Fetch-Site same-site', JSON.stringify(VALID), { 'sec-fetch-site': 'same-site' }, 403, 'cross_site'],
    ['Sec-Fetch-Site CROSS-SITE', JSON.stringify(VALID), { 'sec-fetch-site': 'CROSS-SITE' }, 403, 'cross_site'],
    ['an unknown Sec-Fetch-Site', JSON.stringify(VALID), { 'sec-fetch-site': 'evil' }, 403, 'cross_site'],
    ['two Sec-Fetch-Site values', JSON.stringify(VALID), { 'sec-fetch-site': 'same-origin, cross-site' }, 403, 'cross_site'],
    ['a UTF-16 charset', JSON.stringify(VALID), { 'content-type': 'application/json; charset=utf-16' }, 415, 'content_type'],
    ['a JSON look-alike', JSON.stringify(VALID), { 'content-type': 'application/json-patch+json' }, 415, 'content_type'],
    [
      'cross-site text/plain (403 is decided first)',
      JSON.stringify(VALID),
      { 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' },
      403,
      'cross_site',
    ],
  ])('answers %s with %i and adds no row', async (_name, payload, headers, status, reason) => {
    const h = harness()
    const res = await post(h.app, payload, headers)
    expect(res.statusCode).toBe(status)
    expect(res.json()).toEqual({ error: { message: expect.any(String) } })
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(h.rows).toHaveLength(0)
    expect(rejections(h)).toEqual([expect.objectContaining({ reason, fields: [] })])
  })

  it('takes a body of exactly 4 KB and refuses one byte more', async () => {
    const at = (size: number) => {
      const base = JSON.stringify({ ...VALID, lastName: '' })
      return JSON.stringify({ ...VALID, lastName: `D${' '.repeat(size - base.length - 1)}` })
    }
    expect(Buffer.byteLength(at(4096))).toBe(4096)
    const h = harness()
    expect((await post(h.app, at(4096))).statusCode).toBe(201)
    expect((await post(h.app, at(4097))).statusCode).toBe(413)
    expect(h.rows).toHaveLength(1)
  })

  it.each([
    ['same-origin', 'application/json; charset=utf-8'],
    ['none', 'Application/JSON; Charset=UTF-8'],
  ])('accepts Sec-Fetch-Site %s with %s', async (site, contentType) => {
    const h = harness()
    const res = await post(h.app, VALID, { 'sec-fetch-site': site, 'content-type': contentType })
    expect(res.statusCode).toBe(201)
    expect(h.rows).toEqual([VALID])
  })

  it.each(['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)(
    'answers %s with 405, allows only POST and reads nothing',
    async (method) => {
      const h = harness()
      const res = await h.app.inject({ method, url: '/api/registrations' })
      expect(res.statusCode).toBe(405)
      expect(res.headers.allow).toBe('POST')
      expect(res.json()).toEqual({ error: { message: 'This method is not allowed.' } })
      expect(h.rows).toHaveLength(0)
    },
  )
})

describe('refusals do not repeat or log what was sent @story:ST-11 @criterion:AC-5', () => {
  it('neither the body nor the log contains "leak-check@bad"; one registration.rejected names email', async () => {
    const h = harness()
    const res = await post(h.app, { ...VALID, email: 'leak-check@bad' })
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain('leak-check@bad')
    expect(h.log.join('')).not.toContain('leak-check@bad')
    expect(rejections(h)).toHaveLength(1)
    expect(rejections(h)[0]).toMatchObject({ reason: 'validation', fields: [{ field: 'email', rule: 'format' }] })
  })

  it.each([
    ['firstName', 'SENTINEL-first‮'],
    ['firstName', `SENTINEL-first${'x'.repeat(120)}`],
    ['lastName', 'SENTINEL-last\u0007'],
    ['email', 'SENTINEL-email@'],
    ['phone', 'SENTINEL-phone'],
  ] as const)('a bad %s value never reaches the body or the log', async (field, value) => {
    const h = harness()
    const res = await post(h.app, { ...VALID, [field]: value }, { 'x-forwarded-for': '203.0.113.9' })
    expect(res.statusCode).toBe(400)
    expect(Object.keys(res.json().fields)).toEqual([field])
    const everything = res.body + Object.values(res.headers).join('') + h.log.join('')
    expect(everything).not.toContain('SENTINEL')
    // No other submitted value is repeated either, and no client address is logged.
    for (const v of Object.values(VALID)) expect(everything).not.toContain(v)
    expect(h.log.join('')).not.toContain(CLIENT_IP)
    expect(h.log.join('')).not.toContain('203.0.113.9')
    expect(rejections(h)).toEqual([expect.objectContaining({ fields: [{ field, rule: expect.any(String) }] })])
    const allowed = ['fields', 'hostname', 'level', 'msg', 'pid', 'reason', 'reqId', 'time']
    expect(Object.keys(rejections(h)[0] ?? {}).filter((key) => !allowed.includes(key))).toEqual([])
  })

  it('logs nothing from a gate refusal that could carry what was sent', async () => {
    const h = harness()
    await post(h.app, '{"email":"SENTINEL-gate', {})
    await post(h.app, JSON.stringify({ email: 'SENTINEL-gate' }), { 'content-type': 'text/plain' })
    await post(h.app, JSON.stringify({ email: 'SENTINEL-gate', pad: 'x'.repeat(5000) }))
    await post(h.app, JSON.stringify({ email: 'SENTINEL-gate', id: 'SENTINEL-gate' }))
    expect(h.log.join('')).not.toContain('SENTINEL')
    expect(rejections(h).map((e) => e.reason)).toEqual(['malformed', 'content_type', 'too_large', 'unknown_field'])
    expect(h.log.join('')).not.toContain(CLIENT_IP)
  })

  it('stores the normalised values and answers 201 without any id or value', async () => {
    const h = harness()
    const res = await post(h.app, {
      firstName: '  Jane ',
      lastName: 'Doe',
      email: ' jane.doe@example.com',
      phone: '(415) 555-0132',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ ok: true })
    expect(h.rows).toEqual([VALID])
    expect(rejections(h)).toEqual([])
    for (const v of Object.values(VALID)) expect(res.body).not.toContain(v)
  })

  it('answers a failed save with 500, the generic envelope and only the SQLSTATE logged', async () => {
    const h = harness(async () => {
      throw Object.assign(new Error('permission denied for table registrations SENTINEL-db'), { code: '42501' })
    })
    const res = await post(h.app, { ...VALID, email: 'SENTINEL-save@example.com' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
    expect(res.body + h.log.join('')).not.toContain('SENTINEL')
    expect(rejections(h)).toEqual([])
    expect(h.events().filter((e) => e.msg === 'request.failed')).toEqual([expect.objectContaining({ code: '42501' })])
  })

  it('answers a store error that carries a client status with 500, never as a refusal', async () => {
    const h = harness(async () => {
      throw Object.assign(new Error('SENTINEL-status'), { statusCode: 400 })
    })
    const res = await post(h.app, VALID)
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
    expect(rejections(h)).toEqual([])
    expect(h.log.join('')).not.toContain('SENTINEL')
  })

  it('gives each concurrent refusal its own reqId', async () => {
    const h = harness()
    await Promise.all(Array.from({ length: 6 }, () => post(h.app, { ...VALID, phone: '1' })))
    const ids = rejections(h).map((e) => e.reqId)
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
  })
})

describe('the write route as start() wires it @story:ST-11 @criterion:AC-1 @criterion:AC-4', () => {
  it('refuses a streamed body over 4 KB that declares no length with 413', async () => {
    // With no database configured, a body that reached the save would answer 500 instead.
    const app = await start({ port: 0, host: '127.0.0.1', webRoot: NO_WEB_ROOT })
    open = app
    const address = app.server.address()
    if (address === null || typeof address === 'string') throw new Error('no TCP address')
    const chunk = new TextEncoder().encode(JSON.stringify({ ...VALID, lastName: 'x'.repeat(5 * 1024) }))
    const res = await fetch(`http://127.0.0.1:${address.port}/api/registrations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(chunk)
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: { message: 'The request is too large.' } })
  })

  it('without a database refuses invalid bodies with 400 and answers a valid one with 500', async () => {
    const app = await start({ port: 0, host: '127.0.0.1', webRoot: NO_WEB_ROOT })
    open = app
    const { email: _omit, ...body } = VALID
    expect((await post(app, body)).statusCode).toBe(400)
    const res = await post(app, VALID)
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
  })

  it('reads the database from DATABASE_URL, and has none without it', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://registrations@db/app' }).databaseUrl).toBe('postgres://registrations@db/app')
    expect(loadConfig({}).databaseUrl).toBeUndefined()
  })

  it('is not mounted when no store is given', async () => {
    const app = buildApp({ webRoot: NO_WEB_ROOT })
    open = app
    expect((await post(app, VALID)).statusCode).toBe(404)
  })
})
