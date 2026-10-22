import { describe, expect, it } from 'vitest'
import { EMAIL_MAX, NAME_MAX, PHONE_MESSAGE, clean, cleanPhone, validateRegistration } from './rules.js'

// ST-2 AC-3 and the shared-kernel anchors: trimmed, NFC and separator-free values, the
// 100/101 and 254/255 boundaries, NANP acceptance and control/bidi refusal, table-tested.
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

function fieldsOf(body: unknown): Record<string, string[]> {
  const result = validateRegistration(body)
  if (result.ok) throw new Error('expected a validation failure')
  return result.fields as Record<string, string[]>
}

describe('normalisation @story:ST-2 @criterion:AC-3', () => {
  it('trims, applies NFC and strips phone separators', () => {
    const result = validateRegistration({ ...VALID, firstName: ' Jane ', phone: '(415) 555-0132' })
    expect(result).toEqual({ ok: true, value: VALID })
    expect(clean('  Jose\u0301\t')).toBe('Jos\u00E9')
    expect(cleanPhone(' 415.555.0132 ')).toBe('4155550132')
    expect(cleanPhone('415 - 555 - 0132')).toBe('4155550132')
  })

  it('keeps inner spaces of a name', () => {
    const result = validateRegistration({ ...VALID, firstName: '  Mary Ann  ' })
    expect(result.ok && result.value.firstName).toBe('Mary Ann')
  })

  it('is idempotent for every generated input', () => {
    const pieces = [' ', '\t', '\n', 'a', 'Z', 'e\u0301', '\u00E9', '-', '(', ')', '.', '5', '\u00A0', '\u03A9']
    let seed = 7
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed
    }
    for (let i = 0; i < 500; i += 1) {
      const length = next() % 12
      const value = Array.from({ length }, () => pieces[next() % pieces.length]).join('')
      expect(clean(clean(value))).toBe(clean(value))
      expect(cleanPhone(cleanPhone(value))).toBe(cleanPhone(value))
    }
  })
})

describe('field rules @story:ST-2 @criterion:AC-3', () => {
  it.each([
    ['firstName', 'a'.repeat(NAME_MAX)],
    ['lastName', 'b'.repeat(NAME_MAX)],
    ['firstName', '\u{1F600}'.repeat(NAME_MAX)],
    ['firstName', `  ${'a'.repeat(NAME_MAX)} `],
    ['lastName', 'e\u0301'.repeat(NAME_MAX)],
    ['email', `${'a'.repeat(EMAIL_MAX - '@example.com'.length)}@example.com`],
    ['email', 'first.last+tag@sub.example.co'],
    ['phone', '2125550199'],
    ['phone', '(212) 555-0199'],
    ['phone', '212.555.0199'],
    ['phone', '9995550100'],
  ])('accepts %s = %j', (field, value) => {
    expect(validateRegistration({ ...VALID, [field]: value }).ok).toBe(true)
  })

  it.each([
    ['firstName', '', 'First name is required.'],
    ['firstName', '   ', 'First name is required.'],
    ['lastName', '', 'Last name is required.'],
    ['email', '', 'Email is required.'],
    ['phone', '', 'Phone number is required.'],
    ['firstName', 'a'.repeat(NAME_MAX + 1), 'First name must be 100 characters or fewer.'],
    ['lastName', '\u{1F600}'.repeat(NAME_MAX + 1), 'Last name must be 100 characters or fewer.'],
    ['firstName', 'Ja\u0000ne', 'First name contains characters that are not allowed.'],
    ['firstName', 'Ja\u0007ne', 'First name contains characters that are not allowed.'],
    ['lastName', 'Doe\u0085', 'Last name contains characters that are not allowed.'],
    ['lastName', 'D\u202Eoe', 'Last name contains characters that are not allowed.'],
    ['firstName', '\u2066Jane\u2069', 'First name contains characters that are not allowed.'],
    ['firstName', 'Jane\u200F', 'First name contains characters that are not allowed.'],
    ['firstName', 'Ja\u061Cne', 'First name contains characters that are not allowed.'],
    ['email', `${'a'.repeat(EMAIL_MAX + 1 - '@example.com'.length)}@example.com`, 'Email must be 254 characters or fewer.'],
    ['email', 'jane.doe', 'Enter a valid email address.'],
    ['email', 'jane@localhost', 'Enter a valid email address.'],
    ['email', 'jane..doe@example.com', 'Enter a valid email address.'],
    ['email', 'j\u00E1ne@example.com', 'Enter a valid email address.'],
    ['email', 'jane doe@example.com', 'Enter a valid email address.'],
    ['phone', '+14155550132', PHONE_MESSAGE],
    ['phone', '14155550132', PHONE_MESSAGE],
    ['phone', '1-415-555-0132', PHONE_MESSAGE],
    ['phone', '415555013', PHONE_MESSAGE],
    ['phone', '1155550132', PHONE_MESSAGE],
    ['phone', '4151550132', PHONE_MESSAGE],
    ['phone', '415555013x', PHONE_MESSAGE],
  ])('rejects %s = %j with %j', (field, value, message) => {
    expect(fieldsOf({ ...VALID, [field]: value })).toEqual({ [field]: [message] })
  })

  it('reports every invalid field, and only those', () => {
    expect(fieldsOf({ firstName: 'Jane', lastName: '', email: 'x', phone: '+1' })).toEqual({
      lastName: ['Last name is required.'],
      email: ['Enter a valid email address.'],
      phone: [PHONE_MESSAGE],
    })
  })

  it('treats a missing or non-string field as required', () => {
    expect(fieldsOf({ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com' })).toEqual({
      phone: ['Phone number is required.'],
    })
    expect(fieldsOf({ ...VALID, firstName: 42 })).toEqual({ firstName: ['First name is required.'] })
  })

  it.each([null, 'Jane', 42, [VALID], { ...VALID, id: '1' }, { ...VALID, createdAt: 'x' }])(
    'fails %j with no per-field messages',
    (body) => {
      expect(fieldsOf(body)).toEqual({})
    },
  )
})
