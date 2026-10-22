import { describe, expect, it, vi } from 'vitest'
import { submitRegistration } from './api.js'

// ST-10 / IF-2 — the screen's client for POST /api/registrations, exercised against
// responses shaped exactly as the IF-2 contract describes them (RegistrationCreated,
// ValidationProblem, Problem), never against the API's own code.
const valid = { firstName: 'Siobhan', lastName: "O'Brien", email: 'siobhan@example.com', phone: '(415) 555-0132' }
const long = (n: number) => 'a'.repeat(n)

function respond(status: number, body: unknown, contentType = 'application/problem+json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(text, { status, headers: { 'content-type': contentType } }))
}

describe('Feature: Have my real name accepted, with a clear limit on length', () => {
  describe('Scenario Outline: Real-world names are accepted as written @AC-1', () => {
    it.each([
      ['Siobhan', "O'Brien"],
      ['Anne-Marie', 'Dupont'],
      ['José', 'Anne-Marie'],
    ])(
      'When I enter "%s" as first name and "%s" as last name and press Submit, the body carries them exactly as entered',
      async (first, last) => {
        const send = respond(201, { firstName: first, createdAt: '2026-10-20T14:03:27Z' }, 'application/json')
        const outcome = await submitRegistration({ ...valid, firstName: first, lastName: last }, send)
        expect(send).toHaveBeenCalledTimes(1)
        const [url, init] = send.mock.calls[0]
        expect(url).toBe('/api/registrations')
        expect(init.method).toBe('POST')
        expect(new Headers(init.headers).get('content-type')).toBe('application/json')
        expect(JSON.parse(String(init.body))).toEqual({ ...valid, firstName: first, lastName: last })
        expect(outcome).toEqual({ kind: 'created', firstName: first })
      },
    )

    it('sends only the four contract fields, never anything else', async () => {
      const send = respond(201, { firstName: 'José', createdAt: '2026-10-20T14:03:27Z' }, 'application/json')
      await submitRegistration({ ...valid, firstName: 'José' }, send)
      expect(Object.keys(JSON.parse(String(send.mock.calls[0][1].body))).sort()).toEqual(['email', 'firstName', 'lastName', 'phone'])
    })
  })

  describe('Scenario: A name of exactly 100 characters is accepted @AC-2', () => {
    it('Then I see the confirmation — the 100-character name travels whole and a 201 is a created outcome', async () => {
      const send = respond(201, { firstName: 'Siobhan', createdAt: '2026-10-20T14:03:27Z' }, 'application/json')
      const outcome = await submitRegistration({ ...valid, lastName: long(100) }, send)
      expect(JSON.parse(String(send.mock.calls[0][1].body)).lastName).toHaveLength(100)
      expect(outcome.kind).toBe('created')
    })
  })

  describe('Scenario: An over-long first name is flagged @AC-3', () => {
    it('the 101-character first name is sent untrimmed and the server message comes back verbatim under firstName', async () => {
      const message = 'Server says: first name too long (verbatim).'
      const send = respond(400, { error: 'validation', fields: { firstName: [message] } })
      const outcome = await submitRegistration({ ...valid, firstName: long(101) }, send)
      expect(JSON.parse(String(send.mock.calls[0][1].body)).firstName).toHaveLength(101)
      expect(outcome).toEqual({ kind: 'invalid', fieldErrors: { firstName: message } })
    })
  })

  describe('Scenario: An over-long last name is flagged @AC-3', () => {
    it('flags only lastName, with the first of its messages', async () => {
      const send = respond(400, {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        error: 'validation',
        fields: { lastName: ['first message', 'second message'] },
      })
      expect(await submitRegistration({ ...valid, lastName: long(101) }, send)).toEqual({
        kind: 'invalid',
        fieldErrors: { lastName: 'first message' },
      })
    })
  })

  describe('the 400 ValidationProblem the API sends (the API side of AC-6 is proven in packages/api)', () => {
    it('a 400 naming several fields flags each of them and nothing else', async () => {
      const send = respond(400, { error: 'validation', fields: { firstName: ['a'], phone: ['b'] } })
      expect(await submitRegistration(valid, send)).toEqual({ kind: 'invalid', fieldErrors: { firstName: 'a', phone: 'b' } })
    })

    it('a 400 with fields {} (malformed JSON) flags no field', async () => {
      const send = respond(400, { error: 'validation', fields: {} })
      expect(await submitRegistration(valid, send)).toEqual({ kind: 'invalid', fieldErrors: {} })
    })

    it('ignores unknown keys, empty lists and non-string messages instead of flagging a field incorrectly', async () => {
      const send = respond(400, { error: 'validation', fields: { id: ['x'], firstName: [], lastName: [42], email: 'not a list' } })
      expect(await submitRegistration(valid, send)).toEqual({ kind: 'invalid', fieldErrors: {} })
    })

    it.each([
      ['not json'],
      [JSON.stringify({ error: 'validation' })],
      [JSON.stringify(null)],
      [JSON.stringify({ error: 'validation', fields: [] })],
    ])('a 400 whose body is not a ValidationProblem (%s) flags no field', async (body) => {
      expect(await submitRegistration(valid, respond(400, body))).toEqual({ kind: 'invalid', fieldErrors: {} })
    })
  })

  describe('every other IF-2 status and the network failure are a failed save', () => {
    it.each([
      [403, 'forbidden'],
      [413, 'too_large'],
      [415, 'unsupported_media_type'],
      [429, 'rate_limited'],
      [500, 'internal'],
    ])('%i (%s) is a failed save, never a confirmation', async (status, error) => {
      expect(await submitRegistration(valid, respond(status, { error }))).toEqual({ kind: 'failed' })
    })

    it('a network failure is a failed save', async () => {
      const send = vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
      expect(await submitRegistration(valid, send)).toEqual({ kind: 'failed' })
    })

    it('a 201 whose body cannot be read still confirms, greeting the visitor by the first name they typed', async () => {
      expect(await submitRegistration(valid, respond(201, 'garbage', 'application/json'))).toEqual({
        kind: 'created',
        firstName: 'Siobhan',
      })
      expect(await submitRegistration(valid, respond(201, { createdAt: 'x' }, 'application/json'))).toEqual({
        kind: 'created',
        firstName: 'Siobhan',
      })
    })

    it('uses the global fetch when none is given', async () => {
      const send = respond(201, { firstName: 'Ada', createdAt: '2026-10-20T14:03:27Z' }, 'application/json')
      vi.stubGlobal('fetch', send)
      try {
        expect(await submitRegistration(valid)).toEqual({ kind: 'created', firstName: 'Ada' })
        expect(send).toHaveBeenCalledTimes(1)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
