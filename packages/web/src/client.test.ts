import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'
import { createSubmitter, outcomeToAction, registrationsUrl, submitRegistration, type SubmitOutcome } from './client.js'
import type { FormAction } from './reducer.js'

// IF-2 consumer tests. Every mocked response is validated against the IF-2 contract's own
// schemas (copied verbatim from components.schemas of the step-7 contract) before the
// client sees it, so the client is built against the contract, never against the API code.
const contract = {
  $id: 'https://contracts.local/IF-2',
  $defs: {
    RegistrationRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['firstName', 'lastName', 'email', 'phone'],
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string', maxLength: 254 },
        phone: { type: 'string' },
      },
    },
    RegistrationCreated: {
      type: 'object',
      additionalProperties: false,
      required: ['firstName', 'createdAt'],
      properties: {
        firstName: { type: 'string' },
        createdAt: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$' },
      },
    },
    Problem: {
      type: 'object',
      required: ['error'],
      properties: {
        type: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'integer' },
        error: { type: 'string', enum: ['validation', 'forbidden', 'too_large', 'unsupported_media_type', 'rate_limited', 'internal'] },
      },
    },
    ValidationProblem: {
      allOf: [
        { $ref: '#/$defs/Problem' },
        {
          type: 'object',
          required: ['error', 'fields'],
          properties: {
            error: { const: 'validation' },
            fields: {
              type: 'object',
              additionalProperties: false,
              properties: {
                firstName: { type: 'array', items: { type: 'string' } },
                lastName: { type: 'array', items: { type: 'string' } },
                email: { type: 'array', items: { type: 'string' } },
                phone: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      ],
    },
  },
} as const

/** The documented responses of POST /api/registrations: status → [content type, schema]. */
const responses: Record<number, [string, keyof typeof contract.$defs]> = {
  201: ['application/json', 'RegistrationCreated'],
  400: ['application/problem+json', 'ValidationProblem'],
  403: ['application/problem+json', 'Problem'],
  413: ['application/problem+json', 'Problem'],
  415: ['application/problem+json', 'Problem'],
  429: ['application/problem+json', 'Problem'],
  500: ['application/problem+json', 'Problem'],
}

const ajv = new Ajv2020({ allErrors: true })
ajv.addSchema(contract)
const schema = (name: keyof typeof contract.$defs) => ajv.getSchema(`${contract.$id}#/$defs/${name}`)!

/** A fetch double answering with one contract-valid response, recording each request. */
function contractFetch(status: number, body: unknown) {
  const [contentType, name] = responses[status]
  const validate = schema(name)
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true)
  return vi.fn(async (_url: string, _init: RequestInit) => {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' } })
  })
}

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }

