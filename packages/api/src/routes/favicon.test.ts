import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../main.js'
import { CONTENT_SECURITY_POLICY } from '../plugins/security.js'

// ST-1 AC-7: browsers ask for /favicon.ico on their own when the screen opens. It is
// answered from the container with an empty 204, so the Network panel shows no failed
// request and nothing outside http://localhost:3000; it is no page (AC-3).
type Responses = Record<string, { content?: Record<string, unknown> }>
const openapi = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { responses: Responses }>>
}

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('GET /favicon.ico answers from the container @story:ST-1 @criterion:AC-7', () => {
  it.each(['GET', 'HEAD'] as const)('%s answers 204 with no body, the strict headers and a day of caching', async (method) => {
    app = buildApp({ webRoot: '/nonexistent' })
    const res = await app.inject({
      method,
      url: '/favicon.ico',
      headers: { accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    expect(res.headers['content-type']).toBeUndefined()
    expect(res.headers['cache-control']).toBe('public, max-age=86400')
    expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('is documented in the committed openapi.json as an empty 204 and nothing else', () => {
    const operations = openapi.paths['/favicon.ico'] ?? {}
    expect(Object.keys(operations)).toEqual(['get'])
    const responses = operations.get?.responses ?? {}
    expect(Object.keys(responses).sort()).toEqual(['204', '500'])
    expect(responses['204']?.content).toBeUndefined()
  })
})
