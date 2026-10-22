import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import { createLogger } from '../observability/index.js'

// ST-11 contract tests via inject: every status POST /api/registrations answers is
// documented in the committed openapi.json with a conforming body, and none carries an id.
type Schema = {
  $ref?: string
  type?: string
  enum?: string[]
  required?: string[]
  additionalProperties?: boolean
  properties?: Record<string, Schema>
  items?: Schema
}
type Media = Record<string, { schema?: Schema }>
type OpenApi = {
  paths: Record<string, Record<string, { requestBody?: { content: Media }; responses: Record<string, { content?: Media }> }>>
  components: { schemas: Record<string, Schema>; responses: Record<string, { content?: Media }> }
}

const openapi = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as OpenApi

function violations(value: unknown, raw: Schema, at = '$'): string[] {
  const schema = raw.$ref === undefined ? raw : openapi.components.schemas[raw.$ref.replace('#/components/schemas/', '')]
  if (schema === undefined) return [`${at}: unresolved ${raw.$ref}`]
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return [`${at} is not a string`]
      return schema.enum === undefined || schema.enum.includes(value) ? [] : [`${at} is not one of ${schema.enum}`]
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${at} is not a boolean`]
    case 'array':
      if (!Array.isArray(value)) return [`${at} is not an array`]
      return value.flatMap((item, i) => violations(item, schema.items ?? {}, `${at}[${i}]`))
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
        .flatMap(([k, s]) => violations(record[k], s, `${at}.${k}`))
      return [...missing, ...extra, ...nested]
    }
    default:
      return [`${at}: unsupported schema ${JSON.stringify(schema)}`]
  }
}

const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const operation = openapi.paths['/api/registrations']?.post

let app: FastifyInstance

beforeAll(async () => {
  app = buildApp({
    webRoot: '/nonexistent-web-root',
    logger: createLogger(undefined, 'silent'),
    store: {
      // A last name of FAIL stands in for a database that refuses the save.
      insert: async ({ lastName }) => {
        if (lastName === 'FAIL') throw new Error('relation "registrations" does not exist')
      },
      close: async () => {},
    },
  })
  await app.ready()
}, 30_000)

afterAll(async () => {
  await app.close()
})

type Case = { name: string; criterion: string; payload: string; headers?: Record<string, string>; status: number }

const cases: Case[] = [
  { name: 'a valid registration', criterion: 'AC-1', payload: JSON.stringify(VALID), status: 201 },
  { name: 'a failed save', criterion: 'AC-5', payload: JSON.stringify({ ...VALID, lastName: 'FAIL' }), status: 500 },
  { name: 'a missing email', criterion: 'AC-1', payload: JSON.stringify({ ...VALID, email: undefined }), status: 400 },
  {
    name: 'several invalid fields',
    criterion: 'AC-2',
    payload: JSON.stringify({ ...VALID, email: 'jane@', phone: '5550132' }),
    status: 400,
  },
  { name: 'malformed JSON', criterion: 'AC-3', payload: '{firstName:', status: 400 },
  { name: 'an unexpected field', criterion: 'AC-3', payload: JSON.stringify({ ...VALID, id: 5 }), status: 400 },
  { name: 'text/plain', criterion: 'AC-4', payload: JSON.stringify(VALID), headers: { 'content-type': 'text/plain' }, status: 415 },
  { name: 'a 5 KB body', criterion: 'AC-4', payload: JSON.stringify({ ...VALID, lastName: 'x'.repeat(5120) }), status: 413 },
  {
    name: 'a cross-site request',
    criterion: 'AC-4',
    payload: JSON.stringify(VALID),
    headers: { 'sec-fetch-site': 'cross-site' },
    status: 403,
  },
]

describe('POST /api/registrations honours the committed openapi.json @story:ST-11', () => {
  it('documents the request body the screen sends, and it refuses unknown fields @criterion:AC-3', () => {
    const schema = operation?.requestBody?.content['application/json']?.schema ?? {}
    expect(violations(VALID, schema)).toEqual([])
    expect(violations({ ...VALID, id: 5 }, schema)).toEqual(['$.id is not allowed'])
  })

  it.each(cases)('$name answers a documented $status with a conforming body and no id @criterion:$criterion', async (c) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/registrations',
      headers: { 'content-type': 'application/json', ...c.headers },
      payload: c.payload,
    })
    expect(res.statusCode).toBe(c.status)
    expect(String(res.headers['content-type']).split(';')[0]).toBe('application/json')
    expect(res.headers['cache-control']).toBe('no-store')
    const media = operation?.responses[String(c.status)]?.content?.['application/json']
    expect(media, `POST /api/registrations ${c.status} documented`).toBeDefined()
    expect(violations(res.json(), media?.schema ?? {})).toEqual([])
    expect(res.body).not.toMatch(UUID)
    expect(res.body).not.toMatch(/relation|registrations/)
  })

  it('documents 405 for every other method and no read, update or delete operation @criterion:AC-4', async () => {
    expect(Object.keys(openapi.paths['/api/registrations'] ?? {})).toEqual(['post'])
    const res = await app.inject({ method: 'GET', url: '/api/registrations' })
    expect(res.statusCode).toBe(405)
    const schema = openapi.components.responses.MethodNotAllowed?.content?.['application/json']?.schema ?? {}
    expect(violations(res.json(), schema)).toEqual([])
  })
})
