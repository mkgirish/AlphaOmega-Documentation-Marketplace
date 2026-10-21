// ST-10 — the shared name rules: real-world names accepted as written, a clear 100-character
// limit, and the same messages for the screen (CMP-1) and the API (CMP-3).
import { describe, expect, it } from 'vitest'
import { NAME_MAX_LENGTH, firstName, lastName, messages, nameFields, nameLength, normalise, toFieldErrors } from './index.js'

const repeat = (n: number, char = 'a') => char.repeat(n)

/** A small deterministic generator so the property tests are reproducible. */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const alphabet = ['a', 'Z', 'é', 'ñ', 'ø', "'", '-', ' ', '\t', 'Ł', 'ß', 'ç', ' ', '漢']

function randomName(rand: () => number, maxLength: number): string {
  const length = Math.floor(rand() * (maxLength + 1))
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(rand() * alphabet.length)]
  return out
}

describe('name messages (ST-10 AC-3)', () => {
  it.each([
    ['firstNameTooLong', 'First name must be 100 characters or fewer.'],
    ['lastNameTooLong', 'Last name must be 100 characters or fewer.'],
  ] as const)('messages.%s is %j', (key, text) => {
    expect(messages[key]).toBe(text)
  })

  it('caps names at 100 characters', () => {
    expect(NAME_MAX_LENGTH).toBe(100)
  })
})

describe('real-world names are accepted as written (ST-10 AC-1)', () => {
  it.each(["O'Brien", 'Anne-Marie', 'José', 'Siobhan', 'Dupont', 'Zoë', 'Nguyễn', "D'Angelo-Smith", 'Mary Ann'])(
    '%j is accepted as first and last name, unchanged',
    (name) => {
      expect(firstName.safeParse(name)).toEqual({ success: true, data: name })
      expect(lastName.safeParse(name)).toEqual({ success: true, data: name })
    },
  )

  it.each([
    ['Siobhan', "O'Brien"],
    ['Anne-Marie', 'Dupont'],
    ['José', 'Anne-Marie'],
  ])('the pair %j / %j passes the shared name fields unchanged', (first, last) => {
    expect(nameFields.safeParse({ firstName: first, lastName: last })).toEqual({
      success: true,
      data: { firstName: first, lastName: last },
    })
  })

  it('keeps a decomposed accent exactly as entered (no Unicode rewriting)', () => {
    const decomposed = 'Jose\u0301'
    expect(firstName.parse(decomposed)).toBe(decomposed)
    expect(firstName.parse(decomposed)).not.toBe(decomposed.normalize('NFC'))
  })

  it('stores the trimmed value', () => {
    expect(lastName.parse("  O'Brien  ")).toBe("O'Brien")
    expect(firstName.parse('Anne   Marie')).toBe('Anne Marie')
  })
})

describe('the 100/101 boundary (ST-10 AC-2, AC-3, AC-6)', () => {
  it.each([1, 2, 99, 100])('a first or last name of %i characters is accepted', (n) => {
    expect(firstName.safeParse(repeat(n)).success).toBe(true)
    expect(lastName.safeParse(repeat(n)).success).toBe(true)
  })

  it.each([101, 102, 500])('a first name of %i characters is rejected with the first-name message', (n) => {
    const parsed = firstName.safeParse(repeat(n))
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual(['First name must be 100 characters or fewer.'])
  })

  it.each([101, 102, 500])('a last name of %i characters is rejected with the last-name message', (n) => {
    const parsed = lastName.safeParse(repeat(n))
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual(['Last name must be 100 characters or fewer.'])
  })

  it('counts characters, not UTF-16 code units: 100 astral or accented characters are accepted', () => {
    expect(lastName.safeParse(repeat(100, 'é')).success).toBe(true)
    expect(lastName.safeParse(repeat(100, '𝒜')).success).toBe(true)
    expect(lastName.safeParse(repeat(101, '𝒜')).success).toBe(false)
  })

  it('measures after trimming, so surrounding spaces never push a name over the limit', () => {
    expect(firstName.parse(`  ${repeat(100)}  `)).toBe(repeat(100))
    expect(firstName.safeParse(` ${repeat(101)} `).success).toBe(false)
  })

  it('nameLength counts code points', () => {
    expect(nameLength('José')).toBe(4)
    expect(nameLength('𝒜𝒜')).toBe(2)
    expect(nameLength('')).toBe(0)
  })
})

