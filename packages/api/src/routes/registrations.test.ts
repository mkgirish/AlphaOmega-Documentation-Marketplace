import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import { buildApp, start, type AppOptions } from '../main.js'
import { logger } from '../observability/index.js'
import type { NewRegistration, RegistrationRepository } from '../persistence/repository.js'

// ST-2 — POST /api/registrations (IF-2) against an in-memory repository: the status,
// envelope and headers of every outcome, the gates in front of the handler, and that no
// response or log line carries a submitted value or the row id. The real PostgreSQL
// path is proven in persistence/registrations.integration.test.ts.
const NO_WEB_ROOT = '/nonexistent-web-root'
const URL = '/api/registrations'
const NOW = new Date('2026-10-20T14:03:27.789Z')
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const SENTINELS = {
  firstName: 'SentinelFirst',
  lastName: 'SentinelLast',
  email: 'sentinel.mail@example.com',
  phone: '(212) 867-5309',
}

class MemoryRepository implements RegistrationRepository {
  readonly rows: NewRegistration[] = []
  async insert(row: NewRegistration): Promise<void> {
    this.rows.push(row)
  }
}

let app: FastifyInstance | undefined

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT, repository: new MemoryRepository() })
  await warm.inject({ method: 'POST', url: URL, payload: VALID })
  await warm.close()
}, 30_000)

afterEach(async () => {
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

function appWith(options: Partial<AppOptions> = {}): FastifyInstance {
  app = buildApp({ webRoot: NO_WEB_ROOT, now: () => NOW, ...options })
  return app
}

function post(target: FastifyInstance, payload: unknown, extra: Partial<InjectOptions> = {}) {
  return target.inject({ method: 'POST', url: URL, payload: payload as Record<string, unknown>, ...extra })
}

function captureLogs(): unknown[][] {
  const calls: unknown[][] = []
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
    vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
      calls.push([level, ...args])
    }) as never)
  }
  return calls
}

function expectProblem(res: { statusCode: number; headers: Record<string, unknown> }, status: number): void {
  expect(res.statusCode).toBe(status)
  expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/)
  expect(res.headers['cache-control']).toBe('no-store')
}

describe('a valid registration is saved and confirmed by name @story:ST-2 @criterion:AC-1', () => {
  it('answers 201 with the first name and stores one row', async () => {
    const repository = new MemoryRepository()
    const res = await post(appWith({ repository }), VALID)
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    expect(repository.rows).toEqual([{ ...VALID, createdAt: '2026-10-20T14:03:27Z' }])
  })
})

describe('one submission stores exactly one row @story:ST-2 @criterion:AC-2', () => {
  it('each accepted POST inserts once; duplicates are separate visits (CON-9)', async () => {
    const repository = new MemoryRepository()
    const target = appWith({ repository })
    await post(target, VALID)
    expect(repository.rows).toHaveLength(1)
    const [a, b] = await Promise.all([post(target, VALID), post(target, VALID)])
    expect([a?.statusCode, b?.statusCode]).toEqual([201, 201])
    expect(repository.rows).toHaveLength(3)
  })
})

