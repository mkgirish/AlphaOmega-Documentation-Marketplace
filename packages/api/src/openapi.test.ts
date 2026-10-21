import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './main.js'

// AD-4 — the committed openapi.json documents every route ST-1 adds, and every answer
// the routes give (status and media type) is one the document declares.
interface Operation {
  responses: Record<string, { content?: Record<string, unknown> }>
}
const doc = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, Operation>>
}

let root: string
let app: FastifyInstance
let bare: FastifyInstance

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'st1-openapi-'))
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Visitor registration</title>')
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'void 0')
  app = buildApp({ webRoot: root })
  bare = buildApp({ webRoot: join(root, 'missing') })
})

afterAll(async () => {
  await app.close()
  await bare.close()
  rmSync(root, { recursive: true, force: true })
})

const ST1_PATHS = ['/', '/assets/{file}'] as const

const cases = [
  ['/', '/', { accept: 'text/html' }, 'app', 200],
  ['/', '/', { accept: 'text/html' }, 'bare', 503],
  ['/assets/{file}', '/assets/index-abc123.js', {}, 'app', 200],
  ['/assets/{file}', '/assets/missing.js', {}, 'app', 404],
] as const

describe('AD-4: openapi.json documents the ST-1 surface', () => {
  it('declares the screen and asset routes, read-only', () => {
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/', '/assets/{file}']))
    for (const path of ST1_PATHS) expect(Object.keys(doc.paths[path])).toEqual(['get'])
    expect(Object.keys(doc.paths['/'].get.responses['200'].content ?? {}).sort()).toEqual(['application/json', 'text/html'])
  })

  it.each(cases)('GET %s (%s, %j) answers a declared status and media type', async (path, url, headers, which, status) => {
    const res = await (which === 'app' ? app : bare).inject({ method: 'GET', url, headers })
    expect(res.statusCode).toBe(status)
    const declared = doc.paths[path].get.responses[String(status)]
    expect(declared).toBeDefined()
    const mediaType = String(res.headers['content-type']).split(';')[0]
    expect(Object.keys(declared.content ?? {})).toContain(mediaType)
  })

  it('declares the AD-5 error envelope for every ST-1 error status', () => {
    let errors = 0
    for (const path of ST1_PATHS) {
      for (const [status, response] of Object.entries(doc.paths[path].get.responses)) {
        if (Number(status) < 400) continue
        errors += 1
        expect(response.content?.['application/json']).toEqual({ schema: { $ref: '#/components/schemas/ErrorEnvelope' } })
      }
    }
    expect(errors).toBeGreaterThanOrEqual(2)
  })
})
