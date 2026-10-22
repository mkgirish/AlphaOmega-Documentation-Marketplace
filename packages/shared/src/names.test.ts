// ST-10 — the visitor's first and last name rules (CMP-2): real-world names accepted as
// written, a hard limit of 100 characters, and the same messages for the screen and the API.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NAME_MAX_LENGTH, characterCount, errorEnvelope, firstName, lastName, messages, nameError, visitorName } from './index.js'

const repeat = (n: number, ch = 'a') => ch.repeat(n)

/** A small seeded generator (mulberry32) so the property tests are repeatable without a dependency. */
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

const alphabet = ['a', 'Z', "'", '-', 'é', 'ñ', 'Ø', 'ß', ' ', '\t', 'José', 'Anne-Marie', "O'Brien", '𝒜', '字']

function randomName(next: () => number, maxPieces: number): string {
  const pieces = Math.floor(next() * maxPieces)
  let out = ''
  for (let i = 0; i < pieces; i++) out += alphabet[Math.floor(next() * alphabet.length)]
  return out
}

describe('name messages (ST-10 AC-3)', () => {
  it('words the over-long messages exactly as the story does', () => {
    expect(messages.firstNameTooLong).toBe('First name must be 100 characters or fewer.')
    expect(messages.lastNameTooLong).toBe('Last name must be 100 characters or fewer.')
  })

  it('words the required messages from the shared template and uses them for blank names', () => {
    expect(messages.required('First name')).toBe('First name is required.')
    expect(messages.required('Last name')).toBe('Last name is required.')
    expect(nameError('firstName', '')).toBe(messages.required('First name'))
    expect(nameError('lastName', '')).toBe(messages.required('Last name'))
  })

  it('sets the limit at 100 characters', () => {
    expect(NAME_MAX_LENGTH).toBe(100)
  })
})

describe('real-world names are accepted as written (ST-10 AC-1)', () => {
  it.each([
    ['Siobhan', "O'Brien"],
    ['Anne-Marie', 'Dupont'],
    ['José', 'Anne-Marie'],
    ["O'Brien", 'José'],
  ])('accepts first %j and last %j and keeps them exactly', (first, last) => {
    const parsed = visitorName.safeParse({ firstName: first, lastName: last })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ firstName: first, lastName: last })
  })

  it.each(["O'Brien", 'Anne-Marie', 'José', 'Zoë', 'Łukasz', 'Nguyễn', '李', 'Mary Jane'])('%j is valid for either name field', (name) => {
    expect(firstName.parse(name)).toBe(name)
    expect(lastName.parse(name)).toBe(name)
    expect(nameError('firstName', name)).toBeUndefined()
    expect(nameError('lastName', name)).toBeUndefined()
  })

  it('keeps a decomposed accent exactly as entered (no Unicode re-normalisation)', () => {
    const decomposed = 'Jose\u0301'
    expect(firstName.parse(decomposed)).toBe(decomposed)
  })

  it('trims surrounding whitespace but keeps the inside exactly as entered', () => {
    expect(firstName.parse("  O'Brien  ")).toBe("O'Brien")
    expect(lastName.parse('Anne-Marie\t')).toBe('Anne-Marie')
    expect(visitorName.parse({ firstName: ' José ', lastName: 'Mary   Jane' })).toEqual({ firstName: 'José', lastName: 'Mary   Jane' })
  })
})

describe('the 100/101 boundary (ST-10 AC-2, AC-3, AC-6)', () => {
  it.each([1, 99, 100])('accepts a first or last name of %i characters', (n) => {
    const name = repeat(n)
    expect(visitorName.safeParse({ firstName: name, lastName: name }).success).toBe(true)
    expect(nameError('firstName', name)).toBeUndefined()
    expect(nameError('lastName', name)).toBeUndefined()
  })

  it.each([101, 102, 500])('rejects a first name of %i characters with the first-name message, under firstName', (n) => {
    const parsed = visitorName.safeParse({ firstName: repeat(n), lastName: 'Dupont' })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({ path: ['firstName'], message: 'First name must be 100 characters or fewer.' }),
    ])
  })

  it.each([101, 102, 500])('rejects a last name of %i characters with the last-name message, under lastName', (n) => {
    const parsed = visitorName.safeParse({ firstName: 'Siobhan', lastName: repeat(n) })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({ path: ['lastName'], message: 'Last name must be 100 characters or fewer.' }),
    ])
  })

  it('flags both fields at once, each with its own message', () => {
    const parsed = visitorName.safeParse({ firstName: repeat(101), lastName: repeat(101) })
    expect(parsed.success).toBe(false)
    const byPath = Object.fromEntries((parsed.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]))
    expect(byPath).toEqual({ firstName: messages.firstNameTooLong, lastName: messages.lastNameTooLong })
  })

  it('does not echo the submitted value in the message', () => {
    const sentinel = 'SENTINEL' + repeat(100)
    const parsed = visitorName.safeParse({ firstName: sentinel, lastName: sentinel })
    expect(parsed.success).toBe(false)
    for (const issue of parsed.error?.issues ?? []) expect(issue.message).not.toContain('SENTINEL')
  })

  it('counts characters, not UTF-16 code units: 100 astral characters fit, 101 do not', () => {
    expect(characterCount('𝒜𝒜')).toBe(2)
    expect(nameError('firstName', repeat(100, '𝒜'))).toBeUndefined()
    expect(nameError('firstName', repeat(101, '𝒜'))).toBe(messages.firstNameTooLong)
  })

  it('counts accented letters as one character each', () => {
    expect(nameError('lastName', repeat(100, 'é'))).toBeUndefined()
    expect(nameError('lastName', repeat(101, 'é'))).toBe(messages.lastNameTooLong)
  })

  it('measures the length after trimming, as the value would be stored', () => {
    expect(nameError('firstName', `  ${repeat(100)}  `)).toBeUndefined()
    expect(firstName.parse(`  ${repeat(100)}  `)).toBe(repeat(100))
  })
})

