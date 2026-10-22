// ST-9 — the shared email rule: a half-typed address is flagged with one message, on
// both the screen and the API, and the 254/255 boundary is held in one place.
import { describe, expect, it } from 'vitest'
import { EMAIL_MAX_LENGTH, emailSchema, isCompleteEmail, messages, registrationInput, toFieldErrors } from './index.js'

const MESSAGE = 'Enter an email like name@example.com.'

/** An address of exactly `length` characters in local@example.com form. */
const emailOfLength = (length: number): string => 'a'.repeat(length - '@example.com'.length) + '@example.com'

/** Deterministic PRNG so the property loops are reproducible without a property-test library. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

describe('the email message (ST-9 AC-2)', () => {
  it('reads exactly as the story states', () => {
    expect(messages.invalidEmail).toBe(MESSAGE)
  })
})

describe('ST-9 AC-1: a complete email is accepted and kept as entered', () => {
  it.each([
    'jane.doe@example.com',
    'name@example.com',
    'jane+kiosk@mail.example.co.uk',
    "o'brien@example.org",
    'a_b-c@sub-domain.example.io',
  ])('accepts %s unchanged', (email) => {
    expect(isCompleteEmail(email)).toBe(true)
    const parsed = emailSchema.safeParse(email)
    expect(parsed).toEqual({ success: true, data: email })
  })

  it('accepts it inside a whole registration', () => {
    const parsed = registrationInput.safeParse({ fullName: 'Jane Doe', email: 'jane.doe@example.com' })
    expect(parsed.success && parsed.data.email).toBe('jane.doe@example.com')
  })
})

describe('ST-9 AC-2: an incomplete email is rejected with the one message', () => {
  it.each(['jane', 'jane@', 'jane@example', '@example.com'])('rejects %s', (email) => {
    expect(isCompleteEmail(email)).toBe(false)
    const parsed = emailSchema.safeParse(email)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([MESSAGE])
  })

  it.each([
    '',
    '   ',
    'jane@@example.com',
    'jane@exa@mple.com',
    'ja ne@example.com',
    'jane@exa mple.com',
    '.jane@example.com',
    'jane.@example.com',
    'ja..ne@example.com',
    'jane@.example.com',
    'jane@example..com',
    'jane@example.com.',
    'jane@-example.com',
    'jane@example-.com',
    'jane@example.c',
    'jane@example.c0m',
    'jane@example.123',
    'jane@\u202eexample.com',
    'jane\u0000@example.com',
    'jane\t@example.com',
    'jané@example.com',
    `jane@${'a'.repeat(64)}.com`,
  ])('rejects the malformed %j', (email) => {
    expect(isCompleteEmail(email)).toBe(false)
    expect(emailSchema.safeParse(email).error?.issues.map((issue) => issue.message)).toEqual([MESSAGE])
  })

  it.each([42, null, undefined, {}, ['jane@example.com']])('rejects the non-string %j with the same message', (email) => {
    expect(isCompleteEmail(email)).toBe(false)
    expect(emailSchema.safeParse(email).error?.issues.map((issue) => issue.message)).toEqual([MESSAGE])
  })

  it.each(['jane', 'jane@', 'jane@example', '@example.com'])('flags only the email path of a registration holding %s', (email) => {
    const parsed = registrationInput.safeParse({ fullName: 'Jane Doe', email })
    expect(parsed.success).toBe(false)
    expect(toFieldErrors(parsed.error!.issues)).toEqual([{ path: 'email', message: MESSAGE }])
  })
})

describe('ST-9 AC-3: the 254/255 character boundary', () => {
  it('holds the limit at 254', () => {
    expect(EMAIL_MAX_LENGTH).toBe(254)
  })

  it('accepts an address of exactly 254 characters as entered', () => {
    const email = emailOfLength(254)
    expect(email).toHaveLength(254)
    expect(emailSchema.safeParse(email)).toEqual({ success: true, data: email })
  })

  it('rejects an address of 255 characters with the same message, once', () => {
    const email = emailOfLength(255)
    expect(email).toHaveLength(255)
    expect(isCompleteEmail(email)).toBe(false)
    expect(emailSchema.safeParse(email).error?.issues.map((issue) => issue.message)).toEqual([MESSAGE])
  })

  it('accepts 253 and rejects 256 and beyond', () => {
    expect(isCompleteEmail(emailOfLength(253))).toBe(true)
    for (const length of [256, 300, 1000]) expect(isCompleteEmail(emailOfLength(length))).toBe(false)
  })

  it('property: every length up to 254 is accepted and every length past it rejected', () => {
    for (let length = 'a@example.com'.length; length <= 400; length += 1) {
      expect(isCompleteEmail(emailOfLength(length))).toBe(length <= EMAIL_MAX_LENGTH)
    }
  })

  it('counts the length after surrounding whitespace is trimmed', () => {
    const email = emailOfLength(254)
    expect(emailSchema.safeParse(`  ${email}\n`)).toEqual({ success: true, data: email })
  })
})

describe('ST-9 normalisation of the email', () => {
  it('trims surrounding whitespace and keeps the rest as entered', () => {
    expect(emailSchema.safeParse('  Jane.Doe@Example.com  ')).toEqual({ success: true, data: 'Jane.Doe@Example.com' })
  })

  it('property: parsing is idempotent — a parsed address parses to itself', () => {
    const random = prng(9)
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const pick = (n: number) => Array.from({ length: n }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
    for (let i = 0; i < 200; i += 1) {
      const pad = ' '.repeat(Math.floor(random() * 3))
      const raw = `${pad}${pick(1 + Math.floor(random() * 20))}@${pick(1 + Math.floor(random() * 10))}.com${pad}`
      const once = emailSchema.parse(raw)
      expect(emailSchema.parse(once)).toBe(once)
      expect(once).toBe(raw.trim())
    }
  })

  it('property: an address missing its @, its local part or its dotted domain is always rejected', () => {
    const random = prng(254)
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789.-_'
    const pick = (n: number) => Array.from({ length: n }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
    for (let i = 0; i < 200; i += 1) {
      const word = `j${pick(Math.floor(random() * 12))}`
      for (const half of [word, `${word}@`, `@${word}.com`, `${word}@${word.replace(/\./g, '')}`]) {
        expect(isCompleteEmail(half)).toBe(false)
      }
    }
  })
})

describe('ST-9 edge cases around trimming and absence', () => {
  it.each(['  jane@  ', '\tjane@example\n', ' @example.com '])('rejects the padded incomplete %j', (email) => {
    expect(emailSchema.safeParse(email).error?.issues.map((issue) => issue.message)).toEqual([MESSAGE])
  })

  it('rejects 255 characters even when padding surrounds them', () => {
    expect(emailSchema.safeParse(`  ${emailOfLength(255)}  `).success).toBe(false)
  })

  it('flags a registration with no email at all under email', () => {
    const parsed = registrationInput.safeParse({ fullName: 'Jane Doe' })
    expect(parsed.success).toBe(false)
    expect(toFieldErrors(parsed.error!.issues)).toEqual([{ path: 'email', message: MESSAGE }])
  })

  it('accepts an internationalised top-level domain in its ASCII form', () => {
    expect(isCompleteEmail('jane@example.xn--p1ai')).toBe(true)
  })
})

describe('toFieldErrors — one entry per field, first message wins', () => {
  it('maps issues to the AD-5 field shape', () => {
    const parsed = registrationInput.safeParse({ fullName: '', email: 'jane@' })
    expect(parsed.success).toBe(false)
    expect(toFieldErrors(parsed.error!.issues)).toEqual([
      { path: 'fullName', message: expect.any(String) },
      { path: 'email', message: MESSAGE },
    ])
  })

  it('keeps the first message for a repeated path and skips pathless issues', () => {
    expect(
      toFieldErrors([
        { path: ['email'], message: 'first' },
        { path: ['email'], message: 'second' },
        { path: [], message: 'root' },
      ]),
    ).toEqual([{ path: 'email', message: 'first' }])
  })
})
