import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, start } from './main.js'

// Contract tests via inject: every status the ST-1 surface answers is documented in the
// committed openapi.json with a conforming body, and the liveness probe honours IF-2.
type Schema = {
  $ref?: string
  type?: string
  required?: string[]
  additionalProperties?: boolean
  properties?: Record<string, Schema>
  items?: Schema
}
type Operation = { responses: Record<string, { content?: Record<string, { schema?: Schema }> }> }
type OpenApi = {
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, Schema>; responses?: Record<string, unknown> }
}

function load(relative: string): OpenApi {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as OpenApi
}

const openapi = load('../openapi.json')
const if2 = load('../../../contracts/IF-2.json')

function violations(doc: OpenApi, value: unknown, raw: Schema, at = '$'): string[] {
  const schema = raw.$ref === undefined ? raw : doc.components.schemas[raw.$ref.replace('#/components/schemas/', '')]
  if (schema === undefined) return [`${at}: unresolved ${raw.$ref}`]
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' ? [] : [`${at} is not a string`]
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${at} is not a boolean`]
    case 'array':
      if (!Array.isArray(value)) return [`${at} is not an array`]
      return value.flatMap((item, i) => violations(doc, item, schema.items ?? {}, `${at}[${i}]`))
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${at} is not an object`]
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
        .flatMap(([k, s]) => violations(doc, record[k], s, `${at}.${k}`))
      return [...missing, ...extra, ...nested]
    }
    default:
      return []
  }
}

let webRoot: string

beforeAll(async () => {
  webRoot = mkdtempSync(join(tmpdir(), 'st1-contract-'))
  mkdirSync(join(webRoot, 'assets'))
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Visitor registration</title>')
  writeFileSync(join(webRoot, 'assets', 'index-1.js'), 'export {}')
  writeFileSync(join(webRoot, 'assets', 'index-1.css'), 'main{}')
  writeFileSync(join(webRoot, 'assets', 'logo.svg'), '<svg/>')
  writeFileSync(join(webRoot, 'assets', 'font.woff2'), 'woff2')
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot })
  await warm.inject({ method: 'GET', url: '/' })
  await warm.close()
}, 30_000)

afterAll(() => {
  rmSync(webRoot, { recursive: true, force: true })
})

type Case = { name: string; root?: string; url: string; path: string; accept?: string; status: number; mediaType: string }

const cases: Case[] = [
  { name: 'screen HTML', url: '/', path: '/', accept: 'text/html', status: 200, mediaType: 'text/html' },
  {
    name: 'screen not built',
    root: '/nonexistent',
    url: '/',
    path: '/',
    accept: 'text/html',
    status: 503,
    mediaType: 'application/json',
  },
  { name: 'script asset', url: '/assets/index-1.js', path: '/assets/{file}', status: 200, mediaType: 'text/javascript' },
  { name: 'style asset', url: '/assets/index-1.css', path: '/assets/{file}', status: 200, mediaType: 'text/css' },
  { name: 'image asset', url: '/assets/logo.svg', path: '/assets/{file}', status: 200, mediaType: 'image/svg+xml' },
  { name: 'font asset', url: '/assets/font.woff2', path: '/assets/{file}', status: 200, mediaType: 'font/woff2' },
  { name: 'missing asset', url: '/assets/x.js', path: '/assets/{file}', status: 404, mediaType: 'application/json' },
]

describe('responses honour the committed openapi.json @story:ST-1 @criterion:AC-1', () => {
  it.each(cases)('$name is a documented status with a conforming body', async (c) => {
    const app = buildApp({ webRoot: c.root ?? webRoot })
    const headers: Record<string, string> = c.accept === undefined ? {} : { accept: c.accept }
    const res = await app.inject({ method: 'GET', url: c.url, headers })
    await app.close()
    expect(res.statusCode).toBe(c.status)
    const mediaType = String(res.headers['content-type']).split(';')[0]?.toLowerCase() ?? ''
    expect(mediaType).toBe(c.mediaType)
    const documented = openapi.paths[c.path]?.get?.responses[String(res.statusCode)]
    expect(documented, `GET ${c.path} ${res.statusCode} documented`).toBeDefined()
    const media = documented?.content?.[mediaType]
    expect(media, `${mediaType} documented for ${res.statusCode}`).toBeDefined()
    if (mediaType === 'application/json') {
      expect(violations(openapi, res.json(), media?.schema ?? {})).toEqual([])
    }
  })

  it('documents both the liveness JSON and the screen HTML for GET / 200, and the liveness honours IF-2', async () => {
    const app = buildApp({ webRoot })
    const res = await app.inject({ method: 'GET', url: '/', headers: { accept: 'application/json' } })
    await app.close()
    const ok = openapi.paths['/']?.get?.responses['200']?.content ?? {}
    expect(Object.keys(ok).sort()).toEqual(['application/json', 'text/html'])
    expect(violations(openapi, res.json(), ok['application/json']?.schema ?? {})).toEqual([])
    const contract = if2.paths['/']?.get?.responses['200']?.content?.['application/json']?.schema
    expect(contract).toBeDefined()
    expect(violations(if2, res.json(), contract ?? {})).toEqual([])
  })

  it('documents the not-found envelope and no read, list or admin operation', async () => {
    const app = buildApp({ webRoot })
    const res = await app.inject({ method: 'GET', url: '/admin' })
    await app.close()
    expect(res.statusCode).toBe(404)
    expect(openapi.components.responses).toHaveProperty('NotFound')
    expect(violations(openapi, res.json(), { $ref: '#/components/schemas/ErrorEnvelope' })).toEqual([])
    for (const [path, ops] of Object.entries(openapi.paths)) {
      expect(path).not.toMatch(/admin|login/)
      if (/registrations/.test(path)) {
        expect(Object.keys(ops).filter((m) => ['get', 'put', 'patch', 'delete'].includes(m))).toEqual([])
      }
    }
  })
})

describe('start() listens on a real port @story:ST-1 @criterion:AC-1', () => {
  it('serves the screen over HTTP and closes cleanly', async () => {
    const app = await start({ port: 0, host: '127.0.0.1', webRoot })
    try {
      const address = app.server.address()
      if (address === null || typeof address === 'string') throw new Error('no TCP address')
      const res = await fetch(`http://127.0.0.1:${address.port}/`, { headers: { accept: 'text/html' } })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
      expect(await res.text()).toContain('Visitor registration')
    } finally {
      await app.close()
    }
  })
})
