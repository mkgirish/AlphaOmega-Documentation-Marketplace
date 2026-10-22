import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'
import { postRegistration } from './client.js'

// IF-2 consumer tests: every mocked response is first validated against the committed
// contract copy, so the client is built against the contract and not the API's code.
const contract = JSON.parse(readFileSync(new URL('../contract/IF-2.json', import.meta.url), 'utf8'))
const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema(contract, 'if2')
const schema = (name: string) => {
  const validate = ajv.getSchema(`if2#/components/schemas/${name}`)
  if (!validate) throw new Error(`IF-2 has no schema ${name}`)
  return validate
}
const responses = contract.paths['/api/registrations'].post.responses

/** A Response whose body is checked against the contract's schema for that status. */
function contractResponse(status: number, body: unknown): Response {
  const media: Record<string, { schema: { $ref: string } }> = responses[String(status)].content
  const [type, entry] = Object.entries(media)[0]
  const validate = schema(entry.schema.$ref.split('/').pop() as string)
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true)
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } })
}

const values = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }

const stubFetch = (response: Response | Promise<Response>) => vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response))

describe('Feature: Be told when my email address is not complete — IF-2 client', () => {
  describe('Scenario: A complete email is accepted @AC-1', () => {
    it('When I press Submit, one same-origin POST to /api/registrations carries the four values as entered', async () => {
      const fetchFn = stubFetch(contractResponse(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }))
      await postRegistration(values, fetchFn)
      expect(fetchFn).toHaveBeenCalledTimes(1)
      const [url, init] = fetchFn.mock.calls[0]
      expect(url).toBe('/api/registrations')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual(values)
      const validate = schema('RegistrationRequest')
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true)
    })

    it('Then a 201 is the saved outcome carrying the first name the API returned', async () => {
      const fetchFn = stubFetch(contractResponse(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }))
      expect(await postRegistration(values, fetchFn)).toEqual({ kind: 'saved', firstName: 'Jane' })
    })

    it('a 201 whose body is not the contract shape is not treated as saved', async () => {
      expect(await postRegistration(values, stubFetch(new Response('{}', { status: 201 })))).toEqual({ kind: 'failed' })
      expect(await postRegistration(values, stubFetch(new Response('not json', { status: 201 })))).toEqual({ kind: 'failed' })
    })
  })

  describe('Scenario: The API applies the same email rule @AC-5', () => {
    it('Then a 400 with an error for "email" flags only email, with the server message verbatim', async () => {
      const message = 'A server message, shown exactly as sent.'
      const fetchFn = stubFetch(contractResponse(400, { error: 'validation', fields: { email: [message] } }))
      expect(await postRegistration({ ...values, email: 'jane@example' }, fetchFn)).toEqual({
        kind: 'invalid',
        errors: { email: message },
      })
    })

    it('a 400 for several fields flags each with its first message', async () => {
      const fetchFn = stubFetch(
        contractResponse(400, { error: 'validation', fields: { email: ['e1', 'e2'], phone: ['p1'], lastName: [] } }),
      )
      expect(await postRegistration(values, fetchFn)).toEqual({ kind: 'invalid', errors: { email: 'e1', phone: 'p1' } })
    })

    it('a 400 with fields {} yields no field errors and flags nothing', async () => {
      const fetchFn = stubFetch(contractResponse(400, { error: 'validation', fields: {} }))
      expect(await postRegistration(values, fetchFn)).toEqual({ kind: 'invalid', errors: {} })
    })

    it('a 400 whose body is not a validation problem is a failed save', async () => {
      expect(await postRegistration(values, stubFetch(new Response('oops', { status: 400 })))).toEqual({ kind: 'failed' })
      expect(await postRegistration(values, stubFetch(new Response('{"error":"validation"}', { status: 400 })))).toEqual({
        kind: 'failed',
      })
      expect(
        await postRegistration(
          values,
          stubFetch(new Response('{"error":"validation","fields":{"id":["x"],"email":"x"}}', { status: 400 })),
        ),
      ).toEqual({ kind: 'invalid', errors: {} })
    })
  })

  describe('every other status and the network are failed saves', () => {
    it.each([
      [403, 'forbidden'],
      [413, 'too_large'],
      [415, 'unsupported_media_type'],
      [429, 'rate_limited'],
      [500, 'internal'],
    ])('%i (%s)', async (status, error) => {
      expect(await postRegistration(values, stubFetch(contractResponse(status, { error })))).toEqual({ kind: 'failed' })
    })

    it('a status the contract does not list', async () => {
      expect(await postRegistration(values, stubFetch(new Response('', { status: 502 })))).toEqual({ kind: 'failed' })
    })

    it('a network failure', async () => {
      const fetchFn = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
      expect(await postRegistration(values, fetchFn)).toEqual({ kind: 'failed' })
    })
  })

  it('uses the global fetch by default', async () => {
    const fetchFn = stubFetch(contractResponse(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }))
    vi.stubGlobal('fetch', fetchFn)
    try {
      expect(await postRegistration(values)).toEqual({ kind: 'saved', firstName: 'Jane' })
      expect(fetchFn).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