describe('IF-2 client — POST /api/registrations', () => {
  it('covers every status the contract documents', () => {
    expect(Object.keys(responses).map(Number)).toEqual([201, 400, 403, 413, 415, 429, 500])
  })

  it('posts the four fields as JSON to the same-origin relative path, with nothing cached or credentialed cross-site', async () => {
    const fetch = contractFetch(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    await submitRegistration(jane, fetch)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(registrationsUrl).toBe('/api/registrations')
    expect(url).toBe('/api/registrations')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(init.credentials).toBe('same-origin')
    expect(init.cache).toBe('no-store')
    const sent = JSON.parse(String(init.body))
    expect(schema('RegistrationRequest')(sent)).toBe(true)
    expect(sent).toEqual(jane)
  })

  it('201 → saved, carrying the normalised first name the API returned', async () => {
    const fetch = contractFetch(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    expect(await submitRegistration(jane, fetch)).toEqual({ kind: 'saved', firstName: 'Jane' })
  })

  it('400 → invalid, with each server message rendered verbatim on its own field', async () => {
    const phone = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
    const fetch = contractFetch(400, { error: 'validation', fields: { phone: [phone], email: ['First.', 'Second.'] } })
    expect(await submitRegistration(jane, fetch)).toEqual({ kind: 'invalid', errors: { phone, email: 'First. Second.' } })
  })

  it('400 with fields {} (malformed body) → invalid with no field flagged', async () => {
    const fetch = contractFetch(400, { error: 'validation', fields: {} })
    const outcome = await submitRegistration(jane, fetch)
    expect(outcome).toEqual({ kind: 'invalid', errors: {} })
  })

  it.each([
    [403, 'forbidden'],
    [413, 'too_large'],
    [415, 'unsupported_media_type'],
    [429, 'rate_limited'],
    [500, 'internal'],
  ])('%i (%s) → failed, so the screen keeps the values and offers a retry', async (status, error) => {
    const fetch = contractFetch(status, { error })
    expect(await submitRegistration(jane, fetch)).toEqual({ kind: 'failed' })
  })

  it('a network failure → failed', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await submitRegistration(jane, fetch)).toEqual({ kind: 'failed' })
  })

  it('a 201 whose body breaks the contract is not a confirmation', async () => {
    for (const body of ['not json', JSON.stringify({ createdAt: '2026-10-20T14:03:27Z' }), 'null']) {
      const fetch = vi.fn(async () => new Response(body, { status: 201 }))
      expect(await submitRegistration(jane, fetch)).toEqual({ kind: 'failed' })
    }
  })

  it('a 400 that is not a validation problem is a failed save, not a field error', async () => {
    for (const body of [JSON.stringify({ error: 'internal' }), '{', JSON.stringify({ error: 'validation', fields: [] })]) {
      const fetch = vi.fn(async () => new Response(body, { status: 400 }))
      expect(await submitRegistration(jane, fetch)).toEqual({ kind: 'failed' })
    }
  })

  it('ignores unknown or non-string entries in fields rather than flagging a field incorrectly', async () => {
    const body = JSON.stringify({
      error: 'validation',
      fields: { id: ['Unknown.'], firstName: 'not-an-array', lastName: [42, 'Too long.'] },
    })
    const fetch = vi.fn(async () => new Response(body, { status: 400 }))
    expect(await submitRegistration(jane, fetch)).toEqual({ kind: 'invalid', errors: { lastName: 'Too long.' } })
  })

  it('an unexpected success status is not a confirmation', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }), { status: 200 }))
    expect(await submitRegistration(jane, fetch)).toEqual({ kind: 'failed' })
  })

  it('uses the page’s fetch when none is passed', async () => {
    const fetch = contractFetch(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    vi.stubGlobal('fetch', fetch)
    try {
      expect(await submitRegistration(jane)).toEqual({ kind: 'saved', firstName: 'Jane' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('outcomes become reducer actions', () => {
  it('maps saved, invalid and failed to submitted, failed and saveFailed', () => {
    expect(outcomeToAction({ kind: 'saved', firstName: 'Jane' })).toEqual({ type: 'submitted', firstName: 'Jane' })
    expect(outcomeToAction({ kind: 'invalid', errors: { phone: 'x' } })).toEqual({ type: 'failed', errors: { phone: 'x' } })
    expect(outcomeToAction({ kind: 'failed' })).toEqual({ type: 'saveFailed' })
  })
})

describe('the submitter', () => {
  it('a double submit sends one request and dispatches one SUBMIT', async () => {
    let answer: (outcome: SubmitOutcome) => void = () => undefined
    const send = vi.fn(() => new Promise<SubmitOutcome>((resolve) => (answer = resolve)))
    const actions: FormAction[] = []
    const submit = createSubmitter(send, (action) => actions.push(action))
    const first = submit(jane)
    const second = submit(jane)
    await second
    expect(send).toHaveBeenCalledTimes(1)
    answer({ kind: 'saved', firstName: 'Jane' })
    await first
    expect(actions).toEqual([{ type: 'submit' }, { type: 'submitted', firstName: 'Jane' }])
  })

  it('accepts the next submit once the first has answered', async () => {
    const send = vi.fn(async (): Promise<SubmitOutcome> => ({ kind: 'failed' }))
    const actions: FormAction[] = []
    const submit = createSubmitter(send, (action) => actions.push(action))
    await submit(jane)
    await submit(jane)
    expect(send).toHaveBeenCalledTimes(2)
    expect(actions).toEqual([{ type: 'submit' }, { type: 'saveFailed' }, { type: 'submit' }, { type: 'saveFailed' }])
  })

  it('stays usable even if sending throws', async () => {
    const send = vi.fn(async (): Promise<SubmitOutcome> => {
      throw new Error('boom')
    })
    const actions: FormAction[] = []
    const submit = createSubmitter(send, (action) => actions.push(action))
    await submit(jane)
    await submit(jane)
    expect(send).toHaveBeenCalledTimes(2)
    expect(actions).toEqual([{ type: 'submit' }, { type: 'saveFailed' }, { type: 'submit' }, { type: 'saveFailed' }])
  })
})
