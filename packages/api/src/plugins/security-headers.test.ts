import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'

// ST-1 AC-7 and AD-16 — the page response carries a Content-Security-Policy that limits
// scripts to 'self', and every other response is hardened the same way.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

let root: string
let app: FastifyInstance

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'st1-headers-'))
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Visitor registration</title>')
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'void 0')
  app = buildApp({ webRoot: root })
})

afterAll(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

const responses = [
  ['the page', '/', { accept: 'text/html' }],
  ['the liveness probe', '/', { accept: 'application/json' }],
  ['a bundle asset', '/assets/index-abc123.js', {}],
  ['a not-found answer', '/admin', {}],
] as const

describe('ST-1 AC-7: the Content-Security-Policy limits scripts to self', () => {
  it.each(responses)('%s carries the exact AD-16 policy', async (_label, url, headers) => {
    const res = await app.inject({ method: 'GET', url, headers })
    expect(res.headers['content-security-policy']).toBe(CSP)
  })

  it("the page's policy contains script-src 'self' and allows no inline or remote script", async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } })
    const policy = String(res.headers['content-security-policy'])
    const scriptSrc = policy
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBe("script-src 'self'")
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/)
  })
})

describe('AD-16 hardening headers', () => {
  it.each(responses)('%s carries the fixed hardening headers', async (_label, url, headers) => {
    const res = await app.inject({ method: 'GET', url, headers })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('enables no CORS, whatever the origin asks for', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['content-security-policy']).toBe(CSP)
    const get = await app.inject({ method: 'GET', url: '/', headers: { origin: 'https://evil.example', accept: 'text/html' } })
    expect(get.headers['access-control-allow-origin']).toBeUndefined()
  })
})
