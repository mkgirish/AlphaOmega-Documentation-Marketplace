import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { buildApp } from '../main.js'
import { CONTENT_SECURITY_POLICY } from '../plugins/security.js'

// ST-1 (CMP-3): the API serves the built registration screen from the same origin.
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const INDEX_HTML =
  '<!doctype html><html lang="en"><head><title>Visitor registration</title>' +
  '<script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>'
const OUTSIDE = 'outside-assets-sentinel'
const ENVELOPE_404 = { error: { message: 'Not found.' } }

let webRoot: string
let outside: string
let app: FastifyInstance | undefined

beforeAll(async () => {
  webRoot = mkdtempSync(join(tmpdir(), 'st1-web-'))
  outside = mkdtempSync(join(tmpdir(), 'st1-outside-'))
  mkdirSync(join(webRoot, 'assets', 'nested'), { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), INDEX_HTML)
  writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), 'console.log("screen")')
  writeFileSync(join(webRoot, 'assets', 'index-abc123.css'), 'main{max-width:480px}')
  writeFileSync(join(webRoot, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(webRoot, 'assets', 'font.woff2'), 'woff2')
  writeFileSync(join(webRoot, 'assets', 'data.bin'), 'bin')
  writeFileSync(join(webRoot, 'assets', 'nested', 'deep.js'), 'export {}')
  writeFileSync(join(webRoot, 'secret.txt'), OUTSIDE)
  writeFileSync(join(outside, 'secret.txt'), OUTSIDE)
  symlinkSync(join(outside, 'secret.txt'), join(webRoot, 'assets', 'link.js'))
  symlinkSync(outside, join(webRoot, 'assets', 'dirlink'))
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot })
  await warm.inject({ method: 'GET', url: '/', headers: { accept: BROWSER_ACCEPT } })
  await warm.close()
}, 30_000)

afterAll(() => {
  rmSync(webRoot, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

function appWith(root: string = webRoot): FastifyInstance {
  app = buildApp({ webRoot: root })
  return app
}

describe('GET / serves the registration screen @story:ST-1 @criterion:AC-1', () => {
  it('returns the built index.html to a browser with the strict CSP @story:ST-1 @criterion:AC-7', async () => {
    const res = await appWith().inject({ method: 'GET', url: '/', headers: { accept: BROWSER_ACCEPT } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/html(;|$)/i)
    expect(res.body).toBe(INDEX_HTML)
    expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['vary']).toMatch(/accept/i)
  })

  it('answers HEAD for the screen without a body', async () => {
    const res = await appWith().inject({ method: 'HEAD', url: '/', headers: { accept: 'text/html' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/html(;|$)/i)
    expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    expect(res.body).toBe('')
  })

  it.each([undefined, '*/*', 'application/json', 'text/html;q=0, application/json'])(
    'keeps the IF-2 liveness JSON for a probe sending Accept %s',
    async (accept) => {
      const headers: Record<string, string> = accept === undefined ? {} : { accept }
      const res = await appWith().inject({ method: 'GET', url: '/', headers })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/^application\/json/)
      expect(res.json()).toEqual({ ok: true })
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.headers['vary']).toMatch(/accept/i)
    },
  )

  it('answers 503 with an envelope when the screen has not been built', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'st1-empty-'))
    try {
      const res = await appWith(empty).inject({ method: 'GET', url: '/', headers: { accept: BROWSER_ACCEPT } })
      expect(res.statusCode).toBe(503)
      expect(res.headers['content-type']).toMatch(/^application\/json/)
      expect(res.json()).toEqual({ error: { message: 'The registration screen is not available.' } })
      expect(res.body).not.toContain(empty)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('serves the screen from the configured packages/web/dist by default', async () => {
    app = buildApp()
    const implicit = await app.inject({ method: 'GET', url: '/', headers: { accept: BROWSER_ACCEPT } })
    await app.close()
    app = buildApp({ webRoot: loadConfig().webRoot })
    const explicit = await app.inject({ method: 'GET', url: '/', headers: { accept: BROWSER_ACCEPT } })
    expect(implicit.statusCode).toBe(explicit.statusCode)
    expect(implicit.body).toBe(explicit.body)
    expect(implicit.headers['content-type']).toMatch(implicit.statusCode === 200 ? /^text\/html/i : /^application\/json/)
  })
})

describe('GET /assets/* serves the bundle from the same origin @story:ST-1 @criterion:AC-7', () => {
  it.each([
    ['/assets/index-abc123.js', /^(text|application)\/javascript/i, 'console.log("screen")'],
    ['/assets/index-abc123.css', /^text\/css/i, 'main{max-width:480px}'],
    ['/assets/logo.svg', /^image\/svg\+xml/i, '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['/assets/font.woff2', /^font\/woff2/i, 'woff2'],
    ['/assets/data.bin', /^application\/octet-stream/i, 'bin'],
    ['/assets/nested/deep.js', /^(text|application)\/javascript/i, 'export {}'],
  ])('serves %s', async (url, type, body) => {
    const res = await appWith().inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(type)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body).toBe(body)
  })

  it.each([
    '/assets/missing.js',
    '/assets/',
    '/assets/nested',
    '/assets/..%2fsecret.txt',
    '/assets/%2e%2e/secret.txt',
    '/assets/..%2f..%2f..%2fetc%2fpasswd',
    '/assets/%00.js',
    '/assets/link.js',
    '/assets/dirlink/secret.txt',
    '/index.html',
    '/secret.txt',
  ])('answers 404 with the envelope for %s and never leaks a file', async (url) => {
    const res = await appWith().inject({ method: 'GET', url })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual(ENVELOPE_404)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).not.toContain(OUTSIDE)
    expect(res.body).not.toContain(webRoot)
  })
})

describe('there is nowhere else to go @story:ST-1 @criterion:AC-3', () => {
  const routes: [string, string][] = [
    ['GET', '/admin'],
    ['GET', '/admin/'],
    ['HEAD', '/admin'],
    ['GET', '/login'],
    ['GET', '/api/registrations'],
    ['GET', '/api/registrations/1'],
    ['GET', '/registrations'],
    ['POST', '/admin'],
    ['DELETE', '/api/registrations'],
    ['PUT', '/'],
  ]
  const accepts: (string | undefined)[] = [BROWSER_ACCEPT, '*/*', undefined]
  const cases = routes.flatMap(([method, url]) => accepts.map((accept) => [method, url, accept] as const))

  it.each(cases)('%s %s (Accept %s) answers 404 or 405 with no page and no stored data', async (method, url, accept) => {
    const headers: Record<string, string> = accept === undefined ? {} : { accept }
    const res = await appWith().inject({ method: method as 'GET', url, headers })
    expect([404, 405]).toContain(res.statusCode)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    expect(res.body).not.toContain('<html')
    if (method === 'HEAD') return
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.json()).toEqual(res.statusCode === 404 ? ENVELOPE_404 : { error: { message: expect.any(String) } })
  })
})
