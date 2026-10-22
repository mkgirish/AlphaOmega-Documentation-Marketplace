import { describe, expect, it } from 'vitest'
import {
  confirmation,
  createdResponse,
  errorEnvelope,
  errorEnvelopeSchema,
  fieldLimits,
  fieldMessages,
  formatUtcSeconds,
  isUtcSeconds,
  messages,
  normalise,
  normalisePhone,
  registrationCreatedEnvelope,
  registrationRequest,
  toCreatedResponse,
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

const rand = mulberry32(20261022)
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T
const randomString = (alphabet: readonly string[], max: number): string =>
  Array.from({ length: Math.floor(rand() * max) }, () => pick(alphabet)).join('')

const RUNS = 500

describe('registrationRequest — the four visitor fields (ST-2)', () => {
  it('accepts the AC-1 details unchanged', () => {
    expect(registrationRequest.parse(valid)).toEqual(valid)
  })

  it('trims and normalises the AC-3 details before storing', () => {
    const parsed = registrationRequest.parse({
      firstName: ' Jane ',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      phone: '(415) 555-0132',
    })
    expect(parsed).toEqual({ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' })
  })

  it('trims surrounding whitespace from the email', () => {
    expect(registrationRequest.parse({ ...valid, email: '  jane.doe@example.com\t' }).email).toBe('jane.doe@example.com')
  })

  it('rejects an unknown field rather than passing it through', () => {
    expect(registrationRequest.safeParse({ ...valid, id: 7 }).success).toBe(false)
  })

  it.each([
    ['firstName', '', fieldMessages.firstName.required],
    ['firstName', '   ', fieldMessages.firstName.required],
    ['lastName', '', fieldMessages.lastName.required],
    ['lastName', ' \t ', fieldMessages.lastName.required],
    ['email', '', fieldMessages.email.required],
    ['email', 'not-an-email', fieldMessages.email.invalid],
    ['email', 'jane.doe@', fieldMessages.email.invalid],
    ['phone', '', fieldMessages.phone.required],
    ['phone', '555-0132', fieldMessages.phone.invalid],
    ['phone', '0155550132', fieldMessages.phone.invalid],
    ['phone', '4150550132', fieldMessages.phone.invalid],
    ['phone', '41555501321', fieldMessages.phone.invalid],
    ['phone', '415-555-01ab', fieldMessages.phone.invalid],
  ] as const)('rejects %s %j with its message', (field, value, message) => {
    const parsed = registrationRequest.safeParse({ ...valid, [field]: value })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => [i.path.join('.'), i.message])).toContainEqual([field, message])
    }
  })

  it.each(['firstName', 'lastName', 'email', 'phone'] as const)('rejects a missing or non-string %s', (field) => {
    const { [field]: _omit, ...rest } = valid
    expect(registrationRequest.safeParse(rest).success).toBe(false)
    expect(registrationRequest.safeParse({ ...valid, [field]: 42 }).success).toBe(false)
  })

  it('reports one message per failing field, never echoing the submitted value', () => {
    const sentinel = 'SENTINEL-☃-value'
    const parsed = registrationRequest.safeParse({
      firstName: sentinel + '\u0007',
      lastName: sentinel + '\u202e',
      email: sentinel,
      phone: sentinel,
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues.map((i) => i.message))).not.toContain('SENTINEL')
      expect(new Set(parsed.error.issues.map((i) => i.path[0]))).toEqual(new Set(['firstName', 'lastName', 'email', 'phone']))
    }
  })
})

describe('field length boundaries', () => {
  it('holds names to 100 characters: 100 passes, 101 fails', () => {
    expect(fieldLimits.nameMax).toBe(100)
    for (const field of ['firstName', 'lastName'] as const) {
      expect(registrationRequest.safeParse({ ...valid, [field]: 'a'.repeat(100) }).success).toBe(true)
      const over = registrationRequest.safeParse({ ...valid, [field]: 'a'.repeat(101) })
      expect(over.success).toBe(false)
      if (!over.success) expect(over.error.issues[0]?.message).toBe(fieldMessages[field].tooLong)
    }
  })

  it('measures the name length after trimming', () => {
    expect(registrationRequest.safeParse({ ...valid, firstName: `  ${'a'.repeat(100)}  ` }).success).toBe(true)
  })

  it('holds the email to 254 characters: 254 passes, 255 fails', () => {
    expect(fieldLimits.emailMax).toBe(254)
    const domain = (len: number) => {
      // labels of up to 63 characters joined by dots, ending in .com
      const body = len - '.com'.length
      const labels: string[] = []
      let left = body
      while (left > 0) {
        const take = Math.min(63, left)
        labels.push('b'.repeat(take))
        left -= take + 1
      }
      return `${labels.join('.')}.com`
    }
    const local = 'a'.repeat(64)
    const at254 = `${local}@${domain(254 - 65)}`
    const at255 = `${local}@${domain(255 - 65)}`
    expect(at254).toHaveLength(254)
    expect(at255).toHaveLength(255)
    expect(registrationRequest.safeParse({ ...valid, email: at254 }).success).toBe(true)
    const over = registrationRequest.safeParse({ ...valid, email: at255 })
    expect(over.success).toBe(false)
    if (!over.success) expect(over.error.issues.map((i) => i.message)).toContain(fieldMessages.email.tooLong)
  })
})

