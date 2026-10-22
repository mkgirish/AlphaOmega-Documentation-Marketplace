import { describe, expect, it } from 'vitest'
import { NAME_MAX, nameTooLong, parseRegistration } from './rules.js'

// ST-10 — the API's name rules: real-world names pass exactly as written, and a first or
// last name is held to NAME_MAX characters, with a message naming the field.
const valid = { firstName: 'Siobhan', lastName: "O'Brien", email: 'visitor@example.com', phone: '(415) 555-0132' }

describe('real-world names are accepted as written @story:ST-10 @criterion:AC-1', () => {
  it.each([
    ['Siobhan', "O'Brien"],
    ['Anne-Marie', 'Dupont'],
    ['José', 'Anne-Marie'],
    ["O'Brien", 'José'],
  ])('accepts "%s" "%s" and keeps them unchanged', (firstName, lastName) => {
    const result = parseRegistration({ ...valid, firstName, lastName })
    expect(result).toEqual({ ok: true, value: { ...valid, firstName, lastName } })
  })

  it('accepts a decomposed accent (e + combining acute) unchanged', () => {
    const jose = 'Jose\u0301'
    const result = parseRegistration({ ...valid, firstName: jose })
    expect(result.ok && result.value.firstName).toBe(jose)
  })

  it('trims surrounding whitespace before storing', () => {
    const result = parseRegistration({ ...valid, firstName: '  Anne-Marie  ', lastName: "\tO'Brien\n" })
    expect(result.ok && [result.value.firstName, result.value.lastName]).toEqual(['Anne-Marie', "O'Brien"])
  })
})

describe('a name of exactly 100 characters is accepted @story:ST-10 @criterion:AC-2', () => {
  it('holds names to 100 characters', () => {
    expect(NAME_MAX).toBe(100)
  })

  it.each(['firstName', 'lastName'] as const)('accepts a %s of exactly 100 characters', (field) => {
    const name = 'a'.repeat(100)
    const result = parseRegistration({ ...valid, [field]: name })
    expect(result.ok && result.value[field]).toBe(name)
  })

  it('counts an accented character once, so 100 é is accepted', () => {
    const result = parseRegistration({ ...valid, lastName: 'é'.repeat(100) })
    expect(result.ok).toBe(true)
  })

  it('measures the trimmed name, so 100 characters wrapped in spaces are accepted', () => {
    const result = parseRegistration({ ...valid, lastName: ` ${'a'.repeat(100)} ` })
    expect(result.ok && result.value.lastName).toBe('a'.repeat(100))
  })
})

describe('a name of 101 characters is rejected with its field message @story:ST-10 @criterion:AC-3 @criterion:AC-6', () => {
  it('words the messages exactly as the story does', () => {
    expect(nameTooLong.firstName).toBe('First name must be 100 characters or fewer.')
    expect(nameTooLong.lastName).toBe('Last name must be 100 characters or fewer.')
  })

  it.each([
    ['firstName', 'First name must be 100 characters or fewer.'],
    ['lastName', 'Last name must be 100 characters or fewer.'],
  ] as const)('rejects a %s of 101 characters with only that field flagged', (field, message) => {
    const result = parseRegistration({ ...valid, [field]: 'a'.repeat(101) })
    expect(result).toEqual({ ok: false, fields: [{ path: field, message }] })
  })

  it('flags both names when both are too long, first name first', () => {
    const result = parseRegistration({ ...valid, firstName: 'a'.repeat(101), lastName: 'b'.repeat(250) })
    expect(result).toEqual({
      ok: false,
      fields: [
        { path: 'firstName', message: 'First name must be 100 characters or fewer.' },
        { path: 'lastName', message: 'Last name must be 100 characters or fewer.' },
      ],
    })
  })

  it('counts code points, so 101 accented characters are rejected', () => {
    const result = parseRegistration({ ...valid, firstName: 'é'.repeat(101) })
    expect(result.ok).toBe(false)
  })

  it('never puts the submitted value in a message', () => {
    const sentinel = 'SENTINEL'.repeat(13)
    const result = parseRegistration({ ...valid, lastName: sentinel })
    expect(JSON.stringify(result)).not.toContain('SENTINEL')
  })
})

describe('the other fields are still required and checked @story:ST-10 @criterion:AC-6', () => {
  it.each([
    ['firstName', '', 'First name is required.'],
    ['lastName', '   ', 'Last name is required.'],
    ['email', '', 'Email is required.'],
    ['phone', '', 'Phone number is required.'],
    ['firstName', 42, 'First name is required.'],
    ['email', 'not-an-email', 'Enter a valid email address.'],
    ['email', `${'a'.repeat(250)}@x.io`, 'Enter a valid email address.'],
    ['phone', '555-0132', 'Enter a 10-digit US phone number.'],
    ['phone', '(015) 555-0132', 'Enter a 10-digit US phone number.'],
    ['phone', '4+1+5555+0132', 'Enter a 10-digit US phone number.'],
    ['firstName', 'A\u0000B', 'First name contains a character that cannot be used.'],
    ['lastName', 'O\u0007Brien', 'Last name contains a character that cannot be used.'],
    ['lastName', 'O\u202EneirB', 'Last name contains a character that cannot be used.'],
    ['firstName', 'Jos\uD800', 'First name contains a character that cannot be used.'],
    ['firstName', '\uDC00Jo', 'First name contains a character that cannot be used.'],
    ['email', 'a\u0000@x.io', 'Email contains a character that cannot be used.'],
  ])('flags %s = %j', (field, value, message) => {
    expect(parseRegistration({ ...valid, [field]: value })).toEqual({ ok: false, fields: [{ path: field, message }] })
  })

  it.each(['+1 (415) 555-0132', '1-415-555-0132', '415.555.0132', '4155550132'])('accepts the phone number %s', (phone) => {
    expect(parseRegistration({ ...valid, phone }).ok).toBe(true)
  })

  it('accepts a name with an emoji or other astral character, counted once', () => {
    const result = parseRegistration({ ...valid, firstName: '\u{1F600}'.repeat(100) })
    expect(result.ok).toBe(true)
  })

  it('flags a missing field as required', () => {
    const { phone: _phone, ...rest } = valid
    expect(parseRegistration(rest)).toEqual({ ok: false, fields: [{ path: 'phone', message: 'Phone number is required.' }] })
  })

  it.each([null, [], 'text', 7])('rejects a body that is not an object (%j) without field errors', (body) => {
    expect(parseRegistration(body)).toEqual({ ok: false })
  })

  it('rejects an unknown field without field errors', () => {
    expect(parseRegistration({ ...valid, id: 'x' })).toEqual({ ok: false })
  })
})
