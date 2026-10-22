import { describe, expect, it, vi } from 'vitest'
import { submitRegistration, toRequest } from './client.js'

// ST-8 — the IF-2 client for POST /api/registrations. The mocked responses are the shapes
// and examples of the IF-2 contract (RegistrationCreated, ValidationProblem, Problem).
const values = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }

function respond(status: number, body: unknown) {
  return vi.fn(
    async (..._args: Parameters<typeof fetch>) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/problem+json' } }),
  )
}

describe('Feature: Enter a US phone number and be told exactly when it is wrong', () => {
  describe('Scenario Outline: Common ways of writing a US number are accepted @AC-1', () => {
    it('sends the phone as its 10 digits, as the store keeps it', () => {
      expect(toRequest(values)).toEqual({ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' })
      expect(toRequest({ ...values, phone: '415.555.0132' }).phone).toBe('4155550132')
    })

    it('POSTs JSON to the same-origin relative /api/registrations and confirms only on 201', async () => {
      const send = respond(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
      await expect(submitRegistration(values, send)).resolves.toEqual({ kind: 'saved', firstName: 'Jane' })
      expect(send).toHaveBeenCalledTimes(1)
      const [url, init] = send.mock.calls[0]
      expect(url).toBe('/api/registrations')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
      expect(JSON.parse(String(init?.body))).toEqual(toRequest(values))
    })
  })

  describe('Scenario: The API applies the same phone rule @AC-8', () => {
    it('a 400 for phone flags the phone with the server’s message verbatim, and nothing else', async () => {
      const send = respond(400, { error: 'validation', fields: { phone: ['Enter a 10-digit US number without +1, e.g. (415) 555-0132.'] } })
      await expect(submitRegistration(values, send)).resolves.toEqual({
        kind: 'invalid',
        errors: { phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.' },
      })
    })

    it('a 400 maps every listed field to its first message', async () => {
      const send = respond(400, { error: 'validation', fields: { firstName: ['A', 'B'], email: ['C'], lastName: [], id: ['x'] } })
      await expect(submitRegistration(values, send)).resolves.toEqual({ kind: 'invalid', errors: { firstName: 'A', email: 'C' } })
    })

    it('a 400 with fields {} flags no field', async () => {
      await expect(submitRegistration(values, respond(400, { error: 'validation', fields: {} }))).resolves.toEqual({
        kind: 'invalid',
        errors: {},
      })
    })

    it('a 400 whose body is not the envelope flags no field', async () => {
      const send = vi.fn(async () => new Response('not json', { status: 400 }))
      await expect(submitRegistration(values, send)).resolves.toEqual({ kind: 'invalid', errors: {} })
      await expect(submitRegistration(values, respond(400, { error: 'validation' }))).resolves.toEqual({ kind: 'invalid', errors: {} })
      await expect(submitRegistration(values, respond(400, null))).resolves.toEqual({ kind: 'invalid', errors: {} })
    })
  })

  describe('every other outcome is a failed save', () => {
    it.each([
      [403, 'forbidden'],
      [413, 'too_large'],
      [415, 'unsupported_media_type'],
      [429, 'rate_limited'],
      [500, 'internal'],
    ])('%i (%s) is a failed save', async (status, error) => {
      await expect(submitRegistration(values, respond(status, { error }))).resolves.toEqual({ kind: 'failed' })
    })

    it('a network failure is a failed save', async () => {
      const send = vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
      await expect(submitRegistration(values, send)).resolves.toEqual({ kind: 'failed' })
    })

    it('a 201 without a first name is a failed save, never a confirmation', async () => {
      await expect(submitRegistration(values, respond(201, { createdAt: '2026-10-20T14:03:27Z' }))).resolves.toEqual({ kind: 'failed' })
    })
  })
})
