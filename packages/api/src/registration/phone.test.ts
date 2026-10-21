import { describe, expect, it } from 'vitest'
import { PHONE_MESSAGE, parseUsPhone } from './phone.js'

// ST-8 — the US phone rule the API applies to every submission: a 10-digit NANP number,
// written bare or with the usual separators, stored as its ten digits.
const ACCEPTED = ['4155550132', '(415) 555-0132', '415.555.0132']
const NOT_TEN_DIGITS = ['abc123', '5550132', '41555501329', '0155550132', '+44 20 7946 0958', '+1 415 555 0132', '1-415-555-0132']
const LEADING_ZERO_OR_ONE = ['4150550132', '4151550132', '1155550132']

describe('the phone message @story:ST-8 @criterion:AC-2', () => {
  it('reads exactly as the story words it', () => {
    expect(PHONE_MESSAGE).toBe('Enter a 10-digit US number without +1, e.g. (415) 555-0132.')
  })
})

describe('common ways of writing a US number are accepted @story:ST-8 @criterion:AC-1', () => {
  it.each(ACCEPTED)('%s is stored as 4155550132', (value) => {
    expect(parseUsPhone(value)).toBe('4155550132')
  })

  it.each(['415-555-0132', '415 555 0132', ' (415)555-0132 '])('%s is accepted too', (value) => {
    expect(parseUsPhone(value)).toBe('4155550132')
  })
})

describe('numbers that are not a 10-digit US number are rejected @story:ST-8 @criterion:AC-2', () => {
  it.each(NOT_TEN_DIGITS)('%s is rejected', (value) => {
    expect(parseUsPhone(value)).toBeNull()
  })

  it.each([
    '',
    '   ',
    '(415) 555-013',
    '415\u200b5550132',
    '\uff14\uff11\uff15\uff15\uff15\uff15\uff10\uff11\uff13\uff12',
    '415/555/0132',
    '415_555_0132',
    '(415 555-0132',
    '415) 555-0132',
    '4-1-5-5-5-5-0-1-3-2',
    '()4155550132',
    '...4155550132',
    '415  555 0132',
  ])('%j is rejected', (value) => {
    expect(parseUsPhone(value)).toBeNull()
  })
})

describe('an area code or exchange starting with 0 or 1 is rejected @story:ST-8 @criterion:AC-3', () => {
  it.each(LEADING_ZERO_OR_ONE)('%s is rejected', (value) => {
    expect(parseUsPhone(value)).toBeNull()
  })
})

// Deterministic property tests: a seeded generator so a failure always reproduces.
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

// Each test seeds its own generator so its values never depend on which tests ran first.
function generator(seed: number) {
  const random = prng(seed)
  const digit = (from = 0) => String(from + Math.floor(random() * (10 - from)))
  const digits = (n: number) => Array.from({ length: n }, () => digit()).join('')
  return { random, digit, digits }
}
const formats = [
  (a: string, e: string, l: string) => `${a}${e}${l}`,
  (a: string, e: string, l: string) => `(${a}) ${e}-${l}`,
  (a: string, e: string, l: string) => `${a}.${e}.${l}`,
  (a: string, e: string, l: string) => `${a}-${e}-${l}`,
]

describe('NANP acceptance holds for any number @story:ST-8 @criterion:AC-1 @criterion:AC-3', () => {
  it('accepts every NANP number in every format, as its ten digits', () => {
    const { digit, digits } = generator(1)
    for (let i = 0; i < 500; i += 1) {
      const area = digit(2) + digits(2)
      const exchange = digit(2) + digits(2)
      const line = digits(4)
      const format = formats[i % formats.length]!
      expect(parseUsPhone(format(area, exchange, line))).toBe(`${area}${exchange}${line}`)
    }
  })

  it('rejects any area code or exchange starting with 0 or 1', () => {
    const { random, digit, digits } = generator(2)
    for (let i = 0; i < 500; i += 1) {
      const bad = String(Math.floor(random() * 2))
      const area = i % 2 === 0 ? bad + digits(2) : digit(2) + digits(2)
      const exchange = i % 2 === 0 ? digit(2) + digits(2) : bad + digits(2)
      const format = formats[i % formats.length]!
      expect(parseUsPhone(format(area, exchange, digits(4)))).toBeNull()
    }
  })

  it('rejects a valid number behind a 1 or +1 country code', () => {
    const { digit, digits } = generator(3)
    for (let i = 0; i < 200; i += 1) {
      const number = digit(2) + digits(2) + digit(2) + digits(6)
      expect(parseUsPhone(`1${number}`)).toBeNull()
      expect(parseUsPhone(`+1${number}`)).toBeNull()
      expect(parseUsPhone(`+1 ${number}`)).toBeNull()
    }
  })

  it('is idempotent: the stored digits parse to themselves', () => {
    const { digit, digits } = generator(4)
    for (let i = 0; i < 200; i += 1) {
      const stored = parseUsPhone(formats[i % formats.length]!(digit(2) + digits(2), digit(2) + digits(2), digits(4)))
      expect(stored).not.toBeNull()
      expect(parseUsPhone(stored ?? '')).toBe(stored)
    }
  })
})
