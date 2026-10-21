// ST-3 — the required-field rules shared by the screen and the API (AC-1 to AC-6).
import { describe, expect, it } from 'vitest'
import {
  attentionSummary,
  fieldLabels,
  isBlank,
  normalise,
  registrationFields,
  requiredMessages,
  validateRegistration,
  validationErrorEnvelope,
  visitorRegistrationInput,
} from './index.js'

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' } as const

describe('the four visitor fields and their required messages (ST-3)', () => {
  it('names the four fields in tab order', () => {
    expect(registrationFields).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it.each([
    ['firstName', 'First name', 'Enter your first name.'],
    ['lastName', 'Last name', 'Enter your last name.'],
    ['email', 'Email', 'Enter an email like name@example.com.'],
    ['phone', 'Phone number', 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'],
  ] as const)('%s is labelled "%s" and, when empty, says "%s" (AC-3)', (field, label, message) => {
    expect(fieldLabels[field]).toBe(label)
    expect(requiredMessages[field]).toBe(message)
  })

  it.each([
    [1, '1 field needs attention. Check the messages below.'],
    [2, '2 fields need attention. Check the messages below.'],
    [3, '3 fields need attention. Check the messages below.'],
    [4, '4 fields need attention. Check the messages below.'],
  ])('the summary for %i reads "%s" (AC-3)', (count, text) => {
    expect(attentionSummary(count)).toBe(text)
  })
})

describe('a missing field stops the registration (AC-1)', () => {
  it.each(registrationFields)('with only %s empty, only %s is flagged', (field) => {
    const result = validateRegistration({ ...valid, [field]: '' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors).toEqual({ [field]: requiredMessages[field] })
    expect(result.firstInvalid).toBe(field)
    expect(result.fields).toEqual([{ path: field, message: requiredMessages[field] }])
  })

  it('accepts the four filled fields and returns them normalised', () => {
    const result = validateRegistration({ firstName: '  Jane ', lastName: 'Doe\t', email: ' jane.doe@example.com', phone: ' 4155550132 ' })
    expect(result).toEqual({ success: true, data: valid })
  })

  it('drops keys that are not one of the four fields', () => {
    const result = validateRegistration({ ...valid, admin: true })
    expect(result).toEqual({ success: true, data: valid })
  })
})

describe('a field of only spaces counts as empty (AC-2)', () => {
  it.each([
    ['spaces', '   '],
    ['a tab', '\t'],
    ['a newline', '\n'],
    ['a carriage return and newline', '\r\n'],
    ['no-break spaces', '\u00a0\u00a0'],
    ['an ideographic space', '\u3000'],
    ['zero-width spaces', '\u200b\u200b'],
    ['a byte-order mark', '\ufeff'],
    ['bidi controls', '\u202e\u2066\u2069'],
    ['a control character', '\u0000'],
    ['a mix', ' \u200b\t\u202e '],
  ])('%s is blank', (_name, value) => {
    expect(isBlank(value)).toBe(true)
    const result = validateRegistration({ ...valid, lastName: value })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors).toEqual({ lastName: 'Enter your last name.' })
  })

  it.each(['a', ' Jo ', '\u00d3', '\u674e', '\u200bA'])('%j is not blank', (value) => {
    expect(isBlank(value)).toBe(false)
  })

  it('treats the empty string as blank', () => {
    expect(isBlank('')).toBe(true)
  })
})

describe('each empty field says what it needs (AC-3)', () => {
  it('flags all four, in tab order, with the first empty field focused and a summary of four', () => {
    const result = validateRegistration({ firstName: '', lastName: '', email: '', phone: '' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors).toEqual({
      firstName: 'Enter your first name.',
      lastName: 'Enter your last name.',
      email: 'Enter an email like name@example.com.',
      phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
    })
    expect(result.fields.map((f) => f.path)).toEqual(['firstName', 'lastName', 'email', 'phone'])
    expect(result.firstInvalid).toBe('firstName')
    expect(result.summary).toBe('4 fields need attention. Check the messages below.')
  })

  it('reports the first empty field in tab order, not in key order', () => {
    const result = validateRegistration({ phone: '', email: 'jane.doe@example.com', lastName: ' ', firstName: 'Jane' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.firstInvalid).toBe('lastName')
    expect(result.summary).toBe('2 fields need attention. Check the messages below.')
  })
})

describe('what was typed is kept when a field is missed (AC-5)', () => {
  it('flags only the phone and focuses it when the other three are filled', () => {
    const result = validateRegistration({ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors).toEqual({ phone: requiredMessages.phone })
    expect(result.firstInvalid).toBe('phone')
    expect(result.summary).toBe('1 field needs attention. Check the messages below.')
  })
})

describe('the API refuses a blank field sent directly (AC-6)', () => {
  it('names lastName for the story’s body', () => {
    const result = validateRegistration({ firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.fields).toEqual([{ path: 'lastName', message: 'Enter your last name.' }])
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a number', 42],
    ['a boolean', true],
    ['an array', ['Jane']],
    ['an object', { value: 'Jane' }],
  ])('a firstName that is %s is named with its required message', (_name, value) => {
    const body: Record<string, unknown> = { ...valid, firstName: value }
    if (value === undefined) delete body.firstName
    const result = validateRegistration(body)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.fields).toEqual([{ path: 'firstName', message: 'Enter your first name.' }])
  })

  it.each([
    ['null', null],
    ['a string', 'Jane Doe'],
    ['a number', 7],
    ['an array', []],
    ['undefined', undefined],
  ])('a body that is %s names all four fields', (_name, body) => {
    const result = validateRegistration(body)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.fields.map((f) => f.path)).toEqual(['firstName', 'lastName', 'email', 'phone'])
    expect(result.firstInvalid).toBe('firstName')
  })

  it('an empty object names all four fields', () => {
    const result = validateRegistration({})
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors).toEqual(requiredMessages)
  })

  it('builds the AD-5 400 envelope from the result, echoing no submitted value', () => {
    const sentinel = 'SENTINEL-7f3a'
    const result = validateRegistration({ firstName: sentinel, lastName: ' ', email: `${sentinel}@example.com`, phone: '' })
    expect(result.success).toBe(false)
    if (result.success) return
    const body = validationErrorEnvelope(result)
    expect(body).toEqual({
      error: {
        message: '2 fields need attention. Check the messages below.',
        fields: [
          { path: 'lastName', message: 'Enter your last name.' },
          { path: 'phone', message: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.' },
        ],
      },
    })
    expect(JSON.stringify(body)).not.toContain(sentinel)
  })

  it('the zod schema refuses blanks with the field’s own message', () => {
    const parsed = visitorRegistrationInput.safeParse({ ...valid, email: ' \t ' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['email', 'Enter an email like name@example.com.']])
  })
})

describe('normalisation properties', () => {
  // A small seeded generator stands in for a property-testing library (the lockfile has none).
  const alphabet = ['a', 'Z', '7', ' ', '\t', '\n', '\u00a0', '\u3000', '\u200b', '\u202e', '\ufeff', '\u00e9', '-', '.', '@']
  function* samples(count: number, seed = 0x5eed): Generator<string> {
    let state = seed
    const next = () => (state = (state * 1103515245 + 12345) % 2 ** 31)
    for (let i = 0; i < count; i++) {
      const length = next() % 12
      let s = ''
      for (let j = 0; j < length; j++) s += alphabet[next() % alphabet.length]
      yield s
    }
  }

  it('normalise is idempotent', () => {
    for (const s of samples(500)) expect(normalise(normalise(s))).toBe(normalise(s))
  })

  it('surrounding whitespace never changes blankness or the normalised value', () => {
    for (const s of samples(500)) {
      expect(isBlank(` \t${s}\n `)).toBe(isBlank(s))
      expect(normalise(` \t${s}\n `)).toBe(normalise(s))
    }
  })

  it('a blank value always fails and a non-blank one never fails as required', () => {
    for (const s of samples(500)) {
      const result = validateRegistration({ ...valid, firstName: s })
      expect(result.success).toBe(!isBlank(s))
      if (result.success) expect(result.data.firstName).toBe(normalise(s))
    }
  })
})
