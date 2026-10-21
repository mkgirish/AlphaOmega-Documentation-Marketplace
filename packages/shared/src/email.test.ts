// ST-9 — the email rule shared by the screen and the API (CMP-2).
import { describe, expect, it } from 'vitest'
import { EMAIL_MAX_LENGTH, emailRule, isCompleteEmail, messages, registrationInput } from './index.js'

const EMAIL_MESSAGE = 'Enter an email like name@example.com.'

/** An address of exactly `length` characters ending in @example.com (AC-3). */
function emailOfLength(length: number): string {
  const domain = '@example.com'
  return 'a'.repeat(length - domain.length) + domain
}

/** Deterministic PRNG so the property tests are reproducible. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LOCAL_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'*+/=?^_`{|}~-"
const LABEL_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

function pick(random: () => number, chars: string, min: number, max: number): string {
  const length = min + Math.floor(random() * (max - min + 1))
  let out = ''
  for (let i = 0; i < length; i++) out += chars[Math.floor(random() * chars.length)]
  return out
}

function randomCompleteEmail(random: () => number): string {
  const local = pick(random, LOCAL_CHARS, 1, 20)
  const labels = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(random, LABEL_CHARS, 1, 12))
  const tld = pick(random, 'abcdefghijklmnopqrstuvwxyz', 2, 6)
  return `${local}@${[...labels, tld].join('.')}`
}

const parseEmail = (value: unknown) => emailRule.safeParse(value)

function expectRejected(value: unknown) {
  const parsed = parseEmail(value)
  expect(parsed.success).toBe(false)
  if (!parsed.success) expect(parsed.error.issues.map((issue) => issue.message)).toEqual([EMAIL_MESSAGE])
  expect(isCompleteEmail(value)).toBe(false)
}

describe('email rule — message', () => {
  it('uses the ST-9 wording', () => {
    expect(messages.invalidEmail).toBe(EMAIL_MESSAGE)
  })

  it('caps addresses at 254 characters', () => {
    expect(EMAIL_MAX_LENGTH).toBe(254)
  })
})

describe('email rule — AC-1 a complete email is accepted as entered', () => {
  it('accepts jane.doe@example.com unchanged', () => {
    const parsed = parseEmail('jane.doe@example.com')
    expect(parsed).toEqual({ success: true, data: 'jane.doe@example.com' })
    expect(isCompleteEmail('jane.doe@example.com')).toBe(true)
  })

  it.each([
    'jane@example.com',
    'a@b.co',
    'Jane.Doe@Example.COM',
    'jane+lobby@example.co.uk',
    "o'brien@example.ie",
    'first_last-1@sub.example-host.org',
    'x@123.example.com',
  ])('accepts %s', (value) => {
    expect(parseEmail(value)).toEqual({ success: true, data: value })
  })

  it('accepts a complete email inside the whole registration', () => {
    const parsed = registrationInput.safeParse({ fullName: 'Jane Doe', email: 'jane.doe@example.com' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.email).toBe('jane.doe@example.com')
  })
})

describe('email rule — AC-2 an incomplete email is flagged', () => {
  it.each(['jane', 'jane@', 'jane@example', '@example.com'])('rejects %s with the email message', (value) => {
    expectRejected(value)
  })

  it.each(['jane', 'jane@', 'jane@example', '@example.com'])('flags %s on the email path of the registration', (value) => {
    const parsed = registrationInput.safeParse({ fullName: 'Jane Doe', email: value })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toHaveLength(1)
      expect(parsed.error.issues[0]?.path).toEqual(['email'])
      expect(parsed.error.issues[0]?.message).toBe(EMAIL_MESSAGE)
    }
  })

  it.each([
    'jane@@example.com',
    'jane@exa mple.com',
    'ja ne@example.com',
    'jane@example.',
    'jane@.example.com',
    'jane@example..com',
    'jane@-example.com',
    'jane@example-.com',
    'jane@example.c',
    'jane@example.c0m',
    '.jane@example.com',
    'jane.@example.com',
    'ja..ne@example.com',
    'jane@example.com.',
    'jane@[127.0.0.1]',
    'jane(at)example.com',
    'jane@exam_ple.com',
    '"jane"@example.com',
  ])('rejects the malformed address %s', (value) => {
    expectRejected(value)
  })

  it.each([
    ['NUL', 'jane\u0000@example.com'],
    ['tab', 'jane\t@example.com'],
    ['newline', 'jane@example.com\nBcc: x@example.com'],
    ['DEL', 'jane\u007f@example.com'],
    ['right-to-left override', 'jane\u202e@example.com'],
    ['left-to-right isolate', 'jane@\u2066example.com'],
    ['zero-width space', 'ja\u200bne@example.com'],
    ['byte-order mark', 'ja\ufeffne@example.com'],
  ])('rejects an address carrying a %s character', (_name, value) => {
    expectRejected(value)
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', { email: 'jane@example.com' }],
  ])('rejects %s with the email message', (_name, value) => {
    expectRejected(value)
  })
})

describe('email rule — AC-3 the 254/255 boundary', () => {
  it('accepts an address of exactly 254 characters as entered', () => {
    const value = emailOfLength(254)
    expect(value).toHaveLength(254)
    expect(parseEmail(value)).toEqual({ success: true, data: value })
  })

  it('accepts an address of 253 characters', () => {
    expect(parseEmail(emailOfLength(253)).success).toBe(true)
  })

  it('rejects an address of 255 characters with the same message', () => {
    const value = emailOfLength(255)
    expect(value).toHaveLength(255)
    expectRejected(value)
  })

  it('rejects far longer addresses with the same message', () => {
    expectRejected(emailOfLength(1000))
  })

  it('measures the trimmed address, so padding a 254-character address is still accepted', () => {
    const value = emailOfLength(254)
    expect(parseEmail(`  ${value}  `)).toEqual({ success: true, data: value })
  })

  it('property: every length up to 254 is accepted and every length above is rejected', () => {
    for (let length = 6; length <= 300; length++) {
      const value = emailOfLength(Math.max(length, 13))
      expect(parseEmail(value).success, `length ${value.length}`).toBe(value.length <= 254)
    }
  })
})

describe('email rule — normalisation', () => {
  it('trims surrounding whitespace before validating and storing', () => {
    expect(parseEmail('  jane.doe@example.com \t')).toEqual({ success: true, data: 'jane.doe@example.com' })
  })

  it('property: trimming is idempotent — parsing the parsed value gives it back unchanged', () => {
    const random = prng(9)
    for (let i = 0; i < 500; i++) {
      const pad = () => ' \t\n'.slice(0, Math.floor(random() * 4))
      const once = parseEmail(`${pad()}${randomCompleteEmail(random)}${pad()}`)
      expect(once.success).toBe(true)
      if (once.success) expect(parseEmail(once.data)).toEqual(once)
    }
  })
})

describe('email rule — properties', () => {
  it('property: random complete addresses are accepted unchanged', () => {
    const random = prng(1)
    for (let i = 0; i < 500; i++) {
      const value = randomCompleteEmail(random)
      expect(parseEmail(value), value).toEqual({ success: true, data: value })
    }
  })

  it('property: dropping the domain, the local part, the TLD or the @ always rejects', () => {
    const random = prng(2)
    for (let i = 0; i < 500; i++) {
      const value = randomCompleteEmail(random)
      const at = value.lastIndexOf('@')
      const local = value.slice(0, at)
      const domain = value.slice(at + 1)
      const withoutTld = domain.slice(0, domain.lastIndexOf('.'))
      for (const broken of [local, `${local}@`, `@${domain}`, `${local}@${withoutTld.includes('.') ? '' : withoutTld}`, local + domain]) {
        expect(isCompleteEmail(broken), broken).toBe(false)
      }
    }
  })

  it('property: isCompleteEmail agrees with the schema', () => {
    const random = prng(3)
    const alphabet = 'ab.@-_ \u202e1'
    for (let i = 0; i < 1000; i++) {
      const value = pick(random, alphabet, 0, 16)
      expect(isCompleteEmail(value), JSON.stringify(value)).toBe(parseEmail(value).success)
    }
  })
})
