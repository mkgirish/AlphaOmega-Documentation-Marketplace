// ST-8 — the shared US phone rule (CMP-2): one normaliser, one message and one as-you-type
// formatter, imported by the screen and the API so both sides agree (AD-2, AD-3).
import { describe, expect, it } from 'vitest'
import {
  backspacePhone,
  formatPhoneAsTyped,
  isValidUsPhone,
  messages,
  normalisePhone,
  phoneCaretAfterDigits,
  phoneDigits,
  phoneDigitsBefore,
  phoneNumber,
  registrationInput,
} from './index.js'

const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

/** Deterministic PRNG (mulberry32) so the property tests are reproducible without a library. */
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
const digit = (next: () => number, from = 0) => String(from + Math.floor(next() * (10 - from)))
const digits = (next: () => number, n: number) => Array.from({ length: n }, () => digit(next)).join('')
/** A random NANP number: area code and exchange each start with 2–9. */
const nanp = (next: () => number) => digit(next, 2) + digits(next, 2) + digit(next, 2) + digits(next, 6)

describe('the phone message', () => {
  it('is the exact wording the story asks for', () => {
    expect(messages.invalidPhone).toBe(PHONE_MESSAGE)
  })
})

describe('AC-1: common ways of writing a US number are accepted and stored as 10 digits', () => {
  it.each(['4155550132', '(415) 555-0132', '415.555.0132'])('accepts %j as 4155550132', (raw) => {
    expect(normalisePhone(raw)).toBe('4155550132')
    expect(isValidUsPhone(raw)).toBe(true)
    expect(phoneNumber.safeParse(raw)).toEqual({ success: true, data: '4155550132' })
  })

  it.each(['415-555-0132', '415 555 0132', '(415)555-0132', '  4155550132  '])('also accepts the separator variant %j', (raw) => {
    expect(normalisePhone(raw)).toBe('4155550132')
  })

  it('stores the normalised phone through the registration schema', () => {
    const parsed = registrationInput.safeParse({ fullName: 'Ada Lovelace', email: 'ada@example.com', phone: '(415) 555-0132' })
    expect(parsed.success && parsed.data.phone).toBe('4155550132')
  })

  it('property: every NANP number is accepted in each common format and normalises to its digits', () => {
    const next = prng(8)
    for (let i = 0; i < RUNS; i += 1) {
      const d = nanp(next)
      const [a, b, c] = [d.slice(0, 3), d.slice(3, 6), d.slice(6)]
      for (const written of [d, `(${a}) ${b}-${c}`, `${a}.${b}.${c}`, `${a}-${b}-${c}`]) {
        expect(normalisePhone(written)).toBe(d)
      }
    }
  })

  it('property: normalising is idempotent', () => {
    const next = prng(81)
    for (let i = 0; i < RUNS; i += 1) {
      const d = nanp(next)
      const once = normalisePhone(formatPhoneAsTyped(d))
      expect(once).toBe(d)
      expect(normalisePhone(once as string)).toBe(once)
    }
  })
})

