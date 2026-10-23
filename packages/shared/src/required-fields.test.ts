// ST-3 — an empty or spaces-only field stops the registration on both sides: the copy each
// empty field shows, the summary count, the first field to focus, and the IF-2 400 body.
import { describe, expect, it } from 'vitest'
import {
  errorSummary,
  fieldLabels,
  fieldMessages,
  fieldOrder,
  firstInvalidField,
  isBlank,
  registrationRequest,
  validateRegistration,
  validationProblem,
  validationProblemSchema,
  type FieldName,
} from './index.js'

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const empty = { firstName: '', lastName: '', email: '', phone: '' }

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
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T
const RUNS = 500
const blanks = [' ', '\t', '\n', '\r', '\u00a0', '\u2003', '\u3000']
const randomBlank = (): string => Array.from({ length: Math.floor(rand() * 8) }, () => pick(blanks)).join('')

describe('the four required-field messages (AC-3)', () => {
  it.each([
    ['firstName', 'First name', 'Enter your first name.'],
    ['lastName', 'Last name', 'Enter your last name.'],
    ['email', 'Email', 'Enter an email like name@example.com.'],
    ['phone', 'Phone number', 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'],
  ] as const)('%s, labelled %j, says %j when empty', (field, label, message) => {
    expect(fieldLabels[field]).toBe(label)
    expect(fieldMessages[field].required).toBe(message)
  })

  it('gives a malformed phone the same hint IF-2 shows for the phone field', () => {
    expect(fieldMessages.phone.invalid).toBe(fieldMessages.phone.required)
  })

  it('lists the fields in on-screen order', () => {
    expect(fieldOrder).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it('never names a submitted value or another field in a required message', () => {
    for (const field of fieldOrder) {
      for (const other of fieldOrder) if (other !== field) expect(fieldMessages[field].required).not.toContain(fieldLabels[other])
    }
  })
})

describe('errorSummary() — how many fields need attention (AC-3)', () => {
  it.each([
    [1, '1 field needs attention. Check the messages below.'],
    [2, '2 fields need attention. Check the messages below.'],
    [3, '3 fields need attention. Check the messages below.'],
    [4, '4 fields need attention. Check the messages below.'],
  ])('reads %i as %j', (count, text) => {
    expect(errorSummary(count)).toBe(text)
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses %d, which no failed Submit can produce', (count) => {
    expect(() => errorSummary(count)).toThrow(RangeError)
  })
})

describe('isBlank() — spaces count as empty (AC-2)', () => {
  it.each(['', ' ', '   ', '\t', ' \n ', '\u00a0', ' \u3000'])('treats %j as blank', (value) => {
    expect(isBlank(value)).toBe(true)
  })

  it.each(['a', ' a ', '.', '0', '\u200b'])('treats %j as filled', (value) => {
    expect(isBlank(value)).toBe(false)
  })

  it('treats anything that is not a string as blank', () => {
    for (const value of [undefined, null, 0, false, {}, []]) expect(isBlank(value)).toBe(true)
  })
})

describe('validateRegistration() — one field empty stops it (AC-1)', () => {
  it('passes the valid details through, normalised', () => {
    expect(validateRegistration({ ...valid, phone: '(415) 555-0132' })).toEqual({ ok: true, value: valid })
  })

  it.each(fieldOrder)('fails with only %s flagged when it alone is empty', (field) => {
    const result = validateRegistration({ ...valid, [field]: '' })
    expect(result).toEqual({ ok: false, fieldErrors: { [field]: fieldMessages[field].required }, firstInvalid: field })
  })

  it.each(fieldOrder)('fails with only %s flagged when it alone is missing', (field) => {
    const { [field]: _omit, ...rest } = valid
    const result = validateRegistration(rest)
    expect(result).toEqual({ ok: false, fieldErrors: { [field]: fieldMessages[field].required }, firstInvalid: field })
  })

  it.each(fieldOrder)('fails with only %s flagged when it holds only spaces (AC-2)', (field) => {
    const result = validateRegistration({ ...valid, [field]: '   ' })
    expect(result).toEqual({ ok: false, fieldErrors: { [field]: fieldMessages[field].required }, firstInvalid: field })
  })

  it('flags every field of an empty form, in order, with focus on the first (AC-3)', () => {
    const result = validateRegistration(empty)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(Object.entries(result.fieldErrors)).toEqual([
        ['firstName', 'Enter your first name.'],
        ['lastName', 'Enter your last name.'],
        ['email', 'Enter an email like name@example.com.'],
        ['phone', 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'],
      ])
      expect(result.firstInvalid).toBe('firstName')
      expect(errorSummary(Object.keys(result.fieldErrors).length)).toBe('4 fields need attention. Check the messages below.')
    }
  })

  it('moves focus to the phone when only the phone was left empty (AC-5)', () => {
    const result = validateRegistration({ ...valid, phone: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.firstInvalid).toBe('phone')
  })

  it('shows one message per field even when a field breaks several rules', () => {
    const result = validateRegistration({ ...empty, email: 'x'.repeat(300) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.fieldErrors)).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it('keeps invalid-but-filled fields on their own message', () => {
    const result = validateRegistration({ ...valid, lastName: '', email: 'not-an-email' })
    expect(result).toEqual({
      ok: false,
      fieldErrors: { lastName: fieldMessages.lastName.required, email: fieldMessages.email.invalid },
      firstInvalid: 'lastName',
    })
  })

  it('fails a body that is not an object without flagging any field, as IF-2 does for malformed JSON', () => {
    for (const body of [undefined, null, 'Jane', 42, []]) {
      expect(validateRegistration(body)).toEqual({ ok: false, fieldErrors: {}, firstInvalid: null })
    }
  })

  it('fails an unknown field without flagging any visitor field', () => {
    const result = validateRegistration({ ...valid, id: 7 })
    expect(result).toEqual({ ok: false, fieldErrors: {}, firstInvalid: null })
  })

  it('never echoes a submitted value in a message', () => {
    const sentinel = 'SENTINEL-☃'
    const result = validateRegistration({ firstName: '   ', lastName: sentinel + '\u202e', email: sentinel, phone: sentinel })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('SENTINEL')
  })

  it('agrees with registrationRequest on every whitespace-only value (property)', () => {
    for (let i = 0; i < RUNS; i++) {
      const field = pick(fieldOrder)
      const blank = randomBlank()
      const input = { ...valid, [field]: blank }
      expect(isBlank(blank)).toBe(true)
      expect(registrationRequest.safeParse(input).success).toBe(false)
      expect(validateRegistration(input)).toEqual({
        ok: false,
        fieldErrors: { [field]: fieldMessages[field].required },
        firstInvalid: field,
      })
    }
  })

  it('focuses the first blank field in on-screen order for any mix of blanks (property)', () => {
    for (let i = 0; i < RUNS; i++) {
      const blankFields = fieldOrder.filter(() => rand() < 0.5)
      const input: Record<string, string> = { ...valid }
      for (const f of blankFields) input[f] = randomBlank()
      const result = validateRegistration(input)
      if (blankFields.length === 0) {
        expect(result.ok).toBe(true)
        continue
      }
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(Object.keys(result.fieldErrors)).toEqual(blankFields)
        expect(result.firstInvalid).toBe(blankFields[0])
      }
    }
  })
})

describe('firstInvalidField()', () => {
  it('picks the earliest flagged field in on-screen order, whatever the key order', () => {
    expect(firstInvalidField({ phone: 'x', lastName: 'y' })).toBe('lastName')
    expect(firstInvalidField({ email: 'x' })).toBe('email')
  })

  it('is null when nothing is flagged', () => {
    expect(firstInvalidField({})).toBeNull()
  })
})

describe('validationProblem() — the IF-2 400 body naming each blank field (AC-6)', () => {
  it('names lastName for the AC-6 body with a spaces-only last name', () => {
    const result = validateRegistration({ firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const body = validationProblem(result.fieldErrors)
      expect(body).toEqual({ error: 'validation', fields: { lastName: ['Enter your last name.'] } })
      expect(validationProblemSchema.parse(body)).toEqual(body)
    }
  })

  it.each(fieldOrder)('names only %s when it alone is blank', (field) => {
    const result = validateRegistration({ ...valid, [field]: ' \t ' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(validationProblem(result.fieldErrors)).toEqual({ error: 'validation', fields: { [field]: [fieldMessages[field].required] } })
    }
  })

  it('lists the fields in on-screen order, whatever the key order', () => {
    const errors: Partial<Record<FieldName, string>> = { phone: fieldMessages.phone.required, firstName: fieldMessages.firstName.required }
    expect(Object.keys(validationProblem(errors).fields)).toEqual(['firstName', 'phone'])
  })

  it('carries empty fields when no visitor field is flagged, as for malformed JSON', () => {
    const body = validationProblem({})
    expect(body).toEqual({ error: 'validation', fields: {} })
    expect(validationProblemSchema.parse(body)).toEqual(body)
  })

  it('never echoes a submitted value', () => {
    const sentinel = 'SENTINEL-value'
    const result = validateRegistration({ firstName: sentinel + '\u0007', lastName: ' ', email: sentinel, phone: sentinel })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(JSON.stringify(validationProblem(result.fieldErrors))).not.toContain('SENTINEL')
  })

  it('rejects bodies outside the IF-2 ValidationProblem shape', () => {
    expect(validationProblemSchema.safeParse({ error: 'validation', fields: { lastName: ['x'] } }).success).toBe(true)
    expect(validationProblemSchema.safeParse({ error: 'forbidden', fields: {} }).success).toBe(false)
    expect(validationProblemSchema.safeParse({ error: 'validation' }).success).toBe(false)
    expect(validationProblemSchema.safeParse({ error: 'validation', fields: { id: ['x'] } }).success).toBe(false)
    expect(validationProblemSchema.safeParse({ error: 'validation', fields: { lastName: 'x' } }).success).toBe(false)
    expect(validationProblemSchema.safeParse({ error: 'validation', fields: {}, detail: 'pg' }).success).toBe(false)
  })
})
