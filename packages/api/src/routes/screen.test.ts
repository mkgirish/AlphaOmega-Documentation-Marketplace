import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'

// ST-1 — CMP-3 serves the built registration screen (SCR-1) from the one container.
// The tests stand up a fake vite build in a temp dir so they never depend on a prior
// `vite build` of packages/web.
const INDEX_HTML =
  '<!doctype html><html lang="en"><head><title>Visitor registration</title>' +
  '<script type="module" src="/assets/index-abc123.js"></script>' +
  '<link rel="stylesheet" href="/assets/index-abc123.css"></head><body><div id="root"></div></body></html>'
const SECRET = 'outside-the-web-root-sentinel'

let root: string
let webRoot: string
let app: FastifyInstance

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'st1-screen-'))
  webRoot = join(root, 'dist')
  mkdirSync(join(webRoot, 'assets'), { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), INDEX_HTML)
  writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), 'console.log("screen")')
  writeFileSync(join(webRoot, 'assets', 'index-abc123.css'), 'body{margin:0}')
  writeFileSync(join(webRoot, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(webRoot, 'assets', 'notes.txt'), 'not a web asset')
  writeFileSync(join(root, 'secret.js'), SECRET)
  app = buildApp({ webRoot })
})

afterAll(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

const browser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }

describe('ST-1 AC-1: http://localhost:3000/ serves the registration screen', () => {
  it('answers a browser at / with the built index.html', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: browser })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.body).toBe(INDEX_HTML)
  })

  it('never lets a browser cache a stale screen', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: browser })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('keeps the IF-2 liveness answer for non-browser probes at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { accept: 'application/json' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(res.headers.vary).toBe('Accept')
  })

  it('answers HEAD / for a browser without a body', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/', headers: browser })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.body).toBe('')
  })

  it('reports the screen as unavailable, without leaking the path, when no build is present', async () => {
    const missing = join(root, 'no-build-here')
    const bare = buildApp({ webRoot: missing })
    const res = await bare.inject({ method: 'GET', url: '/', headers: browser })
    expect(res.statusCode).toBe(503)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(res.json()).toEqual({ error: { message: 'The registration screen is not available.' } })
    expect(res.body).not.toContain(missing)
    await bare.close()
  })

  it('resolves the screen from packages/web/dist by default', async () => {
    const defaulted = buildApp()
    const res = await defaulted.inject({ method: 'GET', url: '/', headers: browser })
    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    } else {
      expect(res.statusCode).toBe(503)
      expect(res.json()).toEqual({ error: { message: 'The registration screen is not available.' } })
    }
    expect(res.body).not.toContain('packages/web')
    await defaulted.close()
  })
})

describe('ST-1 AC-7: every request the page makes is served by the container itself', () => {
  it.each([
    ['index-abc123.js', 'text/javascript; charset=utf-8', 'console.log("screen")'],
    ['index-abc123.css', 'text/css; charset=utf-8', 'body{margin:0}'],
    ['logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  ])('serves /assets/%s as %s', async (file, type, body) => {
    const res = await app.inject({ method: 'GET', url: `/assets/${file}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe(type)
    expect(res.body).toBe(body)
  })

  it('lets the browser cache the content-hashed bundle for a year', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it.each([
    ['a missing asset', '/assets/index-missing.js'],
    ['a file type the screen never loads', '/assets/notes.txt'],
    ['a dot-dot traversal', '/assets/../secret.js'],
    ['an encoded traversal', '/assets/..%2fsecret.js'],
    ['a double-encoded traversal', '/assets/..%252fsecret.js'],
    ['a nested path', '/assets/sub/index-abc123.js'],
    ['a hidden file', '/assets/.env'],
    ['the index under /assets', '/assets/..%2findex.html'],
  ])('refuses %s with the AD-5 not-found envelope', async (_label, url) => {
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { message: 'Not found.' } })
    expect(res.body).not.toContain(SECRET)
  })

  it('does not serve files from the web root outside /assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/index.html' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { message: 'Not found.' } })
  })
})