describe('AC-2: anything that is not a 10-digit US number is rejected with the phone message', () => {
  it.each(['abc123', '5550132', '41555501329', '0155550132', '+44 20 7946 0958', '+1 415 555 0132', '1-415-555-0132'])(
    'rejects %j',
    (raw) => {
      expect(normalisePhone(raw)).toBeNull()
      expect(isValidUsPhone(raw)).toBe(false)
      const parsed = phoneNumber.safeParse(raw)
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues).toEqual([expect.objectContaining({ message: PHONE_MESSAGE })])
    },
  )

  it('flags the phone path, and only it, through the registration schema', () => {
    const parsed = registrationInput.safeParse({ fullName: 'Ada Lovelace', email: 'ada@example.com', phone: '+1 415 555 0132' })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([['phone', PHONE_MESSAGE]])
  })

  it.each([
    ['fullwidth digits', '\uff14\uff11\uff15\uff15\uff15\uff15\uff10\uff11\uff13\uff12'],
    ['a right-to-left override', '\u202e4155550132'],
    ['a zero-width space', '415\u200b5550132'],
    ['a control character', '415\u00005550132'],
    ['a slash separator', '415/555/0132'],
    ['an extension', '4155550132 x12'],
  ])('rejects a number carrying %s', (_case, raw) => {
    expect(normalisePhone(raw)).toBeNull()
  })

  it('rejects a phone that is not a string with the phone message', () => {
    const parsed = phoneNumber.safeParse(4155550132)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(PHONE_MESSAGE)
  })

  it('asks for the phone when it is blank', () => {
    for (const blank of ['', '   ']) {
      const parsed = phoneNumber.safeParse(blank)
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues[0]?.message).toBe(messages.required('Phone number'))
    }
  })

  it('property: digit counts other than 10 are rejected however they are written', () => {
    const next = prng(82)
    for (let i = 0; i < RUNS; i += 1) {
      let n = Math.floor(next() * 16)
      if (n === 10) n = 11
      expect(normalisePhone(digits(next, n))).toBeNull()
    }
  })

  it('property: a leading + or a letter anywhere is rejected', () => {
    const next = prng(83)
    for (let i = 0; i < RUNS; i += 1) {
      const d = nanp(next)
      const at = Math.floor(next() * (d.length + 1))
      const letter = String.fromCharCode(97 + Math.floor(next() * 26))
      expect(normalisePhone(`+${d}`)).toBeNull()
      expect(normalisePhone(d.slice(0, at) + letter + d.slice(at))).toBeNull()
    }
  })
})

describe('AC-3: an area code or exchange starting with 0 or 1 is rejected', () => {
  it.each(['4150550132', '4151550132', '1155550132', '0155550132', '(015) 555-0132', '415.155.0132'])('rejects %j', (raw) => {
    expect(normalisePhone(raw)).toBeNull()
    expect(phoneNumber.safeParse(raw).error?.issues[0]?.message).toBe(PHONE_MESSAGE)
  })

  it('accepts the lowest and highest valid area code and exchange', () => {
    expect(normalisePhone('2002000000')).toBe('2002000000')
    expect(normalisePhone('9999999999')).toBe('9999999999')
  })

  it('property: a 0 or 1 at the start of the area code or the exchange is always rejected', () => {
    const next = prng(3)
    for (let i = 0; i < RUNS; i += 1) {
      const d = nanp(next)
      const bad = String(Math.floor(next() * 2))
      const at = next() < 0.5 ? 0 : 3
      expect(normalisePhone(d.slice(0, at) + bad + d.slice(at + 1))).toBeNull()
    }
  })
})

