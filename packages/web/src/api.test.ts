import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'
import { registrationPath, submitRegistration } from './api.js'

// IF-2 (the approved step-7 contract for POST /api/registrations) — the response schemas the client is built
// against, mirrored member for member so every mocked response is checked before the client
// sees it. No mock here is a shape the API is not allowed to send.
const problem = {
  type: 'object',
  required: ['error'],
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    error: { type: 'string', enum: ['validation', 'forbidden', 'too_large', 'unsupported_media_type', 'rate_limited', 'internal'] },
  },
}
const messageList = { type: 'array', items: { type: 'string' } }
const responses: Record<number, object> = {
  201: {
    type: 'object',
    additionalProperties: false,
    required: ['firstName', 'createdAt'],
    properties: { firstName: { type: 'string' }, createdAt: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$' } },
  },
  400: {
    allOf: [
      problem,
      {
        type: 'object',
        required: ['error', 'fields'],
        properties: {
          error: { const: 'validation' },
          fields: {
            type: 'object',
            additionalProperties: false,
            properties: { firstName: messageList, lastName: messageList, email: messageList, phone: messageList },
          },
        },
      },
    ],
  },
  403: problem,
  413: problem,
  415: problem,
  429: problem,
  500: problem,
}
const ajv = new Ajv2020({ strict: false })

/** A fetch stand-in answering with one IF-2 response, validated against the contract first. */
function api(status: number, body: unknown, contentType = status === 201 ? 'application/json' : 'application/problem+json') {
  const schema = responses[status]
  expect(schema, `IF-2 documents ${status}`).toBeDefined()
  expect(ajv.validate(schema, body), JSON.stringify(ajv.errors)).toBe(true)
  return vi.fn(
    async (_input: string, _init: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } }),
  )
}

const values = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

describe('Feature: Keep bad data out even when the screen is bypassed', () => {
  describe('Scenario: The screen shows the API’s field errors next to my fields @AC-6', () => {
    it('When I press Submit, the screen POSTs the four values as JSON to the same-origin /api/registrations', async () => {
      const send = api(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
      await submitRegistration(values, send)
      expect(registrationPath).toBe('/api/registrations')
      expect(send).toHaveBeenCalledTimes(1)
      const [input, init] = send.mock.calls[0]
      expect(input).toBe('/api/registrations')
      expect(init.method).toBe('POST')
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
      expect(JSON.parse(String(init.body))).toEqual(values)
      // Nothing about the visitor rides the URL, and no credential or cookie is sent.
      expect(init.credentials).toBe('omit')
      expect(init.cache).toBe('no-store')
    })

    it('Then the 400 with a phone message becomes a field error under phone, verbatim, and nothing else is flagged', async () => {
      const outcome = await submitRegistration(values, api(400, { error: 'validation', fields: { phone: [phoneMessage] } }))
      expect(outcome).toEqual({ kind: 'invalid', errors: { phone: phoneMessage } })
    })

    it('several messages for a field are all kept, in order, and only the invalid fields are flagged', async () => {
      const outcome = await submitRegistration(
        values,
        api(400, { error: 'validation', fields: { email: ['Enter a valid email address.', 'Too long.'], phone: [phoneMessage] } }),
      )
      expect(outcome).toEqual({ kind: 'invalid', errors: { email: 'Enter a valid email address. Too long.', phone: phoneMessage } })
    })

    it('a 400 with fields {} (malformed JSON) is a validation outcome that flags no field', async () => {
      const outcome = await submitRegistration(values, api(400, { error: 'validation', fields: {} }))
      expect(outcome).toEqual({ kind: 'invalid', errors: {} })
    })

    it('a field with an empty message list is not flagged', async () => {
      const outcome = await submitRegistration(values, api(400, { error: 'validation', fields: { email: [], phone: [phoneMessage] } }))
      expect(outcome).toEqual({ kind: 'invalid', errors: { phone: phoneMessage } })
    })

    it('a 201 is the only response that confirms, carrying the saved first name', async () => {
      const outcome = await submitRegistration(values, api(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }))
      expect(outcome).toEqual({ kind: 'saved', firstName: 'Jane' })
    })

    it.each([
      [403, 'forbidden'],
      [413, 'too_large'],
      [415, 'unsupported_media_type'],
      [429, 'rate_limited'],
      [500, 'internal'],
    ])('a %i (%s) is a failed save, never field errors or a confirmation', async (status, error) => {
      const outcome = await submitRegistration(values, api(status, { error }))
      expect(outcome).toEqual({ kind: 'failed' })
    })

    it('a network failure is a failed save', async () => {
      const send = vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
      expect(await submitRegistration(values, send)).toEqual({ kind: 'failed' })
    })

    it('a response the contract does not allow is a failed save, never a field error or a confirmation', async () => {
      const raw = (status: number, body: string) => vi.fn(async () => new Response(body, { status }))
      expect(await submitRegistration(values, raw(400, 'not json'))).toEqual({ kind: 'failed' })
      expect(await submitRegistration(values, raw(400, '{"error":"validation"}'))).toEqual({ kind: 'failed' })
      expect(await submitRegistration(values, raw(400, '{"error":"validation","fields":[]}'))).toEqual({ kind: 'failed' })
      expect(await submitRegistration(values, raw(400, '{"error":"internal","fields":{}}'))).toEqual({ kind: 'failed' })
      expect(await submitRegistration(values, raw(400, 'null'))).toEqual({ kind: 'failed' })
      expect(await submitRegistration(values, raw(201, 'not json'))).toEqual({ kind: 'failed' })
      expect(await submitRegistration(values, raw(201, '{"createdAt":"2026-10-20T14:03:27Z"}'))).toEqual({ kind: 'failed' })
      expect(await submitRegistration(values, raw(200, '{"firstName":"Jane"}'))).toEqual({ kind: 'failed' })
    })

    it('field messages that are not strings, or fields the form does not have, are ignored', async () => {
      const send = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'validation', fields: { id: ['nope'], phone: [phoneMessage, 7], email: 'x' } }), {
            status: 400,
          }),
      )
      expect(await submitRegistration(values, send)).toEqual({ kind: 'invalid', errors: { phone: phoneMessage } })
    })

    it('uses the browser fetch by default', async () => {
      const send = api(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
      vi.stubGlobal('fetch', send)
      try {
        expect(await submitRegistration(values)).toEqual({ kind: 'saved', firstName: 'Jane' })
        expect(send).toHaveBeenCalledTimes(1)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