describe('control and bidirectional characters', () => {
  it.each([
    ['NUL', '\u0000'],
    ['BEL', '\u0007'],
    ['newline', 'Ja\nne'],
    ['DEL', '\u007f'],
    ['C1 control', '\u0085'],
    ['RLO override', '\u202e'],
    ['LRE embedding', '\u202a'],
    ['RLI isolate', '\u2067'],
    ['PDI', '\u2069'],
    ['RLM mark', '\u200f'],
    ['Arabic letter mark', '\u061c'],
  ])('rejects a name holding a %s', (_label, ch) => {
    for (const field of ['firstName', 'lastName'] as const) {
      const parsed = registrationRequest.safeParse({ ...valid, [field]: `Ja${ch}ne` })
      expect(parsed.success).toBe(false)
      if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe(fieldMessages[field].invalid)
    }
  })

  it('rejects an email holding a bidi override', () => {
    expect(registrationRequest.safeParse({ ...valid, email: 'jane\u202e@example.com' }).success).toBe(false)
  })

  it('accepts accented, apostrophised and hyphenated names', () => {
    for (const name of ["O'Brien", 'Anne-Marie', 'Zoë', 'José', 'Đặng', '李']) {
      expect(registrationRequest.safeParse({ ...valid, firstName: name, lastName: name }).success).toBe(true)
    }
  })
})

describe('normalise() — trim idempotence (property)', () => {
  const alphabet = [' ', '\t', '\n', '\u00a0', ' ', 'a', 'B', 'é', '-', "'", '李', '1']

  it('is idempotent and leaves no surrounding or doubled whitespace', () => {
    for (let i = 0; i < RUNS; i++) {
      const s = randomString(alphabet, 40)
      const once = normalise(s)
      expect(normalise(once)).toBe(once)
      expect(once).toBe(once.trim())
      expect(once).not.toMatch(/\s\s/)
    }
  })

  it('makes a name valid or invalid regardless of surrounding whitespace', () => {
    for (let i = 0; i < RUNS; i++) {
      const core = randomString(['a', 'Z', 'é', '-', ' '], 110)
      const pad = randomString([' ', '\t'], 5)
      const a = registrationRequest.safeParse({ ...valid, firstName: core })
      const b = registrationRequest.safeParse({ ...valid, firstName: `${pad}${core}${pad}` })
      expect(b.success).toBe(a.success)
      if (a.success && b.success) expect(b.data.firstName).toBe(a.data.firstName)
    }
  })
})

describe('normalisePhone() — NANP acceptance', () => {
  it.each([
    ['4155550132', '4155550132'],
    ['(415) 555-0132', '4155550132'],
    ['415.555.0132', '4155550132'],
    ['415 555 0132', '4155550132'],
    ['+1 415 555 0132', '4155550132'],
    ['1-415-555-0132', '4155550132'],
    [' 415-555-0132 ', '4155550132'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected)
  })

  it.each([
    '',
    '555-0132',
    '0155550132',
    '1155550132',
    '4150550132',
    '4151550132',
    '24155550132',
    '+44 20 7946 0958',
    '415-555-013x',
    '415_555_0132',
  ])('rejects %j', (input) => {
    expect(normalisePhone(input)).toBeNull()
  })

  it('accepts every NXX-NXX-XXXX number in any common format (property)', () => {
    const digit = (lo: number) => String(lo + Math.floor(rand() * (10 - lo)))
    const formats = [
      (a: string, e: string, s: string) => `${a}${e}${s}`,
      (a: string, e: string, s: string) => `(${a}) ${e}-${s}`,
      (a: string, e: string, s: string) => `${a}-${e}-${s}`,
      (a: string, e: string, s: string) => `${a}.${e}.${s}`,
      (a: string, e: string, s: string) => `+1 ${a} ${e} ${s}`,
      (a: string, e: string, s: string) => `1 (${a}) ${e}-${s}`,
    ]
    for (let i = 0; i < RUNS; i++) {
      const area = digit(2) + digit(0) + digit(0)
      const exchange = digit(2) + digit(0) + digit(0)
      const subscriber = digit(0) + digit(0) + digit(0) + digit(0)
      const formatted = pick(formats)(area, exchange, subscriber)
      expect(normalisePhone(formatted)).toBe(area + exchange + subscriber)
      expect(registrationRequest.parse({ ...valid, phone: formatted }).phone).toBe(area + exchange + subscriber)
    }
  })

  it('rejects any number whose area code or exchange starts with 0 or 1 (property)', () => {
    for (let i = 0; i < RUNS; i++) {
      const digits = Array.from({ length: 10 }, () => String(Math.floor(rand() * 10)))
      const at = pick([0, 3])
      digits[at] = pick(['0', '1'])
      expect(normalisePhone(digits.join(''))).toBeNull()
    }
  })

  it('is idempotent on whatever it accepts (property)', () => {
    for (let i = 0; i < RUNS; i++) {
      const s = randomString(['(', ')', ' ', '-', '.', '+', '1', '2', '4', '5', '9', '0'], 18)
      const once = normalisePhone(s)
      if (once !== null) expect(normalisePhone(once)).toBe(once)
    }
  })
})

