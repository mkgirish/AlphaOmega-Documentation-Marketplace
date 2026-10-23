import { describe, expect, it } from 'vitest'
import {
  fieldErrorsSchema,
  fieldMessages,
  problem,
  problemCodes,
  problemEnvelopeSchema,
  readFieldErrors,
  registrationFields,
  rejectionReasons,
  validateRegistration,
  validationEnvelopeSchema,
  validationProblem,
} from './index.js'

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

describe('validateRegistration() — the API refuses what the screen would (ST-11)', () => {
  it('passes a valid body through, trimmed and normalised', () => {
    expect(validateRegistration({ ...valid, firstName: ' Jane ', phone: '(415) 555-0132' })).toEqual({ ok: true, value: valid })
  })

  it('AC-1: reports a missing email under fields.email alone', () => {
    const result = validateRegistration({ firstName: 'Jane', lastName: 'Doe', phone: '4155550132' })
    expect(result).toEqual({ ok: false, fields: { email: [fieldMessages.email.required] } })
  })

  it('AC-2: reports every invalid field at once and none for the valid ones', () => {
    const result = validateRegistration({ firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '5550132' })
    expect(result).toEqual({ ok: false, fields: { email: [fieldMessages.email.invalid], phone: [fieldMessages.phone.invalid] } })
    if (!result.ok) {
      expect(result.fields).not.toHaveProperty('firstName')
      expect(result.fields).not.toHaveProperty('lastName')
    }
  })

  it('reports all four fields when every one is missing', () => {
    expect(validateRegistration({})).toEqual({
      ok: false,
      fields: {
        firstName: [fieldMessages.firstName.required],
        lastName: [fieldMessages.lastName.required],
        email: [fieldMessages.email.required],
        phone: [fieldMessages.phone.required],
      },
    })
  })

  it('reports a non-string value as required, never as its type', () => {
    expect(validateRegistration({ ...valid, phone: 4155550132 })).toEqual({ ok: false, fields: { phone: [fieldMessages.phone.required] } })
    expect(validateRegistration({ ...valid, email: null })).toEqual({ ok: false, fields: { email: [fieldMessages.email.required] } })
    expect(validateRegistration({ ...valid, firstName: ['Jane'] })).toEqual({
      ok: false,
      fields: { firstName: [fieldMessages.firstName.required] },
    })
    expect(validateRegistration({ ...valid, lastName: { value: 'Doe' } })).toEqual({
      ok: false,
      fields: { lastName: [fieldMessages.lastName.required] },
    })
  })

  it.each([
    ['a valid registration with an extra "id"', { ...valid, id: 5 }],
    ['a body holding only an unknown field', { nickname: 'J' }],
    [
      'an own __proto__ key',
      JSON.parse('{"firstName":"Jane","lastName":"Doe","email":"jane.doe@example.com","phone":"4155550132","__proto__":{"x":1}}'),
    ],
  ])('AC-3: refuses %s with empty fields, naming no submitted key', (_label, body) => {
    const result = validateRegistration(body)
    expect(result).toEqual({ ok: false, fields: {} })
  })

  it.each([
    ['null', null],
    ['undefined (an unread body)', undefined],
    ['an array', [valid]],
    ['a string', '{firstName:'],
    ['a number', 5],
    ['a boolean', true],
  ])('AC-3: refuses %s as a body with empty fields', (_label, body) => {
    expect(validateRegistration(body)).toEqual({ ok: false, fields: {} })
  })

  it('AC-5: never repeats a submitted value, per field (sentinel)', () => {
    const sentinels = {
      firstName: 'SENTINEL-first\u0007',
      lastName: 'SENTINEL-last\u202e',
      email: 'leak-check@bad',
      phone: 'SENTINEL-phone',
    }
    const result = validateRegistration(sentinels)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(Object.keys(result.fields).sort()).toEqual([...registrationFields].sort())
      const body = JSON.stringify(validationProblem(result.fields))
      const reasons = JSON.stringify(rejectionReasons(result.fields))
      for (const value of Object.values(sentinels)) {
        expect(body).not.toContain(value)
        expect(reasons).not.toContain(value)
      }
      expect(body).not.toContain('SENTINEL')
      expect(reasons).not.toContain('SENTINEL')
      expect(body).not.toContain('leak-check')
    }
  })

  it('reports the first rule each field breaks, one message per field', () => {
    const result = validateRegistration({ ...valid, firstName: 'a'.repeat(101), lastName: '' })
    expect(result).toEqual({
      ok: false,
      fields: { firstName: [fieldMessages.firstName.tooLong], lastName: [fieldMessages.lastName.required] },
    })
  })
})