describe('AC-4: the number is formatted as it is typed', () => {
  it('shows (415) 555-0132 once 4155550132 is typed', () => {
    expect(formatPhoneAsTyped('4155550132')).toBe('(415) 555-0132')
  })

  it('formats each prefix as it is typed, keystroke by keystroke', () => {
    const typed = '4155550132'
    const shown = Array.from(typed, (_c, i) => formatPhoneAsTyped(typed.slice(0, i + 1)))
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

  it('reformats a value that is typed into an already formatted field', () => {
    expect(formatPhoneAsTyped('(415) 555-013' + '2')).toBe('(415) 555-0132')
  })

  it('leaves a value starting with 1 unformatted', () => {
    expect(formatPhoneAsTyped('14155550132')).toBe('14155550132')
    const typed = '14155550132'
    for (let i = 1; i <= typed.length; i += 1) {
      expect(formatPhoneAsTyped(typed.slice(0, i))).toBe(typed.slice(0, i))
    }
  })

  it('leaves more than ten digits unformatted', () => {
    expect(formatPhoneAsTyped('41555501329')).toBe('41555501329')
  })

  it('shows nothing for an empty field', () => {
    expect(formatPhoneAsTyped('')).toBe('')
  })

  it('property: formatting keeps exactly the digits and is idempotent', () => {
    const next = prng(4)
    for (let i = 0; i < RUNS; i += 1) {
      const d = digits(next, Math.floor(next() * 14))
      const shown = formatPhoneAsTyped(d)
      expect(phoneDigits(shown)).toBe(d)
      expect(formatPhoneAsTyped(shown)).toBe(shown)
    }
  })
})

describe('AC-5: non-digits produce no character', () => {
  it('drops +, letters and other non-digits as they are typed', () => {
    expect(phoneDigits('+abc415')).toBe('415')
    expect(formatPhoneAsTyped('+abc415')).toBe('415')
  })

  it('keeps only the digits of a pasted number, unformatted when it starts with 1', () => {
    expect(phoneDigits('+1 (415) 555-0132')).toBe('14155550132')
    expect(formatPhoneAsTyped('+1 (415) 555-0132')).toBe('14155550132')
  })

  it('drops non-ASCII digits and invisible characters too', () => {
    expect(phoneDigits('\uff141\u202e5\u200b5')).toBe('155')
  })

  it('property: what remains is only ASCII digits, in order', () => {
    const next = prng(5)
    const alphabet = '0123456789+-(). abcxyz#*\u00a0\u202e'
    for (let i = 0; i < RUNS; i += 1) {
      const raw = Array.from({ length: Math.floor(next() * 20) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('')
      expect(phoneDigits(raw)).toBe(raw.replace(/[^0-9]/g, ''))
      expect(formatPhoneAsTyped(raw)).toMatch(/^[0-9() -]*$/)
    }
  })
})

describe('AC-6: Backspace in the middle removes that digit and keeps the cursor in place', () => {
  it('removes the 5 before the cursor placed after "555" and leaves the cursor where it was', () => {
    const shown = '(415) 555-0132'
    const caret = shown.indexOf('555') + 3
    const after = backspacePhone(shown, caret)
    expect(phoneDigits(after.value)).toBe('415550132')
    expect(after.value).toBe('(415) 550-132')
    expect(after.caret).toBe(caret - 1)
    expect(phoneDigitsBefore(after.value, after.caret)).toBe(5)
  })

  it('skips back over a separator to the digit before it', () => {
    const after = backspacePhone('(415) 555-0132', '(415) 555-'.length)
    expect(phoneDigits(after.value)).toBe('415550132')
    expect(phoneDigitsBefore(after.value, after.caret)).toBe(5)
  })

  it('does nothing with the cursor at the start or before any digit', () => {
    expect(backspacePhone('(415) 555-0132', 0)).toEqual({ value: '(415) 555-0132', caret: 0 })
    expect(backspacePhone('(415) 555-0132', 1)).toEqual({ value: '(415) 555-0132', caret: 1 })
  })

  it('removes the last digit at the end of the field', () => {
    expect(backspacePhone('(415) 555-0132', 14)).toEqual({ value: '(415) 555-013', caret: 13 })
  })

  it('clamps a cursor beyond either end of the value', () => {
    expect(backspacePhone('415', 99)).toEqual({ value: '41', caret: 2 })
    expect(backspacePhone('415', -3)).toEqual({ value: '415', caret: 0 })
  })

  it('maps between digit counts and cursor positions', () => {
    expect(phoneCaretAfterDigits('(415) 555-0132', 0)).toBe(0)
    expect(phoneCaretAfterDigits('(415) 555-0132', 3)).toBe(4)
    expect(phoneCaretAfterDigits('(415) 555-0132', 6)).toBe(9)
    expect(phoneCaretAfterDigits('(415) 555-0132', 10)).toBe(14)
    expect(phoneCaretAfterDigits('(415) 555-0132', 42)).toBe(14)
    expect(phoneDigitsBefore('(415) 555-0132', 9)).toBe(6)
    expect(phoneDigitsBefore('(415) 555-0132', 99)).toBe(10)
  })

  it('property: Backspace removes exactly one digit and the cursor follows the digits before it', () => {
    const next = prng(6)
    for (let i = 0; i < RUNS; i += 1) {
      const d = digits(next, 1 + Math.floor(next() * 11))
      const shown = formatPhoneAsTyped(d)
      const caret = Math.floor(next() * (shown.length + 1))
      const before = phoneDigitsBefore(shown, caret)
      const after = backspacePhone(shown, caret)
      if (before === 0) {
        expect(after).toEqual({ value: shown, caret })
        continue
      }
      expect(phoneDigits(after.value)).toBe(d.slice(0, before - 1) + d.slice(before))
      expect(after.value).toBe(formatPhoneAsTyped(after.value))
      expect(phoneDigitsBefore(after.value, after.caret)).toBe(before - 1)
    }
  })
})