describe('the 201 response — firstName and createdAt, never the row id (AC-5)', () => {
  const row = {
    id: 42,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
    phone: '4155550132',
    createdAt: new Date(Date.UTC(2026, 9, 20, 14, 3, 27, 912)),
  }

  it('builds { data: { firstName, createdAt } } from a stored row', () => {
    expect(toCreatedResponse(row)).toEqual({ data: { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' } })
  })

  it('carries no row id, last name, email or phone', () => {
    const body = JSON.stringify(toCreatedResponse(row))
    for (const leaked of ['"id"', '42', 'Doe', 'jane.doe@example.com', '4155550132']) expect(body).not.toContain(leaked)
  })

  it('accepts an already formatted createdAt string', () => {
    expect(toCreatedResponse({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }).data.createdAt).toBe('2026-10-20T14:03:27Z')
  })

  it('validates against the response schemas', () => {
    expect(registrationCreatedEnvelope.parse(toCreatedResponse(row))).toEqual(toCreatedResponse(row))
    expect(createdResponse.safeParse({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z', id: 42 }).success).toBe(false)
    expect(createdResponse.safeParse({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27.912Z' }).success).toBe(false)
    expect(createdResponse.safeParse({ firstName: 'Jane', createdAt: '2026-10-20T14:03:27+02:00' }).success).toBe(false)
    expect(createdResponse.safeParse({ createdAt: '2026-10-20T14:03:27Z' }).success).toBe(false)
    expect(registrationCreatedEnvelope.safeParse({ data: { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }, id: 1 }).success).toBe(
      false,
    )
  })

  it('validates error envelopes and rejects extra keys', () => {
    expect(errorEnvelopeSchema.safeParse({ error: { message: 'x' } }).success).toBe(true)
    expect(errorEnvelopeSchema.safeParse({ error: { message: 'x', fields: [{ path: 'email', message: 'y' }] } }).success).toBe(true)
    expect(errorEnvelopeSchema.safeParse({ error: { message: 'x', detail: 'pg' } }).success).toBe(false)
    expect(errorEnvelopeSchema.safeParse({ error: { message: 'x' }, data: {} }).success).toBe(false)
  })
})

describe('created_at in ISO 8601 UTC whole seconds (AC-3)', () => {
  it.each([
    ['2026-10-20T14:03:27Z', true],
    ['2026-10-20T14:03:27.000Z', false],
    ['2026-10-20 14:03:27Z', false],
    ['2026-10-20T14:03:27', false],
    ['2026-10-20T14:03:27+00:00', false],
    ['2026-13-20T14:03:27Z', false],
    ['2026-02-30T14:03:27Z', false],
    ['2026-10-20T24:03:27Z', false],
  ])('isUtcSeconds(%j) is %s', (value, expected) => {
    expect(isUtcSeconds(value)).toBe(expected)
  })

  it('formats any instant to a value isUtcSeconds accepts, truncating the milliseconds (property)', () => {
    for (let i = 0; i < RUNS; i++) {
      const ms = Math.floor(rand() * Date.UTC(2100, 0, 1))
      const s = formatUtcSeconds(new Date(ms))
      expect(isUtcSeconds(s)).toBe(true)
      expect(Date.parse(s)).toBe(Math.floor(ms / 1000) * 1000)
    }
  })
})

describe('confirmation copy — the only acknowledgement (AC-1, AC-4, AC-6)', () => {
  it('thanks the visitor by first name', () => {
    expect(confirmation.heading('Jane')).toBe('Thank you, Jane!')
  })

  it('holds the exact on-screen strings', () => {
    expect(confirmation.body).toBe('Your visit has been registered.')
    expect(confirmation.registerAnother).toBe('Register another visitor')
    expect(confirmation.pageTitle).toBe('Registration complete')
    expect(confirmation.submitting).toBe('Submitting…')
  })

  it('keeps the visitor name out of the tab title', () => {
    expect(confirmation.pageTitle).not.toContain('Jane')
  })

  it('mentions no email or text message', () => {
    const copy = [confirmation.heading('Jane'), confirmation.body, confirmation.registerAnother, confirmation.pageTitle].join(' ')
    expect(copy).not.toMatch(/e-?mail|text message|sms/i)
  })
})

describe('AD-5 envelope helpers', () => {
  it('carries field errors in the error envelope when given', () => {
    const fields = [{ path: 'email', message: fieldMessages.email.invalid }]
    const body = errorEnvelope(messages.required('Email'), fields)
    expect(body).toEqual({ error: { message: 'Email is required.', fields } })
    expect(errorEnvelopeSchema.parse(body)).toEqual(body)
  })
})