describe('required names', () => {
  it.each(['', '   ', '\t\n'])('%j is rejected as missing', (blank) => {
    expect(firstName.safeParse(blank).error?.issues.map((issue) => issue.message)).toEqual(['First name is required.'])
    expect(lastName.safeParse(blank).error?.issues.map((issue) => issue.message)).toEqual(['Last name is required.'])
  })

  it.each([undefined, null, 42, {}])('a non-string %j is rejected', (value) => {
    expect(firstName.safeParse(value).success).toBe(false)
  })
})

describe('field errors for the AD-5 envelope (ST-10 AC-3, AC-6)', () => {
  it('maps an over-long lastName to one error on the lastName path', () => {
    const parsed = nameFields.safeParse({ firstName: 'Siobhan', lastName: repeat(101) })
    expect(parsed.success).toBe(false)
    expect(toFieldErrors(parsed.error!)).toEqual([{ path: 'lastName', message: 'Last name must be 100 characters or fewer.' }])
  })

  it('maps both over-long names to their own fields, in field order', () => {
    const parsed = nameFields.safeParse({ firstName: repeat(101), lastName: repeat(101) })
    expect(toFieldErrors(parsed.error!)).toEqual([
      { path: 'firstName', message: 'First name must be 100 characters or fewer.' },
      { path: 'lastName', message: 'Last name must be 100 characters or fewer.' },
    ])
  })

  it('never echoes the submitted value in a field error', () => {
    const sentinel = `SENTINEL${repeat(100, 'x')}`
    const parsed = nameFields.safeParse({ firstName: sentinel, lastName: sentinel })
    expect(JSON.stringify(toFieldErrors(parsed.error!))).not.toContain('SENTINEL')
  })

  it('keeps only the first message per field', () => {
    const parsed = nameFields.safeParse({ firstName: 7, lastName: '' })
    const errors = toFieldErrors(parsed.error!)
    expect(errors.map((error) => error.path)).toEqual(['firstName', 'lastName'])
  })

  it('reports a top-level issue on an empty path', () => {
    const parsed = nameFields.safeParse('not an object')
    expect(toFieldErrors(parsed.error!)).toEqual([{ path: '', message: expect.any(String) }])
  })
})

describe('name rule properties', () => {
  const rand = seeded(10)
  const samples = Array.from({ length: 400 }, () => randomName(rand, 130))

  it('normalising is idempotent', () => {
    for (const sample of samples) expect(normalise(normalise(sample))).toBe(normalise(sample))
  })

  it('a parsed name parses again to itself (trim idempotence)', () => {
    for (const sample of samples) {
      const parsed = firstName.safeParse(sample)
      if (parsed.success) expect(firstName.parse(parsed.data)).toBe(parsed.data)
    }
  })

  it('a name is accepted exactly when its normalised form is 1 to 100 characters', () => {
    for (const sample of samples) {
      const length = nameLength(normalise(sample))
      expect(lastName.safeParse(sample).success).toBe(length >= 1 && length <= NAME_MAX_LENGTH)
    }
  })

  it('apostrophes, hyphens and accents never cause a rejection under the limit', () => {
    const marks = ["'", '-', 'é', 'ü', 'ñ', 'ç', 'ø']
    for (let i = 0; i < 200; i += 1) {
      const length = 1 + Math.floor(rand() * NAME_MAX_LENGTH)
      let name = 'A'
      while (name.length < length) name += marks[Math.floor(rand() * marks.length)]
      expect(firstName.safeParse(name)).toEqual({ success: true, data: name })
    }
  })
})
