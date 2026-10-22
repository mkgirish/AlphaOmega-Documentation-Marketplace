import { describe, expect, it } from 'vitest'
import {
  confirmationCopy,
  errorEnvelope,
  errorEnvelopeSchema,
  fieldErrors,
  fieldMessages,
  formatUtcSeconds,
  limits,
  messages,
  normalise,
  normalisePhone,
  registrationCreated,
  registrationCreatedEnvelope,
  registrationRequest,
  toRegistrationCreated,
  utcSecondsPattern,
} from './index.js'

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

/** A small seeded PRNG so the property tests are repeatable without extra dependencies. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RUNS = 500
const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T
const randomString = (rand: () => number, alphabet: string, max: number): string =>
  Array.from({ length: Math.floor(rand() * max) }, () => pick(rand, [...alphabet])).join('')

function errorsOf(input: unknown): Record<string, string> {
  const errors = errorListOf(input)
  const byPath = Object.fromEntries(errors.map((f) => [f.path, f.message]))
  expect(Object.keys(byPath)).toHaveLength(errors.length)
  return byPath
}

function errorListOf(input: unknown): { path: string; message: string }[] {
  const parsed = registrationRequest.safeParse(input)
  return parsed.success ? [] : fieldErrors(parsed.error)
}

describe('ST-2 AC-1/AC-3: a valid registration parses to its stored form', () => {
  it('accepts Jane Doe as entered', () => {
    expect(registrationRequest.parse(jane)).toEqual(jane)
  })

  it('trims the names and normalises the phone to ten digits (AC-3)', () => {
    const parsed = registrationRequest.parse({
      firstName: ' Jane ',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      phone: '(415) 555-0132',
    })
    expect(parsed).toEqual({ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' })
  })

  it('trims the email without changing its case', () => {
    expect(registrationRequest.parse({ ...jane, email: '  Jane.Doe@Example.com ' }).email).toBe('Jane.Doe@Example.com')
  })

  it('collapses runs of inner spaces in names', () => {
    expect(registrationRequest.parse({ ...jane, firstName: 'Mary   Ann' }).firstName).toBe('Mary Ann')
  })
})

describe('field rules: every message, one per field (table)', () => {
  it.each([
    ['firstName', { ...jane, firstName: '' }, fieldMessages.firstName.required],
    ['firstName', { ...jane, firstName: '   ' }, fieldMessages.firstName.required],
    ['firstName', { ...jane, firstName: 'J'.repeat(101) }, fieldMessages.firstName.tooLong],
    ['firstName', { ...jane, firstName: 'Ja\u0000ne' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Ja\tne' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: '\u202EenaJ' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Jane\u2066' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Jane\u200F' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Jane\u061C' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Jane\u007F' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Jane\n' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Ja\u200Bne' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Ja\u2060ne' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Ja\u00ADne' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: '\uFEFFJane' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Ja\uD800ne' }, fieldMessages.firstName.invalid],
    ['firstName', { ...jane, firstName: 'Ja\u0085ne' }, fieldMessages.firstName.invalid],
    ['lastName', { ...jane, lastName: '' }, fieldMessages.lastName.required],
    ['lastName', { ...jane, lastName: 'D'.repeat(101) }, fieldMessages.lastName.tooLong],
    ['lastName', { ...jane, lastName: 'Do\u0007e' }, fieldMessages.lastName.invalid],
    ['lastName', { ...jane, lastName: 'Doe\u202A' }, fieldMessages.lastName.invalid],
    ['email', { ...jane, email: '' }, fieldMessages.email.required],
    ['email', { ...jane, email: ' ' }, fieldMessages.email.required],
    ['email', { ...jane, email: 'not-an-email' }, fieldMessages.email.invalid],
    ['email', { ...jane, email: 'jane@' }, fieldMessages.email.invalid],
    ['email', { ...jane, email: 'jane.doe@exa\u202Emple.com' }, fieldMessages.email.invalid],
    ['email', { ...jane, email: 'jane\u0000doe@example.com' }, fieldMessages.email.invalid],
    [
      'email',
      { ...jane, email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com` },
      fieldMessages.email.tooLong,
    ],
    ['phone', { ...jane, phone: '' }, fieldMessages.phone.required],
    ['phone', { ...jane, phone: '  ' }, fieldMessages.phone.required],
    ['phone', { ...jane, phone: '415555013' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '41555501322' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '0155550132' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '1155550132' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '4150550132' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '4151550132' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '415-555-O132' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '+44 20 7946 0958' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '21155501321' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '415\u202E5550132' }, fieldMessages.phone.invalid],
    ['phone', { ...jane, phone: '415\u0000555\u00000132' }, fieldMessages.phone.invalid],
  ] as const)('rejects %s with its message (%#)', (path, input, message) => {
    expect(errorListOf(input)).toEqual([{ path, message }])
  })

  it('reports every missing field at once with the required messages', () => {
    expect(errorsOf({})).toEqual({
      firstName: fieldMessages.firstName.required,
      lastName: fieldMessages.lastName.required,
      email: fieldMessages.email.required,
      phone: fieldMessages.phone.required,
    })
  })

  it.each([42, null, ['Jane'], { v: 'Jane' }, true])('treats a non-string value %j as missing', (value) => {
    expect(errorsOf({ ...jane, firstName: value })).toEqual({ firstName: fieldMessages.firstName.required })
  })

  it('rejects an unknown field without naming its value', () => {
    const parsed = registrationRequest.safeParse({ ...jane, id: 'sentinel-id-123' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(fieldErrors(parsed.error)).toEqual([{ path: '', message: fieldMessages.unknownField }])
  })

  it.each([null, 'Jane', 7, []])('rejects a body that is not an object (%j)', (body) => {
    const parsed = registrationRequest.safeParse(body)
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(fieldErrors(parsed.error)).toEqual([{ path: '', message: fieldMessages.notAnObject }])
  })

  it('keeps the exact message wording the screen and the API share', () => {
    expect(fieldMessages).toMatchObject({
      firstName: {
        required: 'Enter your first name.',
        tooLong: 'First name must be 100 characters or fewer.',
        invalid: 'First name contains characters that are not allowed.',
      },
      lastName: {
        required: 'Enter your last name.',
        tooLong: 'Last name must be 100 characters or fewer.',
        invalid: 'Last name contains characters that are not allowed.',
      },
      email: {
        required: 'Enter your email address.',
        tooLong: 'Email must be 254 characters or fewer.',
        invalid: 'Enter a valid email address.',
      },
      phone: {
        required: 'Enter your phone number.',
        invalid: 'Enter a 10-digit US phone number, e.g. (415) 555-0132.',
      },
      unknownField: 'The request contains a field that is not allowed.',
      notAnObject: 'The request body must be a JSON object.',
    })
  })
})

describe('boundaries', () => {
  it('exposes the limits the rules enforce', () => {
    expect(limits).toEqual({ nameMax: 100, emailMax: 254 })
  })

  it.each(['firstName', 'lastName'] as const)('accepts 100 characters of %s and rejects 101', (field) => {
    expect(errorsOf({ ...jane, [field]: 'a'.repeat(100) })).toEqual({})
    expect(errorsOf({ ...jane, [field]: 'a'.repeat(101) })).toEqual({ [field]: fieldMessages[field].tooLong })
  })

  it('counts name length after trimming', () => {
    expect(errorsOf({ ...jane, firstName: `  ${'a'.repeat(100)}  ` })).toEqual({})
  })

  it('counts name length in characters, not UTF-16 code units', () => {
    expect(errorsOf({ ...jane, firstName: '𝒥'.repeat(100) })).toEqual({})
    expect(errorsOf({ ...jane, firstName: '𝒥'.repeat(101) })).toEqual({ firstName: fieldMessages.firstName.tooLong })
  })

  it('accepts names with accents, apostrophes and hyphens', () => {
    expect(errorsOf({ ...jane, firstName: 'Zoë-Anne', lastName: "O'Brien" })).toEqual({})
  })

  // RFC 5321-shaped: a 64-character local part and domain labels of at most 63 characters.
  const emailOf = (length: number) => `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(length - 64 - 1 - 128 - 4)}.com`

  it('accepts a 254-character email and rejects 255', () => {
    expect(emailOf(254)).toHaveLength(254)
    expect(errorsOf({ ...jane, email: emailOf(254) })).toEqual({})
    expect(errorsOf({ ...jane, email: emailOf(255) })).toEqual({ email: fieldMessages.email.tooLong })
  })

  it('counts email length after trimming', () => {
    expect(errorsOf({ ...jane, email: `  ${emailOf(254)}  ` })).toEqual({})
  })
})

describe('normalisePhone (NANP)', () => {
  it.each([
    ['4155550132', '4155550132'],
    ['(415) 555-0132', '4155550132'],
    ['415-555-0132', '4155550132'],
    ['415.555.0132', '4155550132'],
    ['415 555 0132', '4155550132'],
    ['  (415)555-0132 ', '4155550132'],
    ['+1 415 555 0132', '4155550132'],
    ['1-415-555-0132', '4155550132'],
    ['+1 (415) 555-0132', '4155550132'],
    ['14155550132', '4155550132'],
  ])('normalises %j to %j', (raw, digits) => {
    expect(normalisePhone(raw)).toBe(digits)
  })

  it.each(['', 'abc', '555-0132', '0155550132', '4151550132', '+2 415 555 0132', '(415 555-0132)', '415--555-0132', '4155550132x1'])(
    'returns null for %j',
    (raw) => {
      expect(normalisePhone(raw)).toBeNull()
    },
  )

  it('property: every valid NANP number is accepted in every common format', () => {
    const rand = prng(2)
    const digit = (from: number) => String(from + Math.floor(rand() * (10 - from)))
    for (let i = 0; i < RUNS; i++) {
      const area = digit(2) + digit(0) + digit(0)
      const exchange = digit(2) + digit(0) + digit(0)
      const line = digit(0) + digit(0) + digit(0) + digit(0)
      const formats = [
        `${area}${exchange}${line}`,
        `(${area}) ${exchange}-${line}`,
        `${area}-${exchange}-${line}`,
        `${area}.${exchange}.${line}`,
        `+1 ${area} ${exchange} ${line}`,
        `1${area}${exchange}${line}`,
      ]
      const raw = pick(rand, formats)
      expect(normalisePhone(raw)).toBe(`${area}${exchange}${line}`)
      expect(registrationRequest.parse({ ...jane, phone: raw }).phone).toBe(`${area}${exchange}${line}`)
    }
  })

  it('property: an area code or exchange starting with 0 or 1 is refused', () => {
    const rand = prng(3)
    for (let i = 0; i < RUNS; i++) {
      const digits = Array.from({ length: 10 }, () => String(Math.floor(rand() * 10)))
      const bad = rand() < 0.5 ? 0 : 3
      digits[bad] = pick(rand, ['0', '1'])
      expect(normalisePhone(digits.join(''))).toBeNull()
    }
  })

  it('property: normalising is idempotent', () => {
    const rand = prng(4)
    for (let i = 0; i < RUNS; i++) {
      const raw = randomString(rand, '0123456789 ()-.+1', 18)
      const once = normalisePhone(raw)
      if (once !== null) expect(normalisePhone(once)).toBe(once)
    }
  })
})

describe('normalise (trim) properties', () => {
  const alphabet = '   abcJé-’ '

  it('property: trimming is idempotent', () => {
    const rand = prng(5)
    for (let i = 0; i < RUNS; i++) {
      const raw = randomString(rand, alphabet, 30)
      expect(normalise(normalise(raw))).toBe(normalise(raw))
    }
  })

  it('property: the result never starts or ends with whitespace nor holds a double space', () => {
    const rand = prng(6)
    for (let i = 0; i < RUNS; i++) {
      const out = normalise(randomString(rand, alphabet, 30))
      expect(out).toBe(out.trim())
      expect(out).not.toMatch(/\s\s/)
    }
  })

  it('property: parsing a parsed registration gives the same registration', () => {
    const rand = prng(7)
    for (let i = 0; i < RUNS; i++) {
      const input = {
        firstName: `${randomString(rand, '  ', 3)}J${randomString(rand, 'ane ', 20)}`,
        lastName: `${randomString(rand, ' ', 3)}D${randomString(rand, 'oe -', 20)}${randomString(rand, ' ', 3)}`,
        email: `${randomString(rand, ' ', 2)}jane.doe@example.com${randomString(rand, ' ', 2)}`,
        phone: pick(rand, ['(415) 555-0132', '+1 415 555 0132', '4155550132']),
      }
      const once = registrationRequest.parse(input)
      expect(registrationRequest.parse(once)).toEqual(once)
    }
  })
})

describe('no message echoes what was submitted', () => {
  it.each(['firstName', 'lastName', 'email', 'phone'] as const)('keeps a sentinel in %s out of every message', (field) => {
    const sentinel = 'SENTINEL'
    for (const value of [sentinel, `${sentinel}\u202Ezz`, `${sentinel}${'x'.repeat(300)}`, `${sentinel}@`, ` ${sentinel} `]) {
      const parsed = registrationRequest.safeParse({ ...jane, [field]: value, extra: sentinel, SENTINEL_KEY: 1 })
      expect(parsed.success).toBe(false)
      if (parsed.success) continue
      expect(JSON.stringify(fieldErrors(parsed.error))).not.toContain('SENTINEL')
    }
  })

  it('names no unknown key in its message', () => {
    expect(JSON.stringify(errorListOf({ ...jane, SENTINEL_KEY: 'SENTINEL' }))).not.toContain('SENTINEL')
  })
})

describe('ST-2 AC-5: the 201 response holds firstName and createdAt and no row id', () => {
  const createdAt = '2026-10-20T14:03:27Z'

  it('builds the response from a stored row, dropping the id and other columns', () => {
    const row = {
      id: '0b0e3d1a-7d0c-4a43-9a32-4a8b52b0b1f3',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      phone: '4155550132',
      createdAt: new Date(Date.UTC(2026, 9, 20, 14, 3, 27, 912)),
    }
    const body = toRegistrationCreated(row)
    expect(body).toEqual({ data: { firstName: 'Jane', createdAt } })
    expect(JSON.stringify(body)).not.toContain(row.id)
    expect(JSON.stringify(body)).not.toMatch(/"id"/)
    expect(registrationCreatedEnvelope.parse(body)).toEqual(body)
  })

  it('accepts epoch milliseconds or an ISO string for createdAt', () => {
    expect(toRegistrationCreated({ firstName: 'Jane', createdAt: Date.UTC(2026, 9, 20, 14, 3, 27) }).data.createdAt).toBe(createdAt)
    expect(toRegistrationCreated({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27.400Z' }).data.createdAt).toBe(createdAt)
    expect(toRegistrationCreated({ firstName: 'Jane', createdAt: '2026-10-20T16:03:27.4+02:00' }).data.createdAt).toBe(createdAt)
  })

  it('refuses a response carrying an id or any extra field', () => {
    expect(registrationCreated.safeParse({ firstName: 'Jane', createdAt, id: 1 }).success).toBe(false)
    expect(registrationCreatedEnvelope.safeParse({ data: { firstName: 'Jane', createdAt }, id: 1 }).success).toBe(false)
  })

  it.each(['2026-10-20T14:03:27.000Z', '2026-10-20T14:03:27+00:00', '2026-10-20 14:03:27Z', '2026-10-20T14:03Z', ''])(
    'refuses createdAt %j that is not whole UTC seconds',
    (value) => {
      expect(registrationCreated.safeParse({ firstName: 'Jane', createdAt: value }).success).toBe(false)
      expect(utcSecondsPattern.test(value)).toBe(false)
    },
  )

  it('refuses an empty firstName', () => {
    expect(registrationCreated.safeParse({ firstName: '', createdAt }).success).toBe(false)
  })

  it('property: formatUtcSeconds always matches the createdAt pattern', () => {
    const rand = prng(8)
    for (let i = 0; i < RUNS; i++) {
      const ms = Math.floor(rand() * Date.UTC(9999, 11, 31))
      const formatted = formatUtcSeconds(ms)
      expect(formatted).toMatch(utcSecondsPattern)
      expect(Date.parse(formatted)).toBe(Math.floor(ms / 1000) * 1000)
    }
  })

  it('rejects a createdAt that is not a date', () => {
    expect(() => toRegistrationCreated({ firstName: 'Jane', createdAt: 'yesterday' })).toThrow(RangeError)
  })
})

describe('AD-5 error envelope schema', () => {
  it('accepts a message alone or with field errors', () => {
    expect(errorEnvelopeSchema.safeParse({ error: { message: 'Bad request.' } }).success).toBe(true)
    expect(errorEnvelopeSchema.safeParse({ error: { message: 'Bad.', fields: [{ path: 'email', message: 'x' }] } }).success).toBe(true)
  })

  it('refuses extra keys anywhere', () => {
    expect(errorEnvelopeSchema.safeParse({ error: { message: 'Bad.', detail: 'x' } }).success).toBe(false)
    expect(errorEnvelopeSchema.safeParse({ error: { message: 'Bad.' }, data: {} }).success).toBe(false)
  })
})

describe('ST-2 AC-1/AC-4/AC-6: the confirmation copy', () => {
  it('thanks the visitor by first name', () => {
    expect(confirmationCopy.heading('Jane')).toBe('Thank you, Jane!')
  })

  it('holds the exact acknowledgement, button, title and progress wording', () => {
    expect(confirmationCopy.body).toBe('Your visit has been registered.')
    expect(confirmationCopy.registerAnother).toBe('Register another visitor')
    expect(confirmationCopy.title).toBe('Registration complete')
    expect(confirmationCopy.submitting).toBe('Submitting…')
  })

  it('mentions no email or text message and keeps the name out of the title (AC-6)', () => {
    const text = [confirmationCopy.heading('Jane'), confirmationCopy.body, confirmationCopy.registerAnother].join(' ')
    expect(text).not.toMatch(/e-?mail|text message|sms/i)
    expect(confirmationCopy.title).not.toContain('Jane')
  })
})

describe('the scaffold helpers the 201 and 400 paths use', () => {
  it('formats a Date as whole UTC seconds', () => {
    expect(formatUtcSeconds(new Date(Date.UTC(2026, 9, 20, 14, 3, 27, 999)))).toBe('2026-10-20T14:03:27Z')
  })

  it('puts the field errors of a failed parse into the AD-5 envelope', () => {
    const parsed = registrationRequest.safeParse({ ...jane, email: 'nope' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const body = errorEnvelope(messages.invalidEmail, fieldErrors(parsed.error))
    expect(body).toEqual({
      error: { message: 'Enter a valid email address.', fields: [{ path: 'email', message: fieldMessages.email.invalid }] },
    })
    expect(errorEnvelopeSchema.parse(body)).toEqual(body)
  })
})
