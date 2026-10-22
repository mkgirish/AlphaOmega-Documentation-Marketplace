import { describe, expect, it, vi } from 'vitest'
import { initialState, reducer, type FormAction, type FormState } from './reducer.js'
import { createSubmitter, firstInvalid, readFieldErrors, registrationsPath, sendRegistration, type SubmitOutcome } from './submit.js'

// ST-11 / SCR-1 — the screen's client for POST /api/registrations and what it does with
// the API's refusals. Every mocked response is first checked against the shapes the story
// fixes (AD-5): 400 {"error":"validation","fields":{<field>:[<message>, ...]}}.

const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const typed = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

/** The story's validation envelope: a fields map of non-empty message lists and nothing else. */
function isValidationEnvelope(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false
  const record = body as Record<string, unknown>
  if (Object.keys(record).sort().join() !== 'error,fields' || record.error !== 'validation') return false
  const fields = record.fields
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return false
  return Object.values(fields).every((list) => Array.isArray(list) && list.length > 0 && list.every((m) => typeof m === 'string'))
}

function validation(fields: Record<string, string[]>) {
  const body = { error: 'validation', fields }
  expect(isValidationEnvelope(body), 'mock matches the story’s 400 envelope').toBe(true)
  return body
}

function respond(status: number, body?: unknown, contentType = 'application/json') {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  return vi.fn(async () => new Response(text, { status, headers: { 'content-type': contentType } }))
}

describe('the envelope check used by these mocks', () => {
  it('accepts the story’s 400 bodies and rejects anything else', () => {
    expect(isValidationEnvelope({ error: 'validation', fields: {} })).toBe(true)
    expect(isValidationEnvelope({ error: 'validation', fields: { phone: [phoneMessage] } })).toBe(true)
    expect(isValidationEnvelope({ error: 'validation', fields: { phone: [] } })).toBe(false)
    expect(isValidationEnvelope({ error: 'validation', fields: { phone: phoneMessage } })).toBe(false)
    expect(isValidationEnvelope({ error: 'validation', fields: [] })).toBe(false)
    expect(isValidationEnvelope({ error: 'validation' })).toBe(false)
    expect(isValidationEnvelope({ error: 'other', fields: {} })).toBe(false)
    expect(isValidationEnvelope({ error: 'validation', fields: {}, value: 'x' })).toBe(false)
    expect(isValidationEnvelope(null)).toBe(false)
    expect(isValidationEnvelope([])).toBe(false)
  })
})

describe('readFieldErrors — the API’s field errors, mapped onto the four visitor fields', () => {
  it('takes the first message for each field, verbatim', () => {
    expect(readFieldErrors(validation({ phone: [phoneMessage] }))).toEqual({ phone: phoneMessage })
    expect(readFieldErrors(validation({ email: ['first', 'second'], phone: [phoneMessage] }))).toEqual({
      email: 'first',
      phone: phoneMessage,
    })
  })

  it('a 400 with "fields": {} flags no field at all', () => {
    expect(readFieldErrors(validation({}))).toEqual({})
  })

  it('ignores fields the form does not have, and entries that are not message lists', () => {
    expect(readFieldErrors(validation({ id: ['Unexpected field.'], lastName: ['Required.'] }))).toEqual({ lastName: 'Required.' })
    expect(readFieldErrors({ error: 'validation', fields: { email: [], phone: [5], firstName: 'x', lastName: ['ok'] } })).toEqual({
      lastName: 'ok',
    })
    expect(readFieldErrors({ error: 'validation', fields: { toString: ['x'] } })).toEqual({})
  })

  it('is undefined for anything that is not the validation envelope', () => {
    for (const body of [
      null,
      undefined,
      'validation',
      [],
      {},
      { error: 'validation' },
      { error: 'validation', fields: [] },
      { error: 'oops', fields: {} },
    ]) {
      expect(readFieldErrors(body)).toBeUndefined()
    }
    expect(readFieldErrors({ error: 'validation', fields: null })).toBeUndefined()
  })
})

