import { describe, expect, it } from 'vitest'
import { characterCount, NAME_MAX, nameMessages, validateRegistration } from './rules.js'

// ST-10: real names are accepted as written, with a 100-character limit per name field.
const VALID = { firstName: 'Siobhan', lastName: "O'Brien", email: 'siobhan@example.com', phone: '(212) 555-0142' }

const name = (length: number, char = 'a'): string => char.repeat(length)

describe('real-world names are accepted as written @story:ST-10 @criterion:AC-1', () => {
  it.each([
    ['Siobhan', "O'Brien"],
    ['Anne-Marie', 'Dupont'],
    ['José', 'Anne-Marie'],
    ["O'Brien", 'José'],
  ])('accepts first name %s and last name %s unchanged', (firstName, lastName) => {
    const result = validateRegistration({ ...VALID, firstName, lastName })
    expect(result).toEqual({ ok: true, value: { ...VALID, firstName, lastName } })
  })

  it('accepts a decomposed accent (e + combining acute) and keeps it byte-for-byte', () => {
    const decomposed = 'José'
    const result = validateRegistration({ ...VALID, firstName: decomposed })
    expect(result.ok && result.value.firstName).toBe(decomposed)
  })

  it('trims surrounding whitespace before storing, and trimming is idempotent', () => {
    const first = validateRegistration({ ...VALID, firstName: '  José  ', lastName: '\tAnne-Marie\n' })
    expect(first).toEqual({ ok: true, value: { ...VALID, firstName: 'José', lastName: 'Anne-Marie' } })
    if (!first.ok) throw new Error('expected acceptance')
    expect(validateRegistration(first.value)).toEqual(first)
  })
})

describe('the 100-character limit @story:ST-10 @criterion:AC-2 @criterion:AC-3', () => {
  it('limits each name to 100 characters', () => {
    expect(NAME_MAX).toBe(100)
  })

  it.each(['firstName', 'lastName'] as const)('accepts a %s of exactly 100 characters', (field) => {
    const result = validateRegistration({ ...VALID, [field]: name(100) })
    expect(result.ok).toBe(true)
  })

  it.each([
    ['firstName', 'First name must be 100 characters or fewer.'],
    ['lastName', 'Last name must be 100 characters or fewer.'],
  ] as const)('rejects a %s of 101 characters with "%s" against that field only', (field, message) => {
    expect(validateRegistration({ ...VALID, [field]: name(101) })).toEqual({
      ok: false,
      fields: [{ path: field, message }],
    })
  })

  it('reports both names when both are too long, first name first', () => {
    expect(validateRegistration({ ...VALID, firstName: name(101), lastName: name(150) })).toEqual({
      ok: false,
      fields: [
        { path: 'firstName', message: nameMessages.firstName.tooLong },
        { path: 'lastName', message: nameMessages.lastName.tooLong },
      ],
    })
  })

  it('holds the boundary at every length from 1 to 130, for both fields', () => {
    for (let length = 1; length <= 130; length += 1) {
      for (const field of ['firstName', 'lastName'] as const) {
        expect(validateRegistration({ ...VALID, [field]: name(length) }).ok, `${field} of ${length}`).toBe(length <= NAME_MAX)
      }
    }
  })

  it('counts characters, not UTF-16 code units: 100 accented letters or emoji pass, 101 do not', () => {
    for (const char of ['é', '😀', '中']) {
      expect(characterCount(name(100, char))).toBe(100)
      expect(validateRegistration({ ...VALID, lastName: name(100, char) }).ok).toBe(true)
      expect(validateRegistration({ ...VALID, lastName: name(101, char) }).ok).toBe(false)
    }
  })

  it('measures after trimming: 100 characters padded with spaces are accepted, stored trimmed', () => {
    const result = validateRegistration({ ...VALID, firstName: `  ${name(100)}  ` })
    expect(result).toEqual({ ok: true, value: { ...VALID, firstName: name(100) } })
  })
})

describe('the rest of the body is checked without echoing it @story:ST-10 @criterion:AC-6', () => {
  it.each([
    [{ ...VALID, firstName: '   ' }, [{ path: 'firstName', message: 'First name is required.' }]],
    [{ ...VALID, lastName: '' }, [{ path: 'lastName', message: 'Last name is required.' }]],
    [{ ...VALID, firstName: 42 }, [{ path: 'firstName', message: 'First name is required.' }]],
    [{ ...VALID, email: 'not-an-email' }, [{ path: 'email', message: 'Enter a valid email address.' }]],
    [{ ...VALID, phone: '12' }, [{ path: 'phone', message: 'Enter a valid phone number.' }]],
  ])('flags %j', (body, fields) => {
    expect(validateRegistration(body)).toEqual({ ok: false, fields })
  })

  it('flags every missing field when the body is empty', () => {
    const result = validateRegistration({})
    expect(result.ok).toBe(false)
    expect(!result.ok && result.fields.map((f) => f.path)).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it.each([null, 'text', 7, ['a']])('flags a body that is not an object (%j)', (body) => {
    const result = validateRegistration(body)
    expect(result.ok).toBe(false)
  })

  it('refuses an unknown field rather than silently dropping it', () => {
    expect(validateRegistration({ ...VALID, id: 'x' })).toEqual({
      ok: false,
      fields: [{ path: '', message: 'The request contains a field that is not accepted.' }],
    })
  })

  it('keeps the limit at 254/255 for email and accepts NANP phone numbers', () => {
    const local = name(64)
    const email254 = `${local}@${name(63, 'b')}.${name(63, 'c')}.${name(58, 'd')}.io`
    expect(email254.length).toBe(254)
    expect(validateRegistration({ ...VALID, email: email254 }).ok).toBe(true)
    expect(validateRegistration({ ...VALID, email: `a${email254}` }).ok).toBe(false)
    for (const phone of ['2125550142', '212-555-0142', '+1 212 555 0142', '1 (212) 555.0142']) {
      expect(validateRegistration({ ...VALID, phone }).ok, phone).toBe(true)
    }
    for (const phone of ['112-555-0142', '212-155-0142', '+44 20 7946 0958', '212555014']) {
      expect(validateRegistration({ ...VALID, phone }).ok, phone).toBe(false)
    }
  })

  it('never puts a submitted value into a message', () => {
    const sentinel = 'SENTINEL-st10'
    const result = validateRegistration({
      firstName: `${sentinel}${name(120)}`,
      lastName: `${sentinel}${name(120)}`,
      email: sentinel,
      phone: sentinel,
      [sentinel]: sentinel,
    })
    expect(JSON.stringify(result)).not.toContain(sentinel)
  })
})
