// ST-3 — a field left empty, or holding only whitespace, stops the registration: the
// shared rules name each empty field with its own message, in form order, and the API's
// 400 body names the same fields without echoing anything submitted.
import { describe, expect, it } from 'vitest'
import {
  attentionSummary,
  errorEnvelopeSchema,
  fieldMessages,
  registrationFields,
  registrationRequest,
  validateRegistration,
  validationErrorEnvelope,
} from './index.js'

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const empty = { firstName: '', lastName: '', email: '', phone: '' }

const ac3 = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
} as const

describe('empty-field copy (ST-3 AC-3)', () => {
  it.each(Object.entries(ac3))('%s says %j when left empty', (field, message) => {
    expect(fieldMessages[field as keyof typeof ac3].required).toBe(message)
  })

  it('lists the four fields in form order', () => {
    expect(registrationFields).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it.each([
    [4, '4 fields need attention. Check the messages below.'],
    [3, '3 fields need attention. Check the messages below.'],
    [2, '2 fields need attention. Check the messages below.'],
    [1, '1 field needs attention. Check the messages below.'],
  ])('the summary box for %i reads %j', (count, text) => {
    expect(attentionSummary(count)).toBe(text)
  })
})

describe('one empty field stops the registration (ST-3 AC-1, AC-6)', () => {
  it.each(registrationFields)('an empty %s fails with only its own message', (field) => {
    const result = validateRegistration({ ...valid, [field]: '' })
    expect(result).toEqual({ ok: false, errors: [{ path: field, message: ac3[field] }], firstInvalid: field })
  })

  it.each(registrationFields)('the request schema refuses an empty %s, naming it', (field) => {
    const parsed = registrationRequest.safeParse({ ...valid, [field]: '' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.map((i) => [i.path.join('.'), i.message])).toEqual([[field, ac3[field]]])
  })
})

describe('whitespace-only counts as empty (ST-3 AC-2)', () => {
  const blanks = ['   ', ' ', '\t', ' \t \n ', '\u00a0', ' \u3000', '\r\n']

  it.each(registrationFields.flatMap((field) => blanks.map((blank) => [field, blank] as const)))(
    '%s holding %j is treated as empty',
    (field, blank) => {
      const result = validateRegistration({ ...valid, [field]: blank })
      expect(result).toEqual({ ok: false, errors: [{ path: field, message: ac3[field] }], firstInvalid: field })
    },
  )

  it('treats any run of whitespace as empty in every field (property)', () => {
    const ws = [' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u2003', '\u3000', '\ufeff']
    let seed = 20261023
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let i = 0; i < 300; i++) {
      const field = registrationFields[Math.floor(next() * 4)] as (typeof registrationFields)[number]
      const blank = Array.from({ length: 1 + Math.floor(next() * 12) }, () => ws[Math.floor(next() * ws.length)]).join('')
      const result = validateRegistration({ ...valid, [field]: blank })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors).toEqual([{ path: field, message: ac3[field] }])
    }
  })
})

describe('every empty field gets its own message (ST-3 AC-3, AC-5)', () => {
  it('names all four in form order and points focus at the first', () => {
    const result = validateRegistration(empty)
    expect(result).toEqual({
      ok: false,
      errors: registrationFields.map((field) => ({ path: field, message: ac3[field] })),
      firstInvalid: 'firstName',
    })
  })

  it('points focus at the phone when only the phone is empty', () => {
    const result = validateRegistration({ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.firstInvalid).toBe('phone')
  })

  it('keeps form order whichever fields are empty', () => {
    const result = validateRegistration({ ...valid, phone: ' ', lastName: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.path)).toEqual(['lastName', 'phone'])
      expect(result.firstInvalid).toBe('lastName')
    }
  })

  it('reports at most one message per field', () => {
    const result = validateRegistration({ ...empty, email: 'x'.repeat(300) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const paths = result.errors.map((e) => e.path)
      expect(new Set(paths).size).toBe(paths.length)
    }
  })

  it('treats a missing or non-string field as empty', () => {
    const { phone: _omit, ...rest } = valid
    expect(validateRegistration(rest)).toEqual({
      ok: false,
      errors: [{ path: 'phone', message: ac3.phone }],
      firstInvalid: 'phone',
    })
    expect(validateRegistration({ ...valid, email: null })).toEqual({
      ok: false,
      errors: [{ path: 'email', message: ac3.email }],
      firstInvalid: 'email',
    })
  })

  it('gives the normalised values when nothing is empty', () => {
    expect(validateRegistration({ ...valid, firstName: '  Jane ', phone: '(415) 555-0132' })).toEqual({
      ok: true,
      value: valid,
    })
  })

  it('refuses a body that is not an object, or carries an unknown field, without naming a field', () => {
    for (const body of [null, 'Jane', 42, [valid], { ...valid, id: 7 }]) {
      expect(validateRegistration(body)).toEqual({ ok: false, errors: [], firstInvalid: null })
    }
  })
})

describe('the 400 body for empty fields (ST-3 AC-6)', () => {
  it('names lastName when it holds only spaces', () => {
    const result = validateRegistration({ firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const body = validationErrorEnvelope(result.errors)
      expect(body).toEqual({
        error: { message: attentionSummary(1), fields: [{ path: 'lastName', message: ac3.lastName }] },
      })
      expect(errorEnvelopeSchema.parse(body)).toEqual(body)
    }
  })

  it('names every empty field and matches the AD-5 error envelope', () => {
    const result = validateRegistration(empty)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const body = validationErrorEnvelope(result.errors)
      expect(errorEnvelopeSchema.safeParse(body).success).toBe(true)
      expect(body.error.message).toBe('4 fields need attention. Check the messages below.')
      expect(body.error.fields?.map((f) => f.path)).toEqual([...registrationFields])
    }
  })

  it('carries no submitted value (sentinel)', () => {
    const sentinel = 'SENTINEL-ST3'
    const result = validateRegistration({ firstName: '   ', lastName: sentinel, email: `${sentinel}@`, phone: sentinel })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.path)).toEqual(['firstName', 'email', 'phone'])
      expect(JSON.stringify(validationErrorEnvelope(result.errors))).not.toContain(sentinel)
      expect(JSON.stringify(result)).not.toContain(sentinel)
    }
  })

  it('still gives an AD-5 body when no field is named', () => {
    const body = validationErrorEnvelope([])
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true)
    expect(body.error.fields).toBeUndefined()
    expect(body.error.message.length).toBeGreaterThan(0)
  })
})