describe('sendRegistration — POST /api/registrations', () => {
  it('posts the four values as JSON to the same-origin relative path', async () => {
    const fetchMock = respond(201, { data: { id: 'x' } })
    await sendRegistration(typed, fetchMock)
    expect(registrationsPath).toBe('/api/registrations')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/registrations')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual(typed)
    expect(Object.keys(JSON.parse(init.body as string))).toEqual(['firstName', 'lastName', 'email', 'phone'])
    expect(init.credentials).toBe('same-origin')
  })

  it('201 is created', async () => {
    await expect(sendRegistration(typed, respond(201, { data: { id: 'x' } }))).resolves.toEqual({ kind: 'created' })
  })

  it('400 with field errors is invalid, carrying the server’s messages verbatim', async () => {
    const outcome = await sendRegistration(typed, respond(400, validation({ phone: [phoneMessage] })))
    expect(outcome).toEqual({ kind: 'invalid', errors: { phone: phoneMessage } })
  })

  it('400 with "fields": {} is invalid with no field flagged', async () => {
    await expect(sendRegistration(typed, respond(400, validation({})))).resolves.toEqual({ kind: 'invalid', errors: {} })
  })

  it('400 whose body is not the validation envelope is a save failure', async () => {
    await expect(sendRegistration(typed, respond(400, '{not json'))).resolves.toEqual({ kind: 'failed' })
    await expect(sendRegistration(typed, respond(400, { error: 'other' }))).resolves.toEqual({ kind: 'failed' })
  })

  it.each([403, 404, 413, 415, 429, 500, 503])('%i is a save failure, never field errors', async (status) => {
    await expect(sendRegistration(typed, respond(status, validation({ phone: [phoneMessage] })))).resolves.toEqual({ kind: 'failed' })
  })

  it('a network failure is a save failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(sendRegistration(typed, fetchMock)).resolves.toEqual({ kind: 'failed' })
  })

  it('uses the page’s fetch by default', async () => {
    const fetchMock = respond(201, { data: {} })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(sendRegistration(typed)).resolves.toEqual({ kind: 'created' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('firstInvalid — where focus goes', () => {
  it('is the first flagged field in tab order', () => {
    expect(firstInvalid({ phone: 'p', lastName: 'l' })).toBe('lastName')
    expect(firstInvalid({ phone: 'p' })).toBe('phone')
    expect(firstInvalid({ email: 'e', firstName: 'f' })).toBe('firstName')
  })

  it('is undefined when no field is flagged', () => {
    expect(firstInvalid({})).toBeUndefined()
    expect(firstInvalid({ email: undefined })).toBeUndefined()
  })
})

/** A submitter wired to the real reducer, recording every dispatch and focus. */
function harness(outcome: SubmitOutcome | Promise<SubmitOutcome>) {
  let state: FormState = initialState
  for (const [field, value] of Object.entries(typed)) state = reducer(state, { type: 'change', field: field as keyof typeof typed, value })
  const actions: FormAction[] = []
  const focus = vi.fn()
  const send = vi.fn(() => Promise.resolve(outcome))
  const dispatch = (action: FormAction) => {
    actions.push(action)
    state = reducer(state, action)
  }
  const submit = createSubmitter({ send, dispatch, focus })
  return { submit, send, focus, actions, state: () => state }
}

describe('Feature: Keep bad data out even when the screen is bypassed', () => {
  describe("Scenario: The screen shows the API's field errors next to my fields @AC-6", () => {
    it('Given the API answers 400 with a phone error, When I press Submit with valid values, Then the phone error is shown, focus is on Phone number and all four values are kept', async () => {
      const h = harness({ kind: 'invalid', errors: { phone: phoneMessage } })
      await h.submit(h.state().values)
      expect(h.send).toHaveBeenCalledWith(typed)
      expect(h.actions).toEqual([{ type: 'submit' }, { type: 'failed', errors: { phone: phoneMessage } }])
      expect(h.state().errors).toEqual({ phone: phoneMessage })
      expect(h.state().values).toEqual(typed)
      expect(h.state().submitting).toBe(false)
      expect(h.focus).toHaveBeenCalledTimes(1)
      expect(h.focus).toHaveBeenCalledWith('phone')
    })

    it('But no confirmation follows a 400: the submitted action is never dispatched', async () => {
      const h = harness({ kind: 'invalid', errors: { phone: phoneMessage } })
      await h.submit(h.state().values)
      expect(h.actions.some((action) => action.type === 'submitted')).toBe(false)
    })
  })

  describe('the submitter around the request', () => {
    it('focuses the first flagged field in tab order when several are flagged', async () => {
      const h = harness({ kind: 'invalid', errors: { phone: phoneMessage, email: 'Enter a valid email address.' } })
      await h.submit(h.state().values)
      expect(h.focus).toHaveBeenCalledWith('email')
    })

    it('a 400 with no field flagged moves no focus and flags nothing', async () => {
      const h = harness({ kind: 'invalid', errors: {} })
      await h.submit(h.state().values)
      expect(h.focus).not.toHaveBeenCalled()
      expect(h.state().errors).toEqual({})
      expect(h.state().values).toEqual(typed)
    })

    it('201 dispatches submitted and moves no focus', async () => {
      const h = harness({ kind: 'created' })
      await h.submit(h.state().values)
      expect(h.actions).toEqual([{ type: 'submit' }, { type: 'submitted' }])
      expect(h.focus).not.toHaveBeenCalled()
    })

    it('a save failure keeps the values, flags no field and moves no focus', async () => {
      const h = harness({ kind: 'failed' })
      await h.submit(h.state().values)
      expect(h.actions).toEqual([{ type: 'submit' }, { type: 'failed', errors: {} }])
      expect(h.state().values).toEqual(typed)
      expect(h.focus).not.toHaveBeenCalled()
    })

    it('a double tap while the request is in flight sends exactly one request', async () => {
      let release: (outcome: SubmitOutcome) => void = () => undefined
      const h = harness(new Promise<SubmitOutcome>((resolve) => (release = resolve)))
      const first = h.submit(h.state().values)
      const second = h.submit(h.state().values)
      expect(h.state().submitting).toBe(true)
      release({ kind: 'invalid', errors: { phone: phoneMessage } })
      await Promise.all([first, second])
      expect(h.send).toHaveBeenCalledTimes(1)
      expect(h.actions.filter((action) => action.type === 'submit')).toHaveLength(1)
    })

    it('can submit again once the previous request has settled', async () => {
      const h = harness({ kind: 'invalid', errors: { phone: phoneMessage } })
      await h.submit(h.state().values)
      await h.submit(h.state().values)
      expect(h.send).toHaveBeenCalledTimes(2)
    })

    it('settles even if sending throws, so Submit works again', async () => {
      const h = harness({ kind: 'created' })
      h.send.mockImplementationOnce(() => Promise.reject(new Error('boom')))
      await h.submit(h.state().values)
      expect(h.actions).toEqual([{ type: 'submit' }, { type: 'failed', errors: {} }])
      await h.submit(h.state().values)
      expect(h.send).toHaveBeenCalledTimes(2)
    })
  })
})
