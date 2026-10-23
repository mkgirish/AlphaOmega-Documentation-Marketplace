import { describe, expect, it } from 'vitest'
import { fieldMessages } from '@app/shared'
import { parseRegistration, type RegistrationField } from './registration-input.js'

// ST-2 AC-1 and AC-3: the four fields are validated and normalised (NFC, trim, phone
// separators stripped) exactly as IF-2 describes before anything is stored.
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

const MESSAGES = {
  firstNameRequired: fieldMessages.firstName.required,
  firstNameTooLong: 'First name must be 100 characters or fewer.',
  firstNameInvalid: 'First name cannot contain control or text-direction characters.',
  lastNameRequired: fieldMessages.lastName.required,
  lastNameTooLong: 'Last name must be 100 characters or fewer.',
  lastNameInvalid: 'Last name cannot contain control or text-direction characters.',
  emailRequired: fieldMessages.email.required,
  emailInvalid: 'Enter a valid email address.',
  emailTooLong: 'Email must be 254 characters or fewer.',
  phoneRequired: fieldMessages.phone.required,
  phoneInvalid: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
} as const

function fieldsFor(overrides: Record<string, unknown>): Partial<Record<RegistrationField, string[]>> {
  const result = parseRegistration({ ...VALID, ...overrides })
  if (result.ok) throw new Error('expected a validation failure')
  return result.fields
}

