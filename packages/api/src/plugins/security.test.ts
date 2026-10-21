import { connect } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, start } from '../main.js'
import { BODY_LIMIT } from './security.js'

// ST-1 AC-7 and the http-hardening anchors: exact security headers on every response,
// no CORS, no trusted proxy, and error bodies that never echo what was sent.
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; " +
  "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

const SENTINEL = 'SENTINEL-7f3a9c-visitor@example.com'
const NO_WEB_ROOT = '/nonexistent-web-root'

let app: FastifyInstance | undefined

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: NO_WEB_ROOT })
  await warm.inject({ method: 'GET', url: '/' })
  await warm.close()
}, 30_000)

afterEach(async () => {
  await app?.close()
  app = undefined
})

function withProbeRoutes(): FastifyInstance {
  app = buildApp({ webRoot: NO_WEB_ROOT })
  app.post('/probe', async (request) => ({ ok: request.body !== undefined }))
  app.get('/ip', async (request) => ({ ip: request.ip }))
  app.get('/boom', async () => {
    throw new Error(`database said: ${SENTINEL}`)
  })
  app.get('/teapot', async () => {
    const err = new Error(`client said: ${SENTINEL}`) as Error & { statusCode: number }
    err.statusCode = 418
    throw err
  })
  return app
}

function expectHardened(headers: Record<string, unknown>): void {
  expect(headers['content-security-policy']).toBe(EXPECTED_CSP)
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe('no-referrer')
  expect(headers['cross-origin-opener-policy']).toBe('same-origin')
  expect(headers['cross-origin-resource-policy']).toBe('same-origin')
  expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
  expect(headers['cache-control']).toBe('no-store')
  expect(headers['x-powered-by']).toBeUndefined()
}

async function rawRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let data = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => (data += chunk))
    socket.on('end', () => resolve(data))
    socket.on('error', reject)
    socket.write(request)
  })
}

describe('security headers @story:ST-1 @criterion:AC-7', () => {
  it.each([
    ['GET', '/', 'text/html'],
    ['GET', '/', 'application/json'],
    ['GET', '/admin', 'text/html'],
    ['GET', '/api/registrations', '*/*'],
  ])('%s %s (%s) carries the exact CSP and hardening headers', async (method, url, accept) => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await app.inject({ method: method as 'GET', url, headers: { accept } })
    expectHardened(res.headers)
  })

  it('limits scripts to self', async () => {
    app = buildApp({ webRoot: NO_WEB_ROOT })
    const res = await app.inject({ method: 'GET', url: '/' })
    const csp = String(res.headers['content-security-policy'])
    expect(csp.split('; ')).toContain("script-src 'self'")
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/)
  })

  it('enables no CORS and trusts no X-Forwarded-For', async () => {
    const probe = withProbeRoutes()
    const res = await probe.inject({ method: 'GET', url: '/', headers: { origin: 'https://evil.example' } })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expectHardened(res.headers)
    const preflight = await probe.inject({
      method: 'OPTIONS',
      url: '/',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    })
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    expect([404, 405]).toContain(preflight.statusCode)
    const ip = await probe.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '203.0.113.9' },
      remoteAddress: '10.1.2.3',
    })
    expect(ip.json()).toEqual({ ip: '10.1.2.3' })
  })
})

