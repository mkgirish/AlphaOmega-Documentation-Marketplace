import { describe, expect, it } from 'vitest'
import { PHONE_MESSAGE, normalisePhone } from './phone.js'

// ST-8: the one US phone rule the API applies. A value is accepted only when, after
// dropping spaces, dots, dashes and brackets, it is exactly ten NANP digits.
describe('normalisePhone @story:ST-8', () => {
  it.each(['4155550132', '(415) 555-0132', '415.555.0132'])('accepts %j and stores 4155550132 @criterion:AC-1', (raw) => {
    expect(normalisePhone(raw)).toBe('4155550132')
  })

  it.each(['abc123', '5550132', '41555501329', '0155550132', '+44 20 7946 0958', '+1 415 555 0132', '1-415-555-0132'])(
    'rejects %j @criterion:AC-2',
    (raw) => {
      expect(normalisePhone(raw)).toBeNull()
    },
  )

  it.each(['4150550132', '4151550132', '1155550132', '0155550132'])(
    'rejects %j: area code or exchange starting with 0 or 1 @criterion:AC-3',
    (raw) => {
      expect(normalisePhone(raw)).toBeNull()
    },
  )

  it.each([
    '',
    '   ',
    '415 555 013a',
    '４１５５５５０１３２',
    '415\u202e5550132',
    '415\u00005550132',
    '415/555/0132',
    '415_555_0132',
    '(415) 555-0132 ext 1',
  ])('rejects %j: no other characters are dropped', (raw) => {
    expect(normalisePhone(raw)).toBeNull()
  })

  it('accepts every NANP area code and exchange shape and rejects every 0/1 lead (property)', () => {
    for (let area = 0; area < 1000; area += 7) {
      for (const exchange of [0, 100, 199, 200, 555, 999]) {
        const digits = `${String(area).padStart(3, '0')}${String(exchange).padStart(3, '0')}0132`
        const valid = area >= 200 && exchange >= 200
        expect(normalisePhone(digits)).toBe(valid ? digits : null)
        const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
        expect(normalisePhone(formatted)).toBe(valid ? digits : null)
        expect(normalisePhone(`1${digits}`)).toBeNull()
      }
    }
  })

  it('is idempotent on what it accepts', () => {
    const once = normalisePhone(' (212) 555-0199 ')
    expect(once).toBe('2125550199')
    expect(normalisePhone(once ?? '')).toBe(once)
  })

  it('carries the exact message the story specifies @criterion:AC-2', () => {
    expect(PHONE_MESSAGE).toBe('Enter a 10-digit US number without +1, e.g. (415) 555-0132.')
  })
})
