import { readFileSync } from 'node:fs'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp, type AppOptions } from '../main.js'
import { logger } from '../observability/index.js'
import type { RegistrationRepository } from '../persistence/repository.js'

// IF-2 contract tests via inject: every status POST /api/registrations answers is
// documented in the committed openapi.json, its media type and Cache-Control header match,
// and its body validates against the documented schema — which never offers a row id.
type Schema = {
  $ref?: string
  type?: string
  const?: unknown
  enum?: unknown[]
  pattern?: string
  maxLength?: number
  required?: string[]
  additionalProperties?: boolean | Schema
  properties?: Record<string, Schema>
  items?: Schema
  allOf?: Schema[]
}
type Media = { schema?: Schema }
type Response = { headers?: Record<string, { $ref?: string; schema?: Schema }>; content?: Record<string, Media> }
type Operation = {
  operationId?: string
  requestBody?: { required?: boolean; content: Record<string, Media> }
  responses: Record<string, Response>
}
type OpenApi = {
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, Schema>; headers?: Record<string, { schema?: Schema }> }
}

const openapi = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as OpenApi

function resolveRef<T>(ref: string): T {
  const parts = ref.replace('#/', '').split('/')
  return parts.reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], openapi) as T
}

function violations(value: unknown, raw: Schema, at = '$'): string[] {
  const schema = raw.$ref === undefined ? raw : resolveRef<Schema | undefined>(raw.$ref)
  if (schema === undefined) return [`${at}: unresolved ${raw.$ref}`]
  const found: string[] = []
  for (const part of schema.allOf ?? []) found.push(...violations(value, part, at))
  if (schema.const !== undefined && value !== schema.const) found.push(`${at} is not ${JSON.stringify(schema.const)}`)
  if (schema.enum !== undefined && !schema.enum.includes(value)) found.push(`${at} is not in the enum`)
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return [...found, `${at} is not a string`]
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) found.push(`${at} breaks pattern`)
      if (schema.maxLength !== undefined && [...value].length > schema.maxLength) found.push(`${at} is too long`)
      return found
    case 'integer':
      return Number.isInteger(value) ? found : [...found, `${at} is not an integer`]
    case 'array':
      if (!Array.isArray(value)) return [...found, `${at} is not an array`]
      return [...found, ...value.flatMap((item, i) => violations(item, schema.items ?? {}, `${at}[${i}]`))]
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [...found, `${at} is not an object`]
      const record = value as Record<string, unknown>
      const props = schema.properties ?? {}
      for (const key of schema.required ?? []) if (!(key in record)) found.push(`${at}.${key} is missing`)
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) if (!(key in props)) found.push(`${at}.${key} is not allowed`)
      }
      for (const [key, sub] of Object.entries(props)) if (key in record) found.push(...violations(record[key], sub, `${at}.${key}`))
      return found
    }
    default:
      return found
  }
}

const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }
const operation = openapi.paths['/api/registrations']?.post

const memory: RegistrationRepository = { insert: async () => undefined }
const failing: RegistrationRepository = {
  insert: async () => Promise.reject(Object.assign(new Error('insert failed'), { code: '42501' })),
}

type Case = { name: string; status: number; options?: Partial<AppOptions>; inject: Partial<InjectOptions> }
const json = { 'content-type': 'application/json' }
const cases: Case[] = [
  { name: 'saved', status: 201, inject: { payload: VALID } },
  { name: 'invalid phone', status: 400, inject: { payload: { ...VALID, phone: '+14155550132' } } },
  { name: 'malformed JSON', status: 400, inject: { payload: '{', headers: json } },
  { name: 'unknown property', status: 400, inject: { payload: { ...VALID, id: 1 } } },
  { name: 'cross-site', status: 403, inject: { payload: VALID, headers: { 'sec-fetch-site': 'cross-site' } } },
  { name: 'too large', status: 413, inject: { payload: JSON.stringify({ ...VALID, lastName: 'x'.repeat(5000) }), headers: json } },
  { name: 'not JSON', status: 415, inject: { payload: 'firstName=Jane', headers: { 'content-type': 'text/plain' } } },
  { name: 'rate limited', status: 429, options: { rateLimits: { perIpPerMin: 1, globalPerMin: 10 } }, inject: { payload: VALID } },
  { name: 'store refused', status: 500, options: { repository: failing }, inject: { payload: VALID } },
  { name: 'no store', status: 500, options: { repository: null }, inject: { payload: VALID } },
]

let app: FastifyInstance | undefined

beforeAll(async () => {
  const warm = buildApp({ webRoot: '/nonexistent', repository: memory })
  await warm.inject({ method: 'POST', url: '/api/registrations', payload: VALID })
  await warm.close()
}, 30_000)

afterEach(async () => {
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

describe('POST /api/registrations honours openapi.json @story:ST-2 @criterion:AC-5', () => {
  it('documents exactly the IF-2 statuses, a required JSON body and no other method', () => {
    expect(operation?.operationId).toBe('createRegistration')
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(['201', '400', '403', '413', '415', '429', '500'])
    expect(operation?.requestBody?.required).toBe(true)
    expect(Object.keys(operation?.requestBody?.content ?? {})).toEqual(['application/json'])
    const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
    expect(Object.keys(openapi.paths['/api/registrations'] ?? {}).filter((key) => methods.includes(key))).toEqual(['post'])
  })

  it('documents a request schema that is strict and a 201 schema with no row id', () => {
    const request = resolveRef<Schema>('#/components/schemas/RegistrationRequest')
    expect(request.additionalProperties).toBe(false)
    expect(request.required?.sort()).toEqual(['email', 'firstName', 'lastName', 'phone'])
    const created = resolveRef<Schema>('#/components/schemas/RegistrationCreated')
    expect(created.additionalProperties).toBe(false)
    expect(Object.keys(created.properties ?? {}).sort()).toEqual(['createdAt', 'firstName'])
    expect(violations(VALID, operation?.requestBody?.content['application/json']?.schema ?? {})).toEqual([])
  })

  it.each(cases)('$name answers a documented $status with a conforming body and no-store', async (c) => {
    vi.spyOn(logger, 'error').mockImplementation((() => undefined) as never)
    vi.spyOn(logger, 'info').mockImplementation((() => undefined) as never)
    const target = buildApp({ webRoot: '/nonexistent', repository: memory, ...c.options })
    app = target
    const send = () => target.inject({ method: 'POST', url: '/api/registrations', ...c.inject })
    if (c.status === 429) await send()
    const res = await send()
    expect(res.statusCode).toBe(c.status)
    const documented = operation?.responses[String(res.statusCode)]
    expect(documented, `${res.statusCode} documented`).toBeDefined()
    const mediaType = String(res.headers['content-type']).split(';')[0]?.trim() ?? ''
    const media = documented?.content?.[mediaType]
    expect(media, `${mediaType} documented for ${res.statusCode}`).toBeDefined()
    expect(violations(res.json(), media?.schema ?? {})).toEqual([])
    const header = documented?.headers?.['Cache-Control']
    const headerSchema = header?.$ref === undefined ? header?.schema : resolveRef<{ schema: Schema }>(header.$ref).schema
    expect(headerSchema?.const).toBe('no-store')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).not.toMatch(/"id"|reqId|insert failed|42501/)
  })
})
