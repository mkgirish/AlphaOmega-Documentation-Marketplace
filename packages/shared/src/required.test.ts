// ST-3 — the shared "required field" rules both sides use: a field that is missing,
// empty or only whitespace is blank, and each blank field has its own message.
import { describe, expect, it } from 'vitest'
import {
  attentionSummary,
  blankFields,
  errorEnvelope,
  isBlank,
  normalise,
  registrationFields,
  registrationRequired,
  requiredFieldErrors,
  requiredFieldsEnvelope,
  requiredMessages,
} from './index.js'

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' } as const

/** Deterministic PRNG (mulberry32) so the property tests are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const whitespace = [' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u2003', '\u3000', '\ufeff', '\u2028']
const visible = ['a', 'Z', '0', '@', '.', '-', "'", '\u00e9', '\u00df', '\u200b', '+', '(']

function pick<T>(next: () => number, from: readonly T[]): T {
  return from[Math.floor(next() * from.length)] as T
}

function randomFrom(next: () => number, alphabet: readonly string[], maxLength: number): string {
  const length = Math.floor(next() * (maxLength + 1))
  let out = ''
  for (let i = 0; i < length; i++) out += pick(next, alphabet)
  return out
}

describe('registrationFields', () => {
  it('lists the four visitor fields in tab order', () => {
    expect(registrationFields).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })
})

describe('requiredMessages (AC-3)', () => {
  it.each([
    ['firstName', 'Enter your first name.'],
    ['lastName', 'Enter your last name.'],
    ['email', 'Enter an email like name@example.com.'],
    ['phone', 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'],
  ] as const)('%s says "%s"', (field, message) => {
    expect(requiredMessages[field]).toBe(message)
  })

  it('has exactly one message per field', () => {
    expect(Object.keys(requiredMessages).sort()).toEqual([...registrationFields].sort())
  })
})

describe('attentionSummary (AC-3)', () => {
  it.each([
    [4, '4 fields need attention. Check the messages below.'],
    [3, '3 fields need attention. Check the messages below.'],
    [2, '2 fields need attention. Check the messages below.'],
    [1, '1 field needs attention. Check the message below.'],
  ])('reads %i as "%s"', (count, text) => {
    expect(attentionSummary(count)).toBe(text)
  })
})

describe('isBlank (AC-1, AC-2)', () => {
  it.each([
    ['the empty string', ''],
    ['a single space', ' '],
    ['three spaces', '   '],
    ['a tab', '\t'],
    ['a newline', '\n'],
    ['a no-break space', '\u00a0'],
    ['an ideographic space', '\u3000'],
    ['mixed whitespace', ' \t\r\n \u00a0 '],
  ])('treats %s as blank', (_label, value) => {
    expect(isBlank(value)).toBe(true)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 4155550132],
    ['a boolean', true],
    ['an object', { value: 'Jane' }],
    ['an array', ['Jane']],
  ])('treats %s (not a string) as blank', (_label, value) => {
    expect(isBlank(value)).toBe(true)
  })

  it.each([
    ['a name', 'Jane'],
    ['a padded name', '  Doe  '],
    ['a single character', 'x'],
    ['a zero-width space, which is not whitespace', '\u200b'],
  ])('does not treat %s as blank', (_label, value) => {
    expect(isBlank(value)).toBe(false)
  })

  it('property: any string made only of whitespace is blank', () => {
    const next = rng(0x5713)
    for (let i = 0; i < 500; i++) expect(isBlank(randomFrom(next, whitespace, 12))).toBe(true)
  })

  it('property: any string with one visible character is not blank, wherever the whitespace sits', () => {
    const next = rng(0xac2)
    for (let i = 0; i < 500; i++) {
      const value = randomFrom(next, whitespace, 6) + pick(next, visible) + randomFrom(next, [...whitespace, ...visible], 6)
      expect(isBlank(value)).toBe(false)
    }
  })

  it('property: blankness survives normalise(), and normalise() is idempotent', () => {
    const next = rng(0x1d3)
    for (let i = 0; i < 500; i++) {
      const value = randomFrom(next, [...whitespace, ...visible], 16)
      const once = normalise(value)
      expect(isBlank(once)).toBe(isBlank(value))
      expect(normalise(once)).toBe(once)
    }
  })
})

describe('blankFields (AC-1, AC-2, AC-3, AC-5)', () => {
  it('finds nothing blank in a complete registration', () => {
    expect(blankFields(valid)).toEqual([])
  })

  it.each(registrationFields)('finds %s when only it is empty', (field) => {
    expect(blankFields({ ...valid, [field]: '' })).toEqual([field])
  })

  it.each(registrationFields)('finds %s when only it is missing', (field) => {
    const values: Record<string, unknown> = { ...valid }
    delete values[field]
    expect(blankFields(values)).toEqual([field])
  })

  it('finds a last name of only spaces (AC-2)', () => {
    expect(blankFields({ ...valid, lastName: '   ' })).toEqual(['lastName'])
  })

  it('finds every field of an empty form, first name first (AC-3 focus order)', () => {
    expect(blankFields({ firstName: '', lastName: '', email: '', phone: '' })).toEqual(registrationFields)
    expect(blankFields({})).toEqual(registrationFields)
  })

  it('keeps tab order whatever order the keys arrive in (AC-5: the phone is the first blank)', () => {
    expect(blankFields({ phone: '', email: valid.email, lastName: 'Doe', firstName: 'Jane' })).toEqual(['phone'])
    expect(blankFields({ phone: ' ', email: '', firstName: 'Jane', lastName: '' })).toEqual(['lastName', 'email', 'phone'])
  })

  it('ignores keys that are not visitor fields', () => {
    expect(blankFields({ ...valid, middleName: '' })).toEqual([])
  })
})

describe('requiredFieldErrors (AC-3, AC-6)', () => {
  it('returns nothing for a complete registration', () => {
    expect(requiredFieldErrors(valid)).toEqual([])
  })

  it('names each blank field with its own message, in tab order', () => {
    expect(requiredFieldErrors({ firstName: '', lastName: '  ', email: valid.email, phone: undefined })).toEqual([
      { path: 'firstName', message: 'Enter your first name.' },
      { path: 'lastName', message: 'Enter your last name.' },
      { path: 'phone', message: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.' },
    ])
  })
})

describe('requiredFieldsEnvelope (AC-6)', () => {
  it('is undefined when nothing is blank', () => {
    expect(requiredFieldsEnvelope(valid)).toBeUndefined()
  })

  it('wraps the blank last name of the AC-6 body in the AD-5 error envelope', () => {
    const body = { firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' }
    expect(requiredFieldsEnvelope(body)).toEqual(
      errorEnvelope('1 field needs attention. Check the message below.', [{ path: 'lastName', message: 'Enter your last name.' }]),
    )
  })

  it('counts every blank field in the summary', () => {
    expect(requiredFieldsEnvelope({})?.error.message).toBe('4 fields need attention. Check the messages below.')
    expect(requiredFieldsEnvelope({})?.error.fields?.map((f) => f.path)).toEqual(registrationFields)
  })

  it('never echoes a submitted value', () => {
    const sentinel = 'SENTINEL-7f3a'
    const body = { firstName: ` ${sentinel} `, lastName: '\u00a0', email: `${sentinel}@example.com`, phone: '' }
    const envelope = requiredFieldsEnvelope(body)
    expect(envelope?.error.fields?.map((f) => f.path)).toEqual(['lastName', 'phone'])
    expect(JSON.stringify(envelope)).not.toContain(sentinel)
  })
})

describe('registrationRequired schema (AC-6)', () => {
  it('accepts a complete registration and hands back trimmed values', () => {
    const parsed = registrationRequired.safeParse({ firstName: '  Jane ', lastName: 'Doe', email: valid.email, phone: valid.phone })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ ...valid })
  })

  it('refuses the AC-6 body with exactly one issue, on lastName, carrying its message', () => {
    const parsed = registrationRequired.safeParse({ firstName: 'Jane', lastName: '  ', email: 'jane.doe@example.com', phone: '4155550132' })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['lastName', 'Enter your last name.']])
  })

  it.each(registrationFields)('refuses %s when empty, missing, only spaces or not a string', (field) => {
    for (const value of ['', '   ', '\t\n', undefined, null, 42]) {
      const parsed = registrationRequired.safeParse({ ...valid, [field]: value })
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([[field, requiredMessages[field]]])
    }
  })

  it('reports every blank field of an empty body, one issue each', () => {
    const parsed = registrationRequired.safeParse({})
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual(registrationFields)
  })

  it('agrees with blankFields on random bodies', () => {
    const next = rng(0xbeef)
    const choices = ['', ' ', '\u00a0\t', 'x', ' Jane ', undefined]
    for (let i = 0; i < 300; i++) {
      const body = Object.fromEntries(registrationFields.map((f) => [f, pick(next, choices)]))
      const parsed = registrationRequired.safeParse(body)
      const flagged = parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0])
      expect(flagged).toEqual(blankFields(body))
    }
  })
})
