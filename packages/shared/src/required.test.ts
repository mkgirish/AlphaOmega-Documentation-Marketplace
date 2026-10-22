// ST-3 — an empty or blank field stops the registration on both sides with its own message.
import { describe, expect, it } from 'vitest'
import {
  errorSummary,
  fieldErrors,
  fieldLabels,
  fieldMessages,
  firstInvalidField,
  registrationFields,
  registrationRequest,
  validateRegistration,
} from './index.js'

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

/** Deterministic PRNG so the property tests replay identically on every run. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20261023)
const RUNS = 300

describe('the four fields, in form order, with their on-screen labels', () => {
  it('lists the fields in the order the form shows them', () => {
    expect(registrationFields).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it('labels each field as the screen does', () => {
    expect(fieldLabels).toEqual({ firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone number' })
  })
})

describe('the required messages (AC-3)', () => {
  it.each([
    ['firstName', 'Enter your first name.'],
    ['lastName', 'Enter your last name.'],
    ['email', 'Enter an email like name@example.com.'],
    ['phone', 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'],
  ] as const)('%s reads %j', (field, message) => {
    expect(fieldMessages[field].required).toBe(message)
  })

  it.each([
    [4, '4 fields need attention. Check the messages below.'],
    [3, '3 fields need attention. Check the messages below.'],
    [2, '2 fields need attention. Check the messages below.'],
    [1, '1 field needs attention. Check the message below.'],
  ])('the summary for %i reads %j', (count, text) => {
    expect(errorSummary(count)).toBe(text)
  })
})

describe('an empty field is refused with its own message (AC-1, AC-2, AC-6)', () => {
  const blanks = [
    ['empty', ''],
    ['spaces', '   '],
    ['a tab', '\t'],
    ['a newline', '\n'],
    ['a no-break space', '\u00a0'],
    ['mixed whitespace', ' \t \u00a0 '],
  ] as const

  for (const field of registrationFields) {
    it.each(blanks)(`refuses ${field} when it is %s, naming only that field`, (_label, blank) => {
      const result = validateRegistration({ ...valid, [field]: blank })
      expect(result).toEqual({ ok: false, fields: { [field]: [fieldMessages[field].required] } })
    })

    it(`refuses ${field} when it is missing, null or not a string`, () => {
      const { [field]: _omit, ...rest } = valid
      for (const body of [rest, { ...valid, [field]: null }, { ...valid, [field]: 42 }]) {
        expect(validateRegistration(body)).toEqual({ ok: false, fields: { [field]: [fieldMessages[field].required] } })
      }
    })
  }

  it('refuses the AC-6 body with an error for lastName alone', () => {
    const result = validateRegistration({ firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.fields)).toEqual(['lastName'])
  })

  it('names all four fields, in form order, when the form is empty', () => {
    const result = validateRegistration({ firstName: '', lastName: '', email: '', phone: '' })
    expect(result).toEqual({
      ok: false,
      fields: {
        firstName: ['Enter your first name.'],
        lastName: ['Enter your last name.'],
        email: ['Enter an email like name@example.com.'],
        phone: ['Enter a 10-digit US number without +1, e.g. (415) 555-0132.'],
      },
    })
    if (!result.ok) {
      expect(Object.keys(result.fields)).toEqual([...registrationFields])
      expect(errorSummary(Object.keys(result.fields).length)).toBe('4 fields need attention. Check the messages below.')
    }
  })

  it('accepts a complete body and returns the normalised values', () => {
    expect(validateRegistration({ ...valid, firstName: ' Jane ', phone: '(415) 555-0132' })).toEqual({ ok: true, value: valid })
  })

  it('refuses a body that is not an object, or carries an unknown field, without naming a field', () => {
    for (const body of [null, undefined, 'Jane', 42, [], [valid]]) {
      expect(validateRegistration(body)).toEqual({ ok: false, fields: {} })
    }
    expect(validateRegistration({ ...valid, id: 7 })).toEqual({ ok: false, fields: {} })
  })

  it('treats any whitespace-only value as empty, for every field (property)', () => {
    const whitespace = [' ', '\t', '\n', '\r', '\u00a0', '\u2003', '\u3000']
    for (let i = 0; i < RUNS; i++) {
      const field = registrationFields[Math.floor(rand() * registrationFields.length)] as (typeof registrationFields)[number]
      const blank = Array.from({ length: Math.floor(rand() * 12) }, () => whitespace[Math.floor(rand() * whitespace.length)]).join('')
      expect(validateRegistration({ ...valid, [field]: blank })).toEqual({
        ok: false,
        fields: { [field]: [fieldMessages[field].required] },
      })
    }
  })

  it('never echoes a submitted value in a field message', () => {
    const sentinel = 'SENTINEL-☃'
    const result = validateRegistration({ firstName: `${sentinel}\u202e`, lastName: '   ', email: sentinel, phone: sentinel })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('SENTINEL')
  })
})

describe('fieldErrors() — one message per field, from the shared schema', () => {
  it('maps schema issues to the first message of each field in form order', () => {
    const parsed = registrationRequest.safeParse({ phone: '', email: 'nope', lastName: '', firstName: 'Jane' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error)
      expect(fields).toEqual({
        lastName: [fieldMessages.lastName.required],
        email: [fieldMessages.email.invalid],
        phone: [fieldMessages.phone.required],
      })
      expect(Object.keys(fields)).toEqual(['lastName', 'email', 'phone'])
    }
  })

  it('ignores issues that name no field', () => {
    const parsed = registrationRequest.safeParse({ ...valid, extra: 'x' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(fieldErrors(parsed.error)).toEqual({})
  })
})

describe('firstInvalidField() — where focus moves after a failed Submit (AC-3, AC-5)', () => {
  it('picks the first flagged field in form order, whatever the key order', () => {
    expect(firstInvalidField({ phone: ['x'], firstName: ['y'] })).toBe('firstName')
    expect(firstInvalidField({ phone: ['x'], email: ['y'] })).toBe('email')
    expect(firstInvalidField({ phone: [fieldMessages.phone.required] })).toBe('phone')
  })

  it('is null when no field is flagged', () => {
    expect(firstInvalidField({})).toBeNull()
    expect(firstInvalidField({ email: [] })).toBeNull()
  })
})
