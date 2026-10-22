import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'
import { submitRegistration } from './api.js'

// ST-10 / IF-2 — the screen's client for POST /api/registrations, built against the
// step-7 contract (a verbatim copy of contracts/IF-2.json at step 7), never the API's code.
// Every mocked response body is validated against the contract before the client sees it.
const contract = JSON.parse(readFileSync(new URL('./fixtures/IF-2.contract.json', import.meta.url), 'utf8')) as Record<string, unknown>
const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema(contract, 'if2')

const responseSchema = (status: string): string => {
  const operation = (
    contract as { paths: Record<string, { post: { responses: Record<string, { content: Record<string, { schema: unknown }> }> } }> }
  ).paths['/api/registrations'].post
  const response = operation.responses[status]
  expect(response, `IF-2 documents ${status}`).toBeDefined()
  const [media] = Object.values(response.content)
  return JSON.stringify(media.schema)
}

/** A fetch double answering with a body the contract accepts for that status. */
function contractResponse(status: number, body: unknown) {
  const schema = JSON.parse(responseSchema(String(status)).replaceAll('"#/', '"if2#/')) as object
  const valid = ajv.validate(schema, body)
  expect(valid, `${status} body matches IF-2: ${ajv.errorsText()}`).toBe(true)
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
}

const requestSchema = { $ref: 'if2#/components/schemas/RegistrationRequest' }

const long = (length: number) => 'a'.repeat(length)
const values = { firstName: 'Siobhan', lastName: "O'Brien", email: 'siobhan@example.com', phone: '(415) 555-0132' }

