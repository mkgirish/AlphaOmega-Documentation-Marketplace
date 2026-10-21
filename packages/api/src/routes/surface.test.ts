import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'

// ST-1 AC-3 — there is nowhere else to go: no admin, login or listing page exists, and
// nothing stored can be read back. The write-only surface gate holds for every method.
let root: string
let app: FastifyInstance

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'st1-surface-'))
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Visitor registration</title>')
  app = buildApp({ webRoot: root })
})

afterAll(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

const browser = { accept: 'text/html,*/*;q=0.8' }
const NO_PAGE = [{ error: { message: 'Not found.' } }, { error: { message: 'Method not allowed.' } }]
const NOWHERE = ['/admin', '/admin/', '/login', '/registrations', '/api/registrations', '/api/registrations/1', '/docs', '/metrics']

describe('ST-1 AC-3: no admin or listing page can be reached', () => {
  it.each(NOWHERE)('GET %s returns no page and no stored data', async (url) => {
    for (const headers of [browser, { accept: 'application/json' }]) {
      const res = await app.inject({ method: 'GET', url, headers })
      expect([404, 405]).toContain(res.statusCode)
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
      expect(NO_PAGE).toContainEqual(res.json())
      expect(res.body).not.toContain('<html')
    }
  })

  it('never echoes the requested path or query back', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin?who=sentinel-visitor@example.com' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('admin')
    expect(res.body).not.toContain('sentinel')
  })

  it.each(['PUT', 'PATCH', 'DELETE'] as const)('%s on the screen route reads or changes nothing', async (method) => {
    const res = await app.inject({ method, url: '/' })
    expect([404, 405]).toContain(res.statusCode)
    expect(NO_PAGE).toContainEqual(res.json())
  })

  it('registers no read, list, admin or docs route', () => {
    const routes = app.printRoutes({ commonPrefix: false })
    expect(routes).toContain('assets/:file')
    expect(routes).not.toMatch(/admin|login|docs|swagger|metrics/i)
    for (const url of NOWHERE) expect(app.hasRoute({ method: 'GET', url })).toBe(false)
  })
})

describe('the AD-5 error envelope never carries internal detail', () => {
  it('maps a client error to a fixed message', async () => {
    const probe = buildApp({ webRoot: root })
    probe.get('/__probe-400', async () => {
      throw Object.assign(new Error('db said: sentinel-detail'), { statusCode: 400 })
    })
    const res = await probe.inject({ method: 'GET', url: '/__probe-400' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { message: 'Bad request.' } })
    expect(res.headers['content-security-policy']).toBeDefined()
    await probe.close()
  })

  it('maps an unexpected failure to a 500 with a fixed message', async () => {
    const probe = buildApp({ webRoot: root })
    probe.get('/__probe-500', async () => {
      throw new Error('relation "registrations" sentinel-detail')
    })
    const res = await probe.inject({ method: 'GET', url: '/__probe-500' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { message: 'Something went wrong.' } })
    expect(res.body).not.toContain('sentinel')
    await probe.close()
  })
})