describe('error envelopes never echo the request', () => {
  it('answers malformed JSON with 400 and a generic envelope', async () => {
    const res = await withProbeRoutes().inject({
      method: 'POST',
      url: '/probe',
      headers: { 'content-type': 'application/json' },
      payload: `{"email":"${SENTINEL}"`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { message: 'The request could not be read.' } })
    expect(res.body).not.toContain(SENTINEL)
    expectHardened(res.headers)
  })

  it('answers an unsupported content type with 415 and a generic envelope', async () => {
    const res = await withProbeRoutes().inject({
      method: 'POST',
      url: '/probe',
      headers: { 'content-type': 'text/xml' },
      payload: `<email>${SENTINEL}</email>`,
    })
    expect(res.statusCode).toBe(415)
    expect(res.json()).toEqual({ error: { message: 'Unsupported content type.' } })
    expect(res.body).not.toContain(SENTINEL)
    expectHardened(res.headers)
  })

  it('answers a body over the limit with 413 and a generic envelope', async () => {
    const payload = JSON.stringify({ email: SENTINEL, pad: 'x'.repeat(BODY_LIMIT) })
    const res = await withProbeRoutes().inject({
      method: 'POST',
      url: '/probe',
      headers: { 'content-type': 'application/json' },
      payload,
    })
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({ error: { message: 'The request is too large.' } })
    expect(res.body).not.toContain(SENTINEL)
    expectHardened(res.headers)
  })

  it('answers other client errors with their status and a generic envelope', async () => {
    const res = await withProbeRoutes().inject({ method: 'GET', url: '/teapot' })
    expect(res.statusCode).toBe(418)
    expect(res.json()).toEqual({ error: { message: 'The request could not be processed.' } })
    expect(res.body).not.toContain(SENTINEL)
    expectHardened(res.headers)
  })

  it('answers an unexpected failure with 500 and no internal detail', async () => {
    const res = await withProbeRoutes().inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
    expect(res.body).not.toContain(SENTINEL)
    expect(res.body).not.toContain('database')
    expectHardened(res.headers)
  })

  it.each(['/%zz', '/assets/%E0%A4%A', '/%E0%A4%A'])('answers the badly encoded URL %s with 400 and a generic envelope', async (prefix) => {
    const res = await withProbeRoutes().inject({ method: 'GET', url: `${prefix}${SENTINEL}` })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { message: 'The request could not be read.' } })
    expect(res.body).not.toContain(SENTINEL)
    expectHardened(res.headers)
  })

  it('never echoes a submitted value on an unknown route or the registrations route', async () => {
    const probe = withProbeRoutes()
    const unknown = await probe.inject({
      method: 'POST',
      url: `/api/unknown?email=${encodeURIComponent(SENTINEL)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: SENTINEL }),
    })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json()).toEqual({ error: { message: 'Not found.' } })
    expect(unknown.body).not.toContain(SENTINEL)
    // ST-8 adds POST /api/registrations: its 400 names the failing fields, never their values.
    const registration = await probe.inject({
      method: 'POST',
      url: `/api/registrations?email=${encodeURIComponent(SENTINEL)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ fullName: SENTINEL, email: SENTINEL, phone: SENTINEL }),
    })
    expect(registration.statusCode).toBe(400)
    expect(registration.body).not.toContain(SENTINEL)
    expectHardened(registration.headers)
  })
})

describe('requests Node cannot parse', () => {
  it.each([
    ['a garbled request line', `GARBAGE ${SENTINEL}\r\n\r\n`, 400, 'The request could not be read.'],
    [
      'oversized headers',
      `GET / HTTP/1.1\r\nhost: x\r\nx-big: ${SENTINEL}${'x'.repeat(20_000)}\r\n\r\n`,
      431,
      'The request headers are too large.',
    ],
  ])('answers %s with the envelope and hardening headers', async (_name, request, status, message) => {
    app = await start({ port: 0, host: '127.0.0.1', webRoot: NO_WEB_ROOT })
    const address = app.server.address()
    if (address === null || typeof address === 'string') throw new Error('no TCP address')
    const raw = await rawRequest(address.port, request)
    const [head = '', body = ''] = raw.split('\r\n\r\n')
    expect(head.split('\r\n')[0]).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `))
    const headers = Object.fromEntries(
      head
        .split('\r\n')
        .slice(1)
        .map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]),
    )
    expectHardened(headers)
    expect(JSON.parse(body)).toEqual({ error: { message } })
    expect(raw).not.toContain(SENTINEL)
  })
})
