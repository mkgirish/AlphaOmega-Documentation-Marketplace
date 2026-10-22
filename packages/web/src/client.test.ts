import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'
import { postRegistration, registrationsPath } from './client.js'

// IF-2 consumer tests: every mocked answer is first validated against the contract the
// screen consumes (src/contract/IF-2.json, a verbatim copy of the IF-2 contract handed to this part),
// so the client is built against the contract and never against the API's code.
const contract = JSON.parse(readFileSync(new URL('./contract/IF-2.json', import.meta.url), 'utf8'))
const operation = contract.paths['/api/registrations'].post
const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema(contract, 'IF-2')

function schemaRef(content: Record<string, { schema: { $ref: string } }>): { $ref: string } {
  const [media] = Object.values(content)
  return { $ref: `IF-2${media.schema.$ref}` }
}

function contractAllows(status: number, body: unknown): boolean {
  return ajv.validate(schemaRef(operation.responses[String(status)].content), body)
}

/** A fetch that answers once with a contract-valid response for the given status. */
function answer(status: number, body: unknown) {
  expect(contractAllows(status, body), `IF-2 ${status} body ${JSON.stringify(body)}`).toBe(true)
  const media = Object.keys(operation.responses[String(status)].content)[0]
  return vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': media, 'Cache-Control': 'no-store' } }),
  )
}

const jane = { firstName: ' Jane ', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }

describe('Feature: Submit my details and see a confirmation once my visit is saved — the IF-2 client', () => {
  it('posts the four values, exactly as typed, as one same-origin JSON request the contract accepts (AC-3, AC-6)', async () => {
    const fetch = answer(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    await postRegistration(jane, fetch)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/registrations')
    expect(registrationsPath).toBe('/api/registrations')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(init.credentials).toBe('same-origin')
    expect(init.cache).toBe('no-store')
    const sent = JSON.parse(String(init.body))
    expect(sent).toEqual(jane)
    expect(ajv.validate(schemaRef(operation.requestBody.content), sent)).toBe(true)
  })

  it('201 → created, with the firstName and createdAt the API sent and nothing else (AC-5)', async () => {
    const outcome = await postRegistration(jane, answer(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }))
    expect(outcome).toEqual({ kind: 'created', firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
  })

  it('the contract itself refuses a 201 that leaks a row id (AC-5)', () => {
    expect(contractAllows(201, { id: 7, firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })).toBe(false)
  })

  it('400 with field messages → invalid, each message kept verbatim on its own field', async () => {
    const phone = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
    const outcome = await postRegistration(jane, answer(400, { error: 'validation', fields: { phone: [phone], email: ['One.', 'Two.'] } }))
    expect(outcome).toEqual({ kind: 'invalid', fieldErrors: { phone, email: 'One. Two.' } })
  })

  it('400 with fields {} (malformed JSON) → invalid with no field flagged', async () => {
    const outcome = await postRegistration(jane, answer(400, { error: 'validation', fields: {} }))
    expect(outcome).toEqual({ kind: 'invalid', fieldErrors: {} })
  })

  it('400 never flags a field the API sent an empty list for', async () => {
    const outcome = await postRegistration(jane, answer(400, { error: 'validation', fields: { lastName: [] } }))
    expect(outcome).toEqual({ kind: 'invalid', fieldErrors: {} })
  })

  it.each([
    [403, 'forbidden'],
    [413, 'too_large'],
    [415, 'unsupported_media_type'],
    [429, 'rate_limited'],
    [500, 'internal'],
  ])('%i (%s) → failed: the screen shows the save-failed alert', async (status, error) => {
    expect(await postRegistration(jane, answer(status, { error }))).toEqual({ kind: 'failed' })
  })

  it('no answer at all (network failure) → failed', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await postRegistration(jane, fetch)).toEqual({ kind: 'failed' })
  })

  it('an answer outside the contract never shows a confirmation', async () => {
    const respond = (status: number, body: string) => vi.fn(async () => new Response(body, { status }))
    expect(await postRegistration(jane, respond(201, 'not json'))).toEqual({ kind: 'failed' })
    expect(await postRegistration(jane, respond(201, '{"createdAt":"2026-10-20T14:03:27Z"}'))).toEqual({ kind: 'failed' })
    expect(await postRegistration(jane, respond(201, '{"firstName":"Jane"}'))).toEqual({ kind: 'failed' })
    expect(await postRegistration(jane, respond(200, '{"firstName":"Jane","createdAt":"2026-10-20T14:03:27Z"}'))).toEqual({
      kind: 'failed',
    })
    expect(await postRegistration(jane, respond(400, 'not json'))).toEqual({ kind: 'failed' })
    expect(await postRegistration(jane, respond(400, '{"error":"validation"}'))).toEqual({ kind: 'failed' })
    expect(await postRegistration(jane, respond(400, '{"error":"validation","fields":{"phone":"text"}}'))).toEqual({ kind: 'failed' })
    expect(await postRegistration(jane, respond(502, ''))).toEqual({ kind: 'failed' })
  })

  it('ignores a field name the screen does not have', async () => {
    const respond = vi.fn(async () => new Response('{"error":"validation","fields":{"id":["No."],"email":["Bad."]}}', { status: 400 }))
    expect(await postRegistration(jane, respond)).toEqual({ kind: 'invalid', fieldErrors: { email: 'Bad.' } })
  })

  it('uses the browser fetch when none is given', async () => {
    const fetch = answer(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    vi.stubGlobal('fetch', fetch)
    try {
      expect((await postRegistration(jane)).kind).toBe('created')
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