describe('the stored row is trimmed, normalised and timestamped @story:ST-2 @criterion:AC-3', () => {
  it('passes the normalised values and a whole-second UTC created_at to the repository', async () => {
    const repository = new MemoryRepository()
    const res = await post(appWith({ repository }), { ...VALID, firstName: ' Jane ', phone: '(415) 555-0132' })
    expect(res.statusCode).toBe(201)
    expect(repository.rows).toEqual([
      { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132', createdAt: '2026-10-20T14:03:27Z' },
    ])
    expect(res.json()).toEqual({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
  })

  it('uses the real clock by default', async () => {
    const repository = new MemoryRepository()
    app = buildApp({ webRoot: NO_WEB_ROOT, repository })
    const before = Math.floor(Date.now() / 1000) * 1000
    const res = await post(app, VALID)
    const createdAt = (res.json() as { createdAt: string }).createdAt
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(Date.parse(createdAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(createdAt)).toBeLessThanOrEqual(Date.now())
  })
})

describe('the 201 confirms the save and holds no row id @story:ST-2 @criterion:AC-5', () => {
  it('answers only after the insert resolves, with firstName and createdAt and nothing else', async () => {
    let release: () => void = () => undefined
    let inserting = false
    const order: string[] = []
    const repository: RegistrationRepository = {
      insert: () =>
        new Promise<void>((resolve) => {
          inserting = true
          release = () => {
            order.push('saved')
            resolve()
          }
        }),
    }
    const pending = post(appWith({ repository }), VALID).then((res) => {
      order.push('answered')
      return res
    })
    await vi.waitFor(() => expect(inserting).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
    expect(order).toEqual([])
    release()
    const res = await pending
    expect(order).toEqual(['saved', 'answered'])
    expect(res.statusCode).toBe(201)
    expect(String(res.headers['content-type'])).toMatch(/^application\/json/)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(Object.keys(res.json() as object).sort()).toEqual(['createdAt', 'firstName'])
    expect(res.body).not.toMatch(/"id"|reqId/i)
  })

  it('never answers 201 when the save fails', async () => {
    captureLogs()
    const repository: RegistrationRepository = { insert: async () => Promise.reject(new Error('down')) }
    const res = await post(appWith({ repository }), VALID)
    expectProblem(res, 500)
    expect(res.json()).toEqual({ error: 'internal' })
  })
})

describe('the saved visit is acknowledged only on screen @story:ST-2 @criterion:AC-6', () => {
  it('the 201 carries no message, channel or contact detail beyond the first name', async () => {
    const res = await post(appWith({ repository: new MemoryRepository() }), VALID)
    expect(res.body).not.toMatch(/sms|text message|e-?mail|4155550132|Doe/i)
  })
})

describe('validation failures (400) @story:ST-2 @criterion:AC-3', () => {
  it('lists the CMP-2 message for each invalid field and stores nothing', async () => {
    const repository = new MemoryRepository()
    const res = await post(appWith({ repository }), { ...VALID, phone: '+1 415 555 0132' })
    expectProblem(res, 400)
    expect(res.json()).toEqual({ error: 'validation', fields: { phone: [PHONE_MESSAGE] } })
    expect(repository.rows).toEqual([])
  })

  it.each([
    ['malformed JSON', '{"firstName":'],
    ['an empty body', ''],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['a JSON string', '"Jane"'],
    ['an unknown id property', JSON.stringify({ ...VALID, id: '00000000-0000-0000-0000-000000000000' })],
    ['a prototype-poisoning key', `{"firstName":"Jane","__proto__":{"admin":true}}`],
  ])('%s gives fields {} and stores nothing', async (_name, payload) => {
    const repository = new MemoryRepository()
    const res = await post(appWith({ repository }), payload, { headers: { 'content-type': 'application/json' } })
    expectProblem(res, 400)
    expect(res.json()).toEqual({ error: 'validation', fields: {} })
    expect(repository.rows).toEqual([])
  })

  it('accepts application/json with a charset parameter', async () => {
    const res = await post(appWith({ repository: new MemoryRepository() }), JSON.stringify(VALID), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('the gates in front of the handler @story:ST-2 @criterion:AC-5', () => {
  it('refuses a cross-site request with 403 and stores nothing', async () => {
    const repository = new MemoryRepository()
    const target = appWith({ repository })
    const res = await post(target, VALID, { headers: { 'sec-fetch-site': 'cross-site' } })
    expectProblem(res, 403)
    expect(res.json()).toEqual({ error: 'forbidden' })
    expect(repository.rows).toEqual([])
    for (const site of ['same-origin', 'none']) {
      expect((await post(target, VALID, { headers: { 'sec-fetch-site': site } })).statusCode).toBe(201)
    }
  })

  it.each([
    ['text/plain', JSON.stringify(VALID)],
    ['application/x-www-form-urlencoded', 'firstName=Jane'],
    ['multipart/form-data; boundary=x', '--x--'],
    ['application/jsonp', JSON.stringify(VALID)],
  ])('refuses Content-Type %s with 415 and stores nothing', async (contentType, payload) => {
    const repository = new MemoryRepository()
    const res = await post(appWith({ repository }), payload, { headers: { 'content-type': contentType } })
    expectProblem(res, 415)
    expect(res.json()).toEqual({ error: 'unsupported_media_type' })
    expect(repository.rows).toEqual([])
  })

  it('refuses a body with no Content-Type with 415', async () => {
    const target = appWith({ repository: new MemoryRepository() })
    const res = await target.inject({ method: 'POST', url: URL, body: Buffer.from(JSON.stringify(VALID)) })
    expectProblem(res, 415)
    expect(res.json()).toEqual({ error: 'unsupported_media_type' })
  })

  it('refuses a body over 4 KB with 413 and stores nothing, but accepts one just under', async () => {
    const repository = new MemoryRepository()
    const target = appWith({ repository })
    const big = JSON.stringify({ ...VALID, lastName: 'x'.repeat(4096) })
    const res = await post(target, big, { headers: { 'content-type': 'application/json' } })
    expectProblem(res, 413)
    expect(res.json()).toEqual({ error: 'too_large' })
    expect(repository.rows).toEqual([])
    const padded = JSON.stringify(VALID) + ' '.repeat(4096 - JSON.stringify(VALID).length)
    expect(Buffer.byteLength(padded)).toBe(4096)
    expect((await post(target, padded, { headers: { 'content-type': 'application/json' } })).statusCode).toBe(201)
  })

  it('limits each client IP per minute, keyed on the socket address and not X-Forwarded-For', async () => {
    let now = NOW.getTime()
    const repository = new MemoryRepository()
    const target = appWith({ repository, now: () => new Date(now), rateLimits: { perIpPerMin: 2, globalPerMin: 100 } })
    const from = (remoteAddress: string, forwarded?: string) =>
      post(target, VALID, { remoteAddress, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } })
    expect((await from('10.0.0.1', '203.0.113.1')).statusCode).toBe(201)
    expect((await from('10.0.0.1', '203.0.113.2')).statusCode).toBe(201)
    const limited = await from('10.0.0.1', '203.0.113.3')
    expectProblem(limited, 429)
    expect(limited.json()).toEqual({ error: 'rate_limited' })
    expect(repository.rows).toHaveLength(2)
    expect((await from('10.0.0.2')).statusCode).toBe(201)
    now += 60_000
    expect((await from('10.0.0.1')).statusCode).toBe(201)
  })

  it('limits all clients together per minute', async () => {
    const target = appWith({ repository: new MemoryRepository(), rateLimits: { perIpPerMin: 100, globalPerMin: 2 } })
    expect((await post(target, VALID, { remoteAddress: '10.0.0.1' })).statusCode).toBe(201)
    expect((await post(target, VALID, { remoteAddress: '10.0.0.2' })).statusCode).toBe(201)
    const limited = await post(target, VALID, { remoteAddress: '10.0.0.3' })
    expectProblem(limited, 429)
    expect(limited.json()).toEqual({ error: 'rate_limited' })
  })

  it('applies the configured defaults of 30 per IP and 300 overall', async () => {
    const target = appWith({ repository: new MemoryRepository() })
    for (let i = 0; i < 30; i += 1) {
      expect((await post(target, VALID, { remoteAddress: '10.9.9.9' })).statusCode).toBe(201)
    }
    expect((await post(target, VALID, { remoteAddress: '10.9.9.9' })).statusCode).toBe(429)
  })

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)('%s /api/registrations is 405 with Allow: POST', async (method) => {
    const repository = new MemoryRepository()
    const res = await appWith({ repository }).inject({ method, url: URL })
    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('POST')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.json()).toEqual({ error: { message: expect.any(String) } })
    expect(res.body).not.toContain('Jane')
  })

  it.each(['HEAD', 'OPTIONS', 'TRACE'] as const)('%s /api/registrations is 405 with Allow: POST too', async (method) => {
    const res = await appWith({ repository: new MemoryRepository() }).inject({ method, url: URL })
    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('POST')
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('answers 404 for any other path under /api', async () => {
    const res = await appWith({ repository: new MemoryRepository() }).inject({ method: 'POST', url: '/api/other', payload: VALID })
    expect(res.statusCode).toBe(404)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('store failures (500) @story:ST-2 @criterion:AC-5', () => {
  it('answers internal when no store is attached, and logs it without detail', async () => {
    const logs = captureLogs()
    const res = await post(appWith({ repository: null }), SENTINELS)
    expectProblem(res, 500)
    expect(res.json()).toEqual({ error: 'internal' })
    expect(logs.map((call) => call.at(-1))).toContain('db.insert_failed')
  })

  it('answers internal when the insert is refused, logging only the SQLSTATE', async () => {
    const logs = captureLogs()
    const failure = Object.assign(new Error(`permission denied: ${SENTINELS.email}`), { code: '42501' })
    const repository: RegistrationRepository = { insert: async () => Promise.reject(failure) }
    const res = await post(appWith({ repository }), SENTINELS)
    expectProblem(res, 500)
    expect(res.json()).toEqual({ error: 'internal' })
    expect(logs).toContainEqual(['error', { sqlstate: '42501' }, 'db.insert_failed'])
    expect(JSON.stringify(logs)).not.toContain(SENTINELS.email)
  })

  it('maps an unexpected framework error to internal without detail', async () => {
    captureLogs()
    const target = appWith({ repository: new MemoryRepository() })
    target.addHook('preHandler', async (request) => {
      if (request.url === URL) throw new Error(`boom ${SENTINELS.firstName}`)
    })
    const res = await post(target, SENTINELS)
    expectProblem(res, 500)
    expect(res.json()).toEqual({ error: 'internal' })
    expect(res.body).not.toContain(SENTINELS.firstName)
  })
})

describe('no response or log line echoes a submitted value @story:ST-2 @criterion:AC-5', () => {
  const failing: RegistrationRepository = {
    insert: async () => Promise.reject(Object.assign(new Error(JSON.stringify(SENTINELS)), { code: '23514' })),
  }
  const cases: [string, Partial<AppOptions>, unknown, Record<string, string>][] = [
    ['201', { repository: new MemoryRepository() }, SENTINELS, {}],
    ['400 invalid', { repository: new MemoryRepository() }, { ...SENTINELS, phone: `+1${SENTINELS.phone}` }, {}],
    ['400 unknown field', { repository: new MemoryRepository() }, { ...SENTINELS, [SENTINELS.lastName]: 1 }, {}],
    ['403', { repository: new MemoryRepository() }, SENTINELS, { 'sec-fetch-site': 'cross-site' }],
    ['500', { repository: failing }, SENTINELS, {}],
  ]

  it.each(cases)(
    '%s carries no last name, email or phone, and only a 201 carries the first name',
    async (status, options, payload, headers) => {
      const logs = captureLogs()
      const res = await post(appWith(options), payload, { headers })
      expect(String(res.statusCode)).toBe(status.split(' ')[0])
      for (const value of [SENTINELS.lastName, SENTINELS.email, SENTINELS.phone, '2128675309']) {
        expect(res.body).not.toContain(value)
        expect(JSON.stringify(res.headers)).not.toContain(value)
      }
      if (res.statusCode !== 201) expect(res.body).not.toContain(SENTINELS.firstName)
      const logged = JSON.stringify(logs)
      for (const value of [...Object.values(SENTINELS), '2128675309', '127.0.0.1']) {
        expect(logged).not.toContain(value)
      }
    },
  )

  it('logs registration.created on success and nothing about the visitor', async () => {
    const logs = captureLogs()
    await post(appWith({ repository: new MemoryRepository() }), SENTINELS)
    expect(logs).toContainEqual(['info', 'registration.created'])
  })
})

describe('configuration for the save path @story:ST-2 @criterion:AC-2', () => {
  it('defaults to 30 per IP and 300 overall, with no store unless DATABASE_URL is set', () => {
    expect(loadConfig({})).toMatchObject({ rateLimits: { perIpPerMin: 30, globalPerMin: 300 } })
    expect(loadConfig({}).databaseUrl).toBeUndefined()
    expect(
      loadConfig({ DATABASE_URL: 'postgresql://app@db/registrations', RATE_LIMIT_PER_IP_PER_MIN: '5', RATE_LIMIT_GLOBAL_PER_MIN: '50' }),
    ).toMatchObject({ databaseUrl: 'postgresql://app@db/registrations', rateLimits: { perIpPerMin: 5, globalPerMin: 50 } })
  })

  it.each(['0', '-1', '1.5', 'abc', '', '1e3'])('refuses rate limit %j without echoing it', (bad) => {
    for (const name of ['RATE_LIMIT_PER_IP_PER_MIN', 'RATE_LIMIT_GLOBAL_PER_MIN']) {
      expect(() => loadConfig({ [name]: bad })).toThrow(new Error(`${name} must be a positive whole number.`))
    }
  })

  it('start() serves 500 and logs startup.db_unavailable when the store cannot be reached', async () => {
    const logs = captureLogs()
    const started = await start({
      port: 0,
      host: '127.0.0.1',
      webRoot: NO_WEB_ROOT,
      databaseUrl: 'postgresql://nobody:SECRET-pw@127.0.0.1:1/registrations',
    })
    try {
      const res = await post(started, VALID)
      expectProblem(res, 500)
      expect(logs.map((call) => call.at(-1))).toContain('startup.db_unavailable')
      expect(JSON.stringify(logs)).not.toContain('SECRET-pw')
    } finally {
      await started.close()
    }
  })
})
