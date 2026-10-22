import { describe, expect, it } from 'vitest'
import { EMAIL_MAX, NAME_MAX, PHONE_MESSAGE, validateRegistration } from './registration-rules.js'

// ST-11 — the API applies the registration rules itself, whatever sent the body.
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

function failuresOf(body: unknown): Record<string, string> {
  const result = validateRegistration(body)
  if (result.ok) return {}
  return Object.fromEntries(result.failures.map((f) => [f.field ?? '(body)', f.rule]))
}

describe('validateRegistration @story:ST-11 @criterion:AC-1 @criterion:AC-2', () => {
  it('accepts a valid registration and returns the normalised values', () => {
    const result = validateRegistration({
      firstName: '  Jane  ',
      lastName: ' van   Doe ',
      email: ' jane.doe@example.com ',
      phone: '(415) 555-0132',
    })
    expect(result).toEqual({
      ok: true,
      value: { firstName: 'Jane', lastName: 'van Doe', email: 'jane.doe@example.com', phone: '4155550132' },
    })
  })

  it.each([
    ['firstName', 'required'],
    ['lastName', 'required'],
    ['email', 'required'],
    ['phone', 'required'],
  ])('reports a missing %s as %s', (field, rule) => {
    const body: Record<string, string> = { ...VALID }
    delete body[field]
    expect(failuresOf(body)).toEqual({ [field]: rule })
  })

  it.each(['', '   ', '\t\n'])('treats the blank value %j as missing', (blank) => {
    expect(failuresOf({ ...VALID, firstName: blank })).toEqual({ firstName: 'required' })
  })

  it.each([123, null, true, ['Jane'], { first: 'Jane' }])('reports the non-string value %j as type', (value) => {
    expect(failuresOf({ ...VALID, lastName: value })).toEqual({ lastName: 'type' })
  })

  it('reports every invalid field at once and none of the valid ones', () => {
    expect(failuresOf({ firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '5550132' })).toEqual({
      email: 'email',
      phone: 'phone',
    })
  })

  it('holds names at the 100/101 boundary after trimming', () => {
    expect(NAME_MAX).toBe(100)
    expect(validateRegistration({ ...VALID, firstName: ` ${'a'.repeat(100)} ` }).ok).toBe(true)
    expect(failuresOf({ ...VALID, firstName: 'a'.repeat(101) })).toEqual({ firstName: 'too_long' })
    expect(failuresOf({ ...VALID, lastName: 'b'.repeat(101) })).toEqual({ lastName: 'too_long' })
  })

  it('holds email at the 254/255 boundary', () => {
    expect(EMAIL_MAX).toBe(254)
    const local = 'a'.repeat(64)
    const label = 'd'.repeat(60)
    const ok = `${local}@${label}.${label}.${label}.dd.com`
    expect(ok).toHaveLength(254)
    expect(validateRegistration({ ...VALID, email: ok }).ok).toBe(true)
    const tooLong = `${local}@${label}.${label}.${label}.ddd.com`
    expect(tooLong).toHaveLength(255)
    expect(failuresOf({ ...VALID, email: tooLong })).toEqual({ email: 'too_long' })
  })

  it.each(['jane@', 'jane', '@example.com', 'jane@@example.com', 'jane doe@example.com'])('refuses the email %j', (email) => {
    expect(failuresOf({ ...VALID, email })).toEqual({ email: 'email' })
  })

  it.each(['4155550132', '(415) 555-0132', '415-555-0132', '415.555.0132', ' 415 555 0132 ', '2125550199'])(
    'accepts the NANP number %j',
    (phone) => {
      expect(validateRegistration({ ...VALID, phone }).ok).toBe(true)
    },
  )

  it.each(['5550132', '+14155550132', '14155550132', '1155550132', '0155550132', '4151550132', '4150550132', '415555013x', '41555501321'])(
    'refuses the phone number %j',
    (phone) => {
      expect(failuresOf({ ...VALID, phone })).toEqual({ phone: 'phone' })
    },
  )

  it('uses the story’s phone message', () => {
    expect(PHONE_MESSAGE).toBe('Enter a 10-digit US number without +1, e.g. (415) 555-0132.')
    const result = validateRegistration({ ...VALID, phone: '5550132' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failures).toEqual([{ field: 'phone', rule: 'phone', message: PHONE_MESSAGE }])
  })

  it.each(['Ja\u0000ne', 'Jane\u202E', 'Jane\u200B', 'Ja\u0007ne'])('refuses control and bidi characters in %j', (firstName) => {
    expect(failuresOf({ ...VALID, firstName })).toEqual({ firstName: 'characters' })
  })

  it('gives every failure a message that never repeats the submitted value', () => {
    const sentinel = 'SENTINEL-rules-4c1d'
    const result = validateRegistration({
      firstName: sentinel.repeat(10),
      lastName: `${sentinel}\u0000`,
      email: `${sentinel}@`,
      phone: sentinel,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failures).toHaveLength(4)
      for (const failure of result.failures) {
        expect(failure.message.length).toBeGreaterThan(0)
        expect(failure.message).not.toContain(sentinel)
      }
    }
  })
})

describe('validateRegistration refuses bodies the form never sends @story:ST-11 @criterion:AC-3', () => {
  it.each([null, 'text', 42, [], [VALID]])('refuses the non-object body %j', (body) => {
    expect(validateRegistration(body)).toEqual({ ok: false, failures: [{ field: null, rule: 'not_object', message: '' }] })
  })

  it.each([{ id: 5 }, { createdAt: '2026-01-01' }, { __extra: 'x' }])('refuses a body with the unexpected field in %j', (extra) => {
    expect(validateRegistration({ ...VALID, ...extra })).toEqual({
      ok: false,
      failures: [{ field: null, rule: 'unknown_field', message: '' }],
    })
  })

  it('normalisation is idempotent', () => {
    const once = validateRegistration({ firstName: '  A   b ', lastName: ' C ', email: ' x@example.com ', phone: '(415) 555-0132' })
    expect(once.ok).toBe(true)
    if (once.ok) expect(validateRegistration(once.value)).toEqual(once)
  })
})
