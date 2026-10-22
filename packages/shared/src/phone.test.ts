import { describe, expect, it } from 'vitest'
import {
  editPhone,
  formatPhoneAsTyped,
  isUsPhone,
  messages,
  normalise,
  normalisePhone,
  phoneDigits,
  phoneSchema,
  registrationInput,
} from './index.js'

const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

/** A small seeded PRNG so the property runs are reproducible without extra packages. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const runs = 500

function digitFrom(rand: () => number, from: number): string {
  return String(from + Math.floor(rand() * (10 - from)))
}

function digitsFrom(rand: () => number, count: number): string {
  let out = ''
  for (let i = 0; i < count; i++) out += digitFrom(rand, 0)
  return out
}

/** A random NANP number: area code and exchange each start with 2–9. */
function nanp(rand: () => number): string {
  return digitFrom(rand, 2) + digitsFrom(rand, 2) + digitFrom(rand, 2) + digitsFrom(rand, 6)
}

const writings = [
  (d: string) => d,
  (d: string) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
  (d: string) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`,
  (d: string) => `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`,
  (d: string) => `  ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}  `,
]

describe('the phone message (ST-8)', () => {
  it('is the exact text shown under the phone field and returned by the API', () => {
    expect(messages.invalidPhone).toBe(phoneMessage)
  })
})

describe('accepted phone numbers (ST-8 AC-1)', () => {
  it.each(['4155550132', '(415) 555-0132', '415.555.0132'])('accepts %j and stores it as 4155550132', (phone) => {
    expect(isUsPhone(phone)).toBe(true)
    expect(normalisePhone(phone)).toBe('4155550132')
    expect(phoneSchema.parse(phone)).toBe('4155550132')
  })

  it.each(['415-555-0132', '415 555 0132', ' (415)555-0132 ', '2002000000', '9999999999'])('also accepts %j', (phone) => {
    expect(isUsPhone(phone)).toBe(true)
    expect(normalisePhone(phone)).toBe(phoneDigits(phone))
  })

  it('carries the stored digits through the registration schema', () => {
    const parsed = registrationInput.parse({ fullName: 'Ada Lovelace', email: 'ada@example.com', phone: '(415) 555-0132' })
    expect(parsed.phone).toBe('4155550132')
  })
})

describe('rejected phone numbers (ST-8 AC-2, AC-3, AC-8)', () => {
  const rejected = [
    // AC-2
    'abc123',
    '5550132',
    '41555501329',
    '0155550132',
    '+44 20 7946 0958',
    '+1 415 555 0132',
    '1-415-555-0132',
    // AC-3
    '4150550132',
    '4151550132',
    '1155550132',
    // Further edges: empty, whitespace, other punctuation, control and bidi characters, non-ASCII digits
    '',
    '   ',
    '415/555/0132',
    '415_555_0132',
    '4155550132\u0000',
    '\u202e4155550132',
    '415\u200b5550132',
    '٤١٥٥٥٥٠١٣٢',
    '14155550132',
    '(415) 555-0132 ext 7',
    '415\t555\t0132',
    '415\n555\n0132',
  ]

  it.each(rejected)('rejects %j', (phone) => {
    expect(isUsPhone(phone)).toBe(false)
    expect(normalisePhone(phone)).toBeUndefined()
    const parsed = phoneSchema.safeParse(phone)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.message)).toEqual([phoneMessage])
  })

  it.each([undefined, null, 4155550132, ['4155550132'], {}])('rejects the non-string %j with the same message', (phone) => {
    const parsed = phoneSchema.safeParse(phone)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.message)).toEqual([phoneMessage])
  })

  it.each(rejected)('reports %j against the phone path of the registration schema', (phone) => {
    const parsed = registrationInput.safeParse({ fullName: 'Ada Lovelace', email: 'ada@example.com', phone })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toHaveLength(1)
      expect(parsed.error.issues[0]?.path).toEqual(['phone'])
      expect(parsed.error.issues[0]?.message).toBe(phoneMessage)
    }
  })

  it('never echoes the submitted value in the message', () => {
    const sentinel = '+1 SENTINEL-8675309'
    const parsed = phoneSchema.safeParse(sentinel)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(JSON.stringify(parsed.error.issues)).not.toContain('SENTINEL')
  })
})

describe('NANP acceptance properties (ST-8 AC-1, AC-3)', () => {
  it('accepts every NANP number however it is written, storing its ten digits', () => {
    const rand = mulberry32(8)
    for (let i = 0; i < runs; i++) {
      const digits = nanp(rand)
      const write = writings[i % writings.length]!
      expect(normalisePhone(write(digits))).toBe(digits)
    }
  })

  it('rejects every number whose area code or exchange starts with 0 or 1', () => {
    const rand = mulberry32(80)
    for (let i = 0; i < runs; i++) {
      const digits = nanp(rand)
      const bad = String(Math.floor(rand() * 2))
      const broken = i % 2 === 0 ? bad + digits.slice(1) : digits.slice(0, 3) + bad + digits.slice(4)
      expect(isUsPhone(writings[i % writings.length]!(broken))).toBe(false)
    }
  })

  it('rejects every NANP number written with a leading 1 or +1', () => {
    const rand = mulberry32(800)
    for (let i = 0; i < runs; i++) {
      const digits = nanp(rand)
      const written = writings[i % writings.length]!(digits).trim()
      expect(isUsPhone(`1${written}`)).toBe(false)
      expect(isUsPhone(`+1 ${written}`)).toBe(false)
      expect(isUsPhone(`1-${written}`)).toBe(false)
    }
  })

  it('rejects every digit string that is not exactly ten digits long', () => {
    const rand = mulberry32(8000)
    for (let i = 0; i < runs; i++) {
      const length = [0, 1, 7, 9, 11, 12, 15][i % 7]!
      expect(isUsPhone(digitsFrom(rand, length))).toBe(false)
    }
  })

  it('keeps normalise() trim-idempotent on phone-shaped input', () => {
    const rand = mulberry32(80000)
    for (let i = 0; i < runs; i++) {
      const written = ` \t${writings[i % writings.length]!(nanp(rand))}\n `
      expect(normalise(normalise(written))).toBe(normalise(written))
      expect(normalisePhone(normalise(written))).toBe(normalisePhone(written))
    }
  })
})

describe('typing the phone number (ST-8 AC-4, AC-5)', () => {
  it('formats 4155550132 as (415) 555-0132', () => {
    expect(formatPhoneAsTyped('4155550132')).toBe('(415) 555-0132')
  })

  it('formats the number progressively as each digit is typed', () => {
    const shown: string[] = []
    let value = ''
    for (const key of '4155550132') {
      value = editPhone(value, value + key, value.length + 1).value
      shown.push(value)
    }
    expect(shown).toEqual([
      '4',
      '41',
      '415',
      '(415) 5',
      '(415) 55',
      '(415) 555',
      '(415) 555-0',
      '(415) 555-01',
      '(415) 555-013',
      '(415) 555-0132',
    ])
  })

  it('leaves a value starting with 1 unformatted', () => {
    let value = ''
    for (const key of '14155550132') value = editPhone(value, value + key, value.length + 1).value
    expect(value).toBe('14155550132')
    expect(formatPhoneAsTyped('14155550132')).toBe('14155550132')
  })

  it('leaves more than ten digits unformatted so the submit rule can flag them', () => {
    expect(formatPhoneAsTyped('41555501329')).toBe('41555501329')
  })

  it('produces no character for +, letters or other non-digits as they are typed', () => {
    let value = ''
    for (const key of '+abc415') value = editPhone(value, value + key, value.length + 1).value
    expect(value).toBe('415')
    expect(phoneDigits(value)).toBe('415')
  })

  it('keeps the caret in place when a non-digit is typed mid-number', () => {
    expect(editPhone('(415) 555-0132', '(415) 5x55-0132', 8)).toEqual({ value: '(415) 555-0132', caret: 7 })
  })

  it('keeps only the digits of a pasted +1 (415) 555-0132, unformatted because it starts with 1', () => {
    const pasted = '+1 (415) 555-0132'
    const result = editPhone('', pasted, pasted.length)
    expect(phoneDigits(result.value)).toBe('14155550132')
    expect(result).toEqual({ value: '14155550132', caret: 11 })
  })

  it('formats every digit string idempotently and without losing a digit', () => {
    const rand = mulberry32(9)
    for (let i = 0; i < runs; i++) {
      const digits = digitsFrom(rand, i % 13)
      const shown = formatPhoneAsTyped(digits)
      expect(phoneDigits(shown)).toBe(digits)
      expect(formatPhoneAsTyped(shown)).toBe(shown)
    }
  })

  it('strips every non-ASCII-digit character', () => {
    expect(phoneDigits('+1 (415) 555-0132')).toBe('14155550132')
    expect(phoneDigits('٤١٥ abc \u202e')).toBe('')
  })
})

describe('correcting the phone number (ST-8 AC-6)', () => {
  it('removes the digit before the caret on Backspace mid-number and keeps the caret where it was', () => {
    // "(415) 555|-0132": Backspace deletes the third 5 and the browser leaves the caret at index 8.
    const result = editPhone('(415) 555-0132', '(415) 55-0132', 8)
    expect(phoneDigits(result.value)).toBe('415550132')
    expect(result).toEqual({ value: '(415) 550-132', caret: 8 })
  })

  it('removes the digit before a formatting character when Backspace lands on it', () => {
    // "(415) 555-|0132": Backspace deletes the hyphen; the 5 before it goes instead.
    const result = editPhone('(415) 555-0132', '(415) 5550132', 9)
    expect(result).toEqual({ value: '(415) 550-132', caret: 8 })
  })

  it('removes the digit after a formatting character when Delete lands on it', () => {
    // "(415) 555|-0132": Delete removes the hyphen; the 0 after it goes instead.
    const result = editPhone('(415) 555-0132', '(415) 5550132', 9, 'forward')
    expect(result).toEqual({ value: '(415) 555-132', caret: 9 })
  })

  it('leaves the value unchanged when Backspace removes a formatting character with no digit before it', () => {
    expect(editPhone('(415) 5', '415) 5', 0)).toEqual({ value: '(415) 5', caret: 1 })
  })

  it('places the caret at the end when it sits beyond the last digit', () => {
    expect(editPhone('', '415', 99)).toEqual({ value: '415', caret: 3 })
  })
})

describe('edits that only drop formatting keep every digit (ST-8 AC-5, AC-6)', () => {
  it('keeps all ten digits when the same bare number is pasted over the whole formatted value', () => {
    expect(editPhone('(415) 555-0132', '4155550132', 10)).toEqual({ value: '(415) 555-0132', caret: 14 })
  })

  it('keeps all digits when a selection of several formatting characters is deleted', () => {
    // "(415|) |555-0132": the selected ") " is deleted in one go.
    expect(editPhone('(415) 555-0132', '(415555-0132', 4)).toEqual({ value: '(415) 555-0132', caret: 4 })
  })

  it('keeps all digits when a non-digit is typed over a selection of formatting characters', () => {
    // "(415|) |555-0132": typing x replaces the selected ") ".
    expect(editPhone('(415) 555-0132', '(415x555-0132', 5)).toEqual({ value: '(415) 555-0132', caret: 4 })
  })

  it('pastes digits over a selection in the middle, dropping the pasted non-digits', () => {
    // "(415) |555|-0132": "+1 2" pasted over the exchange.
    expect(editPhone('(415) 555-0132', '(415) +1 2-0132', 10)).toEqual({ value: '(415) 120-132', caret: 8 })
  })

  it('keeps the caret before the first digit when the first digit is deleted', () => {
    // "(4|25) 555-0132": Backspace removes the 4.
    expect(editPhone('(425) 555-0132', '(25) 555-0132', 1)).toEqual({ value: '(255) 550-132', caret: 1 })
  })
})
