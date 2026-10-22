import { readFileSync } from 'node:fs'
import pino from 'pino'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './main.js'

// ST-11 contract tests via inject: every status POST /api/registrations answers is
// documented in the committed openapi.json, and each body conforms to its schema.
type Schema = {
  $ref?: string
  type?: string
  required?: string[]
  additionalProperties?: boolean | Schema
  properties?: Record<string, Schema>
  items?: Schema
  const?: unknown
  maxLength?: number
}
type Operation = {
  requestBody?: { required?: boolean; content: Record<string, { schema: Schema }> }
  responses: Record<string, { content?: Record<string, { schema?: Schema }> }>
}
type OpenApi = { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } }

const openapi = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as OpenApi

function resolve(raw: Schema): Schema | undefined {
  return raw.$ref === undefined ? raw : openapi.components.schemas[raw.$ref.replace('#/components/schemas/', '')]
}

function violations(value: unknown, raw: Schema, at = '$'): string[] {
  const schema = resolve(raw)
  if (schema === undefined) return [`${at}: unresolved ${raw.$ref}`]
  if (schema.const !== undefined && value !== schema.const) return [`${at} is not ${JSON.stringify(schema.const)}`]
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' ? [] : [`${at} is not a string`]
    case 'array':
      if (!Array.isArray(value)) return [`${at} is not an array`]
      return value.flatMap((item, i) => violations(item, schema.items ?? {}, `${at}[${i}]`))
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${at} is not an object`]
      const record = value as Record<string, unknown>
      const props = schema.properties ?? {}
      const missing = (schema.required ?? []).filter((k) => !(k in record)).map((k) => `${at}.${k} is missing`)
      const extra = Object.entries(record)
        .filter(([k]) => !(k in props))
        .flatMap(([k, v]) => {
          if (schema.additionalProperties === false) return [`${at}.${k} is not allowed`]
          if (typeof schema.additionalProperties === 'object') return violations(v, schema.additionalProperties, `${at}.${k}`)
          return []
        })
      const nested = Object.entries(props)
        .filter(([k]) => k in record)
        .flatMap(([k, s]) => violations(record[k], s, `${at}.${k}`))
      return [...missing, ...extra, ...nested]
    }
    default:
      return []
  }
}

beforeAll(async () => {
  // Warm Fastify's first-use compilation outside any test's timeout.
  const warm = buildApp({ webRoot: '/nonexistent-web-root', logger: pino({ level: 'silent' }) })
  await warm.inject({ method: 'POST', url: '/api/registrations', headers: { 'content-type': 'application/json' }, payload: '{}' })
  await warm.close()
}, 30_000)

const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const json = { 'content-type': 'application/json' }

type Case = { name: string; status: number; payload: string; headers?: Record<string, string>; store?: 'ok' | 'none' | 'fails' }

const cases: Case[] = [
  { name: 'created', status: 201, payload: JSON.stringify(VALID) },
  { name: 'missing email', status: 400, payload: JSON.stringify({ ...VALID, email: undefined }) },
  { name: 'several invalid fields', status: 400, payload: JSON.stringify({ ...VALID, email: 'jane@', phone: '5550132' }) },
  { name: 'malformed JSON', status: 400, payload: '{firstName:' },
  { name: 'unexpected field', status: 400, payload: JSON.stringify({ ...VALID, id: 5 }) },
  { name: 'cross-site', status: 403, payload: JSON.stringify(VALID), headers: { 'sec-fetch-site': 'cross-site' } },
  { name: 'too large', status: 413, payload: JSON.stringify({ ...VALID, pad: 'x'.repeat(5 * 1024) }) },
  { name: 'not JSON', status: 415, payload: JSON.stringify(VALID), headers: { 'content-type': 'text/plain' } },
  { name: 'store failed', status: 500, payload: JSON.stringify(VALID), store: 'fails' },
  { name: 'no store', status: 503, payload: JSON.stringify(VALID), store: 'none' },
]

describe('POST /api/registrations honours the committed openapi.json @story:ST-11 @criterion:AC-1 @criterion:AC-2 @criterion:AC-3 @criterion:AC-4', () => {
  it.each(cases)('$name answers a documented $status with a conforming body', async (c) => {
    const registrations =
      c.store === 'none'
        ? undefined
        : {
            save: async () => {
              if (c.store === 'fails') throw new Error('boom')
            },
          }
    const app = buildApp({ webRoot: '/nonexistent-web-root', registrations, logger: pino({ level: 'silent' }) })
    const res = await app.inject({ method: 'POST', url: '/api/registrations', headers: { ...json, ...c.headers }, payload: c.payload })
    await app.close()
    expect(res.statusCode).toBe(c.status)
    expect(String(res.headers['content-type']).split(';')[0]).toBe('application/json')
    const documented = openapi.paths['/api/registrations']?.post?.responses[String(c.status)]
    expect(documented, `POST /api/registrations ${c.status} documented`).toBeDefined()
    const schema = documented?.content?.['application/json']?.schema
    expect(schema).toBeDefined()
    expect(violations(res.json(), schema ?? {})).toEqual([])
  })

  it('documents a JSON-only request body with exactly the four form fields', () => {
    const op = openapi.paths['/api/registrations']?.post
    expect(op?.requestBody?.required).toBe(true)
    expect(Object.keys(op?.requestBody?.content ?? {})).toEqual(['application/json'])
    const body = resolve(op?.requestBody?.content['application/json']?.schema ?? {})
    expect(body?.additionalProperties).toBe(false)
    expect(Object.keys(body?.properties ?? {}).sort()).toEqual(['email', 'firstName', 'lastName', 'phone'])
    expect(body?.required?.slice().sort()).toEqual(['email', 'firstName', 'lastName', 'phone'])
  })

  it('documents the validation envelope and no response carrying a row id', () => {
    const validation = resolve({ $ref: '#/components/schemas/ValidationError' })
    expect(validation?.properties?.error?.const).toBe('validation')
    const created = JSON.stringify(openapi.paths['/api/registrations']?.post?.responses['201'])
    const createdSchema = JSON.stringify(resolve({ $ref: '#/components/schemas/RegistrationCreated' }))
    expect(`${created}${createdSchema}`).not.toMatch(/"id"/)
    expect(Object.keys(openapi.paths['/api/registrations'] ?? {})).toEqual(['post'])
  })
})