describe('Feature: Have my real name accepted, with a clear limit on length — the IF-2 client', () => {
  describe('Scenario Outline: Real-world names are accepted as written @AC-1', () => {
    it.each([
      ['Siobhan', "O'Brien"],
      ['Anne-Marie', 'Dupont'],
      ['José', 'Anne-Marie'],
    ])('When I enter "%s" and "%s" and press Submit, the body carries them exactly as typed', async (firstName, lastName) => {
      const fetchFn = contractResponse(201, { firstName, createdAt: '2026-10-22T09:15:00Z' })
      const action = await submitRegistration({ ...values, firstName, lastName }, fetchFn)
      expect(fetchFn).toHaveBeenCalledTimes(1)
      const [url, init] = fetchFn.mock.calls[0]
      expect(url).toBe('/api/registrations')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
      const sent = JSON.parse(String(init?.body)) as Record<string, string>
      expect(sent).toEqual({ ...values, firstName, lastName })
      expect(ajv.validate(requestSchema, sent), ajv.errorsText()).toBe(true)
      expect(action).toEqual({ type: 'submitted', firstName })
    })
  })

  describe('Scenario: A name of exactly 100 characters is accepted @AC-2', () => {
    it('sends all 100 characters and maps 201 to the confirmation', async () => {
      const fetchFn = contractResponse(201, { firstName: 'Siobhan', createdAt: '2026-10-22T09:15:00Z' })
      const action = await submitRegistration({ ...values, lastName: long(100) }, fetchFn)
      expect((JSON.parse(String(fetchFn.mock.calls[0][1]?.body)) as { lastName: string }).lastName).toHaveLength(100)
      expect(action).toEqual({ type: 'submitted', firstName: 'Siobhan' })
    })
  })

  describe('Scenario: An over-long first name is flagged @AC-3', () => {
    it('sends all 101 characters — nothing is cut off client-side — and flags only First name with the server’s message', async () => {
      const message = 'First name must be 100 characters or fewer.'
      const fetchFn = contractResponse(400, { error: 'validation', fields: { firstName: [message] } })
      const action = await submitRegistration({ ...values, firstName: long(101) }, fetchFn)
      expect((JSON.parse(String(fetchFn.mock.calls[0][1]?.body)) as { firstName: string }).firstName).toHaveLength(101)
      expect(action).toEqual({ type: 'failed', errors: { firstName: message } })
    })
  })

  describe('Scenario: An over-long last name is flagged @AC-3', () => {
    it('renders the server’s last-name message verbatim and flags no other field', async () => {
      const message = 'Last name must be 100 characters or fewer.'
      const fetchFn = contractResponse(400, { error: 'validation', fields: { lastName: [message, 'a second message'] } })
      expect(await submitRegistration({ ...values, lastName: long(101) }, fetchFn)).toEqual({
        type: 'failed',
        errors: { lastName: message },
      })
    })

    it('keeps both name messages when both are too long', async () => {
      const fetchFn = contractResponse(400, {
        error: 'validation',
        fields: { firstName: ['First name must be 100 characters or fewer.'], lastName: ['Last name must be 100 characters or fewer.'] },
      })
      expect(await submitRegistration({ ...values, firstName: long(101), lastName: long(101) }, fetchFn)).toEqual({
        type: 'failed',
        errors: { firstName: 'First name must be 100 characters or fewer.', lastName: 'Last name must be 100 characters or fewer.' },
      })
    })
  })

  describe('400 edge cases', () => {
    it('a malformed-JSON 400 with fields {} flags no field', async () => {
      const fetchFn = contractResponse(400, { error: 'validation', fields: {} })
      expect(await submitRegistration(values, fetchFn)).toEqual({ type: 'failed', errors: {} })
    })

    it('an empty message list flags no field', async () => {
      const fetchFn = contractResponse(400, { error: 'validation', fields: { firstName: [] } })
      expect(await submitRegistration(values, fetchFn)).toEqual({ type: 'failed', errors: {} })
    })

    it('a 400 whose body is not JSON flags no field', async () => {
      const fetchFn = vi.fn(async () => new Response('nope', { status: 400 }))
      expect(await submitRegistration(values, fetchFn)).toEqual({ type: 'failed', errors: {} })
    })

    it('a 400 whose fields are not lists of strings flags no field', async () => {
      const fetchFn = vi.fn(
        async () => new Response(JSON.stringify({ error: 'validation', fields: { firstName: [1], lastName: 'x' } }), { status: 400 }),
      )
      expect(await submitRegistration(values, fetchFn)).toEqual({ type: 'failed', errors: {} })
    })

    it('a 400 without fields flags no field', async () => {
      const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: 'validation' }), { status: 400 }))
      expect(await submitRegistration(values, fetchFn)).toEqual({ type: 'failed', errors: {} })
    })
  })

  describe('every other outcome is a failed save, never a confirmation', () => {
    it.each([
      [403, 'forbidden'],
      [413, 'too_large'],
      [415, 'unsupported_media_type'],
      [429, 'rate_limited'],
      [500, 'internal'],
    ])('%i (%s) maps to saveFailed', async (status, error) => {
      const fetchFn = contractResponse(status, { error })
      expect(await submitRegistration(values, fetchFn)).toEqual({ type: 'saveFailed' })
    })

    it('an undocumented 2xx is not a confirmation', async () => {
      const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
      expect(await submitRegistration(values, fetchFn)).toEqual({ type: 'saveFailed' })
    })

    it('a network failure maps to saveFailed', async () => {
      const fetchFn = vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
      expect(await submitRegistration(values, fetchFn)).toEqual({ type: 'saveFailed' })
    })

    it('a 201 whose body cannot be read still confirms, greeting the name as entered', async () => {
      const fetchFn = vi.fn(async () => new Response('not json', { status: 201 }))
      expect(await submitRegistration({ ...values, firstName: '  José ' }, fetchFn)).toEqual({ type: 'submitted', firstName: 'José' })
    })
  })

  it('uses the global fetch by default, same-origin and relative', async () => {
    const fetchFn = contractResponse(201, { firstName: 'Siobhan', createdAt: '2026-10-22T09:15:00Z' })
    vi.stubGlobal('fetch', fetchFn)
    try {
      expect(await submitRegistration(values)).toEqual({ type: 'submitted', firstName: 'Siobhan' })
      expect(fetchFn.mock.calls[0][0]).toBe('/api/registrations')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