describe('problem envelopes — { error, fields? } for every refusal (AC-1 to AC-4)', () => {
  it('maps each refusal to its HTTP status', () => {
    expect(problemCodes).toMatchObject({
      validation: 400,
      forbidden: 403,
      method_not_allowed: 405,
      too_large: 413,
      unsupported_media_type: 415,
      rate_limited: 429,
      internal: 500,
    })
  })

  it('AC-1: builds {"error":"validation","fields":{"email":[...]}}', () => {
    const body = validationProblem({ email: [fieldMessages.email.required] })
    expect(body).toEqual({ error: 'validation', fields: { email: ['Enter your email address.'] } })
    expect(validationEnvelopeSchema.parse(body)).toEqual(body)
    expect(problemEnvelopeSchema.parse(body)).toEqual(body)
  })

  it('AC-3: builds the malformed-JSON body with "fields": {}', () => {
    expect(validationProblem()).toEqual({ error: 'validation', fields: {} })
    expect(JSON.stringify(validationProblem({}))).toBe('{"error":"validation","fields":{}}')
    expect(validationEnvelopeSchema.safeParse(validationProblem()).success).toBe(true)
  })

  it.each([
    ['forbidden', 403],
    ['method_not_allowed', 405],
    ['too_large', 413],
    ['unsupported_media_type', 415],
    ['rate_limited', 429],
    ['internal', 500],
  ] as const)('AC-4: builds the %s body (%i) with no fields', (code, status) => {
    expect(problemCodes[code]).toBe(status)
    expect(problem(code)).toEqual({ error: code })
    expect(problemEnvelopeSchema.parse(problem(code))).toEqual({ error: code })
  })

  it('rejects envelopes that leak more than the code and field messages', () => {
    expect(problemEnvelopeSchema.safeParse({ error: 'validation' }).success).toBe(false)
    expect(problemEnvelopeSchema.safeParse({ error: 'forbidden', fields: {} }).success).toBe(false)
    expect(problemEnvelopeSchema.safeParse({ error: 'teapot' }).success).toBe(false)
    expect(problemEnvelopeSchema.safeParse({ error: 'internal', detail: 'duplicate key' }).success).toBe(false)
    expect(problemEnvelopeSchema.safeParse({ error: 'validation', fields: {}, id: 42 }).success).toBe(false)
    expect(problemEnvelopeSchema.safeParse({ error: 'validation', fields: { id: ['x'] } }).success).toBe(false)
    expect(problemEnvelopeSchema.safeParse({ error: 'validation', fields: { email: [] } }).success).toBe(false)
    expect(problemEnvelopeSchema.safeParse({ error: 'validation', fields: { email: [3] } }).success).toBe(false)
    expect(fieldErrorsSchema.safeParse({ phone: ['ok'] }).success).toBe(true)
  })

  it('validates every outcome validateRegistration can produce', () => {
    for (const body of [{}, { ...valid, id: 1 }, { ...valid, email: 'x' }, null]) {
      const result = validateRegistration(body)
      if (!result.ok) expect(validationEnvelopeSchema.safeParse(validationProblem(result.fields)).success).toBe(true)
    }
  })
})

describe('rejectionReasons() — the registration.rejected log names field and rule only (AC-5)', () => {
  it('names the field and the rule it broke', () => {
    const result = validateRegistration({ ...valid, email: 'leak-check@bad' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(rejectionReasons(result.fields)).toEqual([{ field: 'email', rule: 'invalid' }])
  })

  it('names every rule in field order', () => {
    expect(
      rejectionReasons({
        phone: [fieldMessages.phone.required],
        email: [fieldMessages.email.tooLong],
        firstName: [fieldMessages.firstName.invalid],
        lastName: [fieldMessages.lastName.tooLong],
      }),
    ).toEqual([
      { field: 'firstName', rule: 'invalid' },
      { field: 'lastName', rule: 'tooLong' },
      { field: 'email', rule: 'tooLong' },
      { field: 'phone', rule: 'required' },
    ])
  })

  it('names a body refused as a whole as rule "body" with no field', () => {
    expect(rejectionReasons({})).toEqual([{ field: null, rule: 'body' }])
    const result = validateRegistration({ ...valid, id: 'SENTINEL-key' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(rejectionReasons(result.fields)).toEqual([{ field: null, rule: 'body' }])
  })

  it('falls back to "invalid" for a message it does not know, without repeating it', () => {
    const reasons = rejectionReasons({ email: ['SENTINEL unknown message'] })
    expect(reasons).toEqual([{ field: 'email', rule: 'invalid' }])
    expect(JSON.stringify(reasons)).not.toContain('SENTINEL')
  })
})

describe('readFieldErrors() — the screen reads the API refusal into field errors (AC-6)', () => {
  const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

  it('reads the AC-6 override body into a phone error', () => {
    expect(readFieldErrors({ error: 'validation', fields: { phone: [phoneMessage] } })).toEqual({ phone: [phoneMessage] })
  })

  it('reads empty fields from a malformed-body refusal', () => {
    expect(readFieldErrors({ error: 'validation', fields: {} })).toEqual({})
  })

  it('returns fields in the order of the form, so the first is focused first', () => {
    const read = readFieldErrors({ error: 'validation', fields: { phone: ['p'], firstName: ['f'], email: ['e'] } })
    expect(Object.keys(read ?? {})).toEqual(['firstName', 'email', 'phone'])
  })

  it.each([
    ['null', null],
    ['a string', 'validation'],
    ['another problem', { error: 'internal' }],
    ['the old envelope', { error: { message: 'x', fields: [{ path: 'phone', message: 'y' }] } }],
    ['a validation body without fields', { error: 'validation' }],
    ['fields that are not lists of strings', { error: 'validation', fields: { phone: 'x' } }],
    ['an empty message list', { error: 'validation', fields: { phone: [] } }],
    ['an empty message', { error: 'validation', fields: { phone: [''] } }],
    ['a field not on the form', { error: 'validation', fields: { id: ['x'] } }],
  ])('returns null for %s, so the screen shows its save-failed alert', (_label, body) => {
    expect(readFieldErrors(body)).toBeNull()
  })
})