function valueFor(overrides: object) {
  const result = parseRegistration({ ...VALID, ...overrides })
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.fields)}`)
  return result.value
}

describe('a valid registration @story:ST-2 @criterion:AC-1', () => {
  it('accepts Jane / Doe / jane.doe@example.com / 4155550132 unchanged', () => {
    expect(parseRegistration(VALID)).toEqual({ ok: true, value: VALID })
  })
})

describe('normalisation @story:ST-2 @criterion:AC-3', () => {
  it('trims names and email and strips phone separators', () => {
    expect(valueFor({ firstName: ' Jane ', phone: '(415) 555-0132' })).toEqual(VALID)
    expect(valueFor({ email: '  jane.doe@example.com\t', lastName: '\tDoe  ' })).toEqual(VALID)
  })

  it.each(['415-555-0132', '415.555.0132', '415 555 0132', '(415)555-0132', ' 4155550132 '])(
    'phone %j is stored as 4155550132',
    (phone) => {
      expect(valueFor({ phone }).phone).toBe('4155550132')
    },
  )

  it('composes names to NFC', () => {
    expect(valueFor({ firstName: 'Jose\u0301' }).firstName).toBe('Jos\u00e9')
  })

  it('is idempotent: normalising an accepted value again changes nothing', () => {
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const pieces = [' ', '\u00a0', 'a', 'Z', 'e\u0301', '\u00e9', '-', "'", '\u4e2d', '\u{1F600}']
    for (let i = 0; i < 300; i += 1) {
      const length = 1 + Math.floor(random() * 12)
      const name = Array.from({ length }, () => pieces[Math.floor(random() * pieces.length)]).join('')
      const first = parseRegistration({ ...VALID, firstName: `x${name}` })
      if (!first.ok) continue
      expect(parseRegistration(first.value)).toEqual(first)
    }
    const once = valueFor({ firstName: ' Jane ', email: ' jane.doe@example.com ', phone: '(415) 555-0132' })
    expect(valueFor(once)).toEqual(once)
  })
})

describe('field rules and their messages @story:ST-2 @criterion:AC-3', () => {
  it.each([
    ['firstName', '', MESSAGES.firstNameRequired],
    ['firstName', '   ', MESSAGES.firstNameRequired],
    ['firstName', undefined, MESSAGES.firstNameRequired],
    ['firstName', 42, MESSAGES.firstNameRequired],
    ['firstName', 'a'.repeat(101), MESSAGES.firstNameTooLong],
    ['firstName', '\u{1F600}'.repeat(101), MESSAGES.firstNameTooLong],
    ['firstName', 'Ja\u0000ne', MESSAGES.firstNameInvalid],
    ['firstName', 'Ja\nne', MESSAGES.firstNameInvalid],
    ['firstName', 'Ja\u202Ene', MESSAGES.firstNameInvalid],
    ['firstName', 'Ja\u200Fne', MESSAGES.firstNameInvalid],
    ['firstName', '\u2066Jane', MESSAGES.firstNameInvalid],
    ['firstName', 'Ja\u061Cne', MESSAGES.firstNameInvalid],
    ['lastName', '', MESSAGES.lastNameRequired],
    ['lastName', null, MESSAGES.lastNameRequired],
    ['lastName', 'b'.repeat(101), MESSAGES.lastNameTooLong],
    ['lastName', 'Do\u007fe', MESSAGES.lastNameInvalid],
    ['email', '', MESSAGES.emailRequired],
    ['email', 'not-an-email', MESSAGES.emailInvalid],
    ['email', 'jane@example', MESSAGES.emailInvalid],
    ['email', 'jane doe@example.com', MESSAGES.emailInvalid],
    ['email', 'jané@example.com', MESSAGES.emailInvalid],
    ['email', '@example.com', MESSAGES.emailInvalid],
    ['email', `${'a'.repeat(64)}@${'b'.repeat(186)}.com`, MESSAGES.emailTooLong],
    ['phone', '', MESSAGES.phoneRequired],
    ['phone', 4155550132, MESSAGES.phoneRequired],
    ['phone', '+14155550132', MESSAGES.phoneInvalid],
    ['phone', '+1 (415) 555-0132', MESSAGES.phoneInvalid],
    ['phone', '14155550132', MESSAGES.phoneInvalid],
    ['phone', '1 415 555 0132', MESSAGES.phoneInvalid],
    ['phone', '0155550132', MESSAGES.phoneInvalid],
    ['phone', '1155550132', MESSAGES.phoneInvalid],
    ['phone', '4150550132', MESSAGES.phoneInvalid],
    ['phone', '4151550132', MESSAGES.phoneInvalid],
    ['phone', '415555013', MESSAGES.phoneInvalid],
    ['phone', '41555501320', MESSAGES.phoneInvalid],
    ['phone', '415/555/0132', MESSAGES.phoneInvalid],
    ['phone', 'four one five', MESSAGES.phoneInvalid],
  ] as const)('%s %j is refused with %j', (field, value, message) => {
    expect(fieldsFor({ [field]: value })).toEqual({ [field]: [message] })
  })

  it('accepts names at exactly 100 code points, even outside the BMP', () => {
    expect(valueFor({ firstName: 'a'.repeat(100) }).firstName).toHaveLength(100)
    expect([...valueFor({ lastName: '\u{1F600}'.repeat(100) }).lastName]).toHaveLength(100)
    expect(valueFor({ firstName: ` ${'a'.repeat(100)} ` }).firstName).toHaveLength(100)
  })

  it('accepts an email of exactly 254 characters and refuses 255', () => {
    const at254 = `${'a'.repeat(64)}@${'b'.repeat(185)}.com`
    expect(at254).toHaveLength(254)
    expect(valueFor({ email: at254 }).email).toBe(at254)
    expect(fieldsFor({ email: `a${at254}` })).toEqual({ email: [MESSAGES.emailTooLong] })
  })

  it.each(['2015550132', '9995559999', '(212) 234-5678', '312.867.5309'])('accepts the NANP number %j', (phone) => {
    expect(valueFor({ phone }).phone).toMatch(/^[2-9]\d{2}[2-9]\d{6}$/)
  })

  it('lists every invalid field and only those', () => {
    expect(fieldsFor({ firstName: '', phone: '+1' })).toEqual({
      firstName: [MESSAGES.firstNameRequired],
      phone: [MESSAGES.phoneInvalid],
    })
    expect(fieldsFor({ firstName: undefined, lastName: undefined, email: undefined, phone: undefined })).toEqual({
      firstName: [MESSAGES.firstNameRequired],
      lastName: [MESSAGES.lastNameRequired],
      email: [MESSAGES.emailRequired],
      phone: [MESSAGES.phoneRequired],
    })
  })

  it('refuses an unknown property such as id without naming it', () => {
    expect(parseRegistration({ ...VALID, id: 'x' })).toEqual({ ok: false, fields: {} })
    expect(parseRegistration({ ...VALID, createdAt: '2026-01-01T00:00:00Z' })).toEqual({ ok: false, fields: {} })
  })

  it.each([null, undefined, 'Jane', 42, [VALID]])('refuses the non-object body %j with no field messages', (body) => {
    expect(parseRegistration(body)).toEqual({ ok: false, fields: {} })
  })

  it('never puts a submitted value into a message', () => {
    const sentinel = 'SENTINEL-c0ffee'
    const result = parseRegistration({
      firstName: `${sentinel}\u0000`,
      lastName: sentinel.repeat(20),
      email: sentinel,
      phone: sentinel,
    })
    expect(JSON.stringify(result)).not.toContain(sentinel)
  })
})