describe('nameError — the per-field check the screen re-runs as the visitor edits (ST-10 AC-5)', () => {
  it('clears once a flagged name is shortened to 100 characters', () => {
    const tooLong = repeat(101)
    expect(nameError('firstName', tooLong)).toBe('First name must be 100 characters or fewer.')
    expect(nameError('firstName', tooLong.slice(0, -1))).toBeUndefined()
    expect(nameError('lastName', tooLong)).toBe('Last name must be 100 characters or fewer.')
    expect(nameError('lastName', tooLong.slice(0, -1))).toBeUndefined()
  })

  it('reports a blank name as required', () => {
    expect(nameError('firstName', '')).toBe('First name is required.')
    expect(nameError('lastName', '   ')).toBe('Last name is required.')
    for (const blank of ['\t\n', '\u00a0', '\u3000 ']) expect(nameError('firstName', blank)).toBe('First name is required.')
  })

  it('agrees with the schema the API parses', () => {
    expect(firstName.safeParse('').error?.issues[0]?.message).toBe('First name is required.')
    expect(lastName.safeParse(repeat(101)).error?.issues[0]?.message).toBe('Last name must be 100 characters or fewer.')
  })
})

describe('the name object as a JSON body would carry it (ST-10 AC-6)', () => {
  it('maps an over-long lastName onto an AD-5 field error that names the field and not the value', () => {
    const sentinel = 'SENTINEL' + repeat(93)
    const parsed = visitorName.safeParse({ firstName: 'Siobhan', lastName: sentinel })
    const fields = (parsed.error?.issues ?? []).map((i) => ({ path: i.path.join('.'), message: i.message }))
    const body = errorEnvelope('Request failed.', fields)
    expect(body).toEqual({ error: { message: 'Request failed.', fields: [{ path: 'lastName', message: messages.lastNameTooLong }] } })
    expect(JSON.stringify(body)).not.toContain('SENTINEL')
  })

  it('rejects a missing or non-string name under that field', () => {
    const missing = visitorName.safeParse({ firstName: 'Siobhan' })
    expect(missing.error?.issues.map((i) => i.path)).toEqual([['lastName']])
    expect(missing.error?.issues[0]?.message).toBe('Last name is required.')
    const wrongType = visitorName.safeParse({ firstName: 42, lastName: 'Dupont' })
    expect(wrongType.error?.issues.map((i) => i.path)).toEqual([['firstName']])
    expect(wrongType.error?.issues[0]?.message).toBe('First name is required.')
  })
})

describe('name rule properties', () => {
  it('accepts exactly the names of 1 to 100 characters once trimmed', () => {
    const next = rng(10)
    for (let i = 0; i < 500; i++) {
      const value = randomName(next, 140)
      const stored = value.trim()
      const count = characterCount(stored)
      const expected = count === 0 ? messages.required('First name') : count > NAME_MAX_LENGTH ? messages.firstNameTooLong : undefined
      expect(nameError('firstName', value)).toBe(expected)
      expect(firstName.safeParse(value).success).toBe(expected === undefined)
    }
  })

  it('is idempotent: an accepted name parses to itself', () => {
    const next = rng(42)
    for (let i = 0; i < 500; i++) {
      const parsed = lastName.safeParse(randomName(next, 60))
      if (parsed.success) expect(lastName.parse(parsed.data)).toBe(parsed.data)
    }
  })

  it('trimming is idempotent and is what the schema stores', () => {
    const next = rng(7)
    for (let i = 0; i < 500; i++) {
      const raw = randomName(next, 30)
      const once = raw.trim()
      expect(once.trim()).toBe(once)
      const parsed = firstName.safeParse(raw)
      expect(parsed.success ? parsed.data : once).toBe(once)
    }
  })
})

describe('AD-3 guard — the name rule lives only in packages/shared', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))

  function sources(dir: string): string[] {
    let out: string[] = []
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) out = out.concat(sources(path))
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path)
    }
    return out
  }

  it('no other package defines the name-length message', () => {
    expect([messages.firstNameTooLong, messages.lastNameTooLong].every((m) => /characters or fewer/.test(m))).toBe(true)
    const offenders = ['api', 'web']
      .flatMap((pkg) => sources(join(root, pkg, 'src')))
      .filter((file) => /characters or fewer/.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
