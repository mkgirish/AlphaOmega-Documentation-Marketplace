import { normalise } from '@app/shared'
import { describe, expect, it } from 'vitest'
import {
  EMAIL_MAX,
  NAME_MAX,
  PHONE_MESSAGE,
  judgeRegistration,
  messageFor,
  validationEnvelope,
  type Failure,
  type RegistrationField,
} from './rules.js'

// ST-11 — the server's own judgement of a registration body, independent of the screen.
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

function failuresOf(body: unknown): readonly Failure[] {
  const verdict = judgeRegistration(body)
  return !verdict.ok && verdict.reason === 'validation' ? verdict.failures : []
}

function ruleFor(field: RegistrationField, value: unknown): string | undefined {
  return failuresOf({ ...VALID, [field]: value }).find((f) => f.field === field)?.rule
}

// A small deterministic generator, so the property checks are reproducible.
function* strings(count: number): Generator<string> {
  const alphabet = [' ', '\t', '\n', 'a', 'Z', 'é', '-', "'", ' ', '名', '0']
  let seed = 7
  for (let i = 0; i < count; i++) {
    let s = ''
    for (let n = 0; n < i % 17; n++) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      s += alphabet[seed % alphabet.length]
    }
    yield s
  }
}

describe('judgeRegistration @story:ST-11', () => {
  it('accepts a valid body and returns the normalised values @criterion:AC-1', () => {
    expect(
      judgeRegistration({
        firstName: '  Jane  ',
        lastName: 'van   der Berg',
        email: ' jane.doe@example.com ',
        phone: '(415) 555-0132',
      }),
    ).toEqual({
      ok: true,
      value: { firstName: 'Jane', lastName: 'van der Berg', email: 'jane.doe@example.com', phone: '4155550132' },
    })
  })

  it('reports a missing email as required @criterion:AC-1', () => {
    const { email: _omit, ...body } = VALID
    expect(failuresOf(body)).toEqual([{ field: 'email', rule: 'required' }])
  })

  it('reports every invalid field at once and none of the valid ones @criterion:AC-2', () => {
    expect(failuresOf({ ...VALID, email: 'jane@', phone: '5550132' })).toEqual([
      { field: 'email', rule: 'format' },
      { field: 'phone', rule: 'format' },
    ])
    expect(failuresOf({}).map((f) => f.field)).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it.each([
    ['an array', []],
    ['null', null],
    ['a string', 'Jane'],
    ['a number', 5],
  ])('refuses %s as malformed @criterion:AC-3', (_name, body) => {
    expect(judgeRegistration(body)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses a field not in the form, even beside valid ones @criterion:AC-3', () => {
    expect(judgeRegistration({ ...VALID, id: 5 })).toEqual({ ok: false, reason: 'unknown_field' })
    expect(judgeRegistration({ ...VALID, createdAt: '2026-01-01' })).toEqual({ ok: false, reason: 'unknown_field' })
  })

  it.each([
    ['firstName', undefined, 'required'],
    ['firstName', null, 'required'],
    ['firstName', '   ', 'required'],
    ['firstName', 5, 'type'],
    ['lastName', ['Doe'], 'type'],
    ['firstName', 'a'.repeat(NAME_MAX), undefined],
    ['firstName', 'a'.repeat(NAME_MAX + 1), 'too_long'],
    ['lastName', `  ${'b'.repeat(NAME_MAX)}  `, undefined],
    ['lastName', 'b'.repeat(NAME_MAX + 1), 'too_long'],
    ['firstName', 'Ja\u0000ne', 'characters'],
    ['firstName', 'Ja\u0007ne', 'characters'],
    ['lastName', 'Doe‮', 'characters'],
    ['lastName', '⁦Doe⁩', 'characters'],
    ['firstName', 'Ja​ne', 'characters'],
    ['firstName', '\uFEFFJane', 'characters'],
    ['firstName', 'Ja\uD800ne', 'characters'],
    ['lastName', 'Doe\uE000', 'characters'],
    ['lastName', 'Do\uFFFDe', 'characters'],
    ['firstName', 'Ja\tne', undefined],
    ['firstName', 'José-María', undefined],
    ['lastName', "O'Brien", undefined],
    ['email', '', 'required'],
    ['email', 'jane@', 'format'],
    ['email', 'jane.example.com', 'format'],
    ['email', 'jane doe@example.com', 'format'],
    ['email', 'jane@exa‮mple.com', 'characters'],
    ['email', `${'a'.repeat(64)}@${'b'.repeat(EMAIL_MAX - 69)}.com`, undefined],
    ['email', `${'a'.repeat(64)}@${'b'.repeat(EMAIL_MAX - 68)}.com`, 'too_long'],
    ['phone', '', 'required'],
    ['phone', 4155550132, 'type'],
    ['phone', '4155550132', undefined],
    ['phone', '(415) 555-0132', undefined],
    ['phone', '415.555.0132', undefined],
    ['phone', '415-555-0132', undefined],
    ['phone', '2125550000', undefined],
    ['phone', '5550132', 'format'],
    ['phone', '+14155550132', 'format'],
    ['phone', '14155550132', 'format'],
    ['phone', '1155550132', 'format'],
    ['phone', '0155550132', 'format'],
    ['phone', '4151550132', 'format'],
    ['phone', '4150550132', 'format'],
    ['phone', '41555501320', 'format'],
    ['phone', '415555013a', 'format'],
  ] as const)('%s = %j breaks %s @criterion:AC-2', (field, value, rule) => {
    expect(ruleFor(field, value)).toBe(rule)
  })

  it('holds the 100/101 boundary on names and the 254/255 boundary on email @criterion:AC-2', () => {
    expect(EMAIL_MAX).toBe(254)
    expect(NAME_MAX).toBe(100)
    const local = 'a'.repeat(64)
    const at254 = `${local}@${'b'.repeat(254 - 64 - 1 - 4)}.com`
    expect(at254).toHaveLength(254)
    expect(ruleFor('email', at254)).toBeUndefined()
    expect(ruleFor('email', `${local}@${'b'.repeat(255 - 64 - 1 - 4)}.com`)).toBe('too_long')
  })

  it('accepts every NANP number whose area code and exchange start 2-9 @criterion:AC-2', () => {
    for (let lead = 0; lead <= 9; lead++) {
      for (let exchange = 0; exchange <= 9; exchange++) {
        const phone = `${lead}15${exchange}550132`
        expect(ruleFor('phone', phone), phone).toBe(lead >= 2 && exchange >= 2 ? undefined : 'format')
      }
    }
  })

  it('normalises names idempotently: judging the stored value again stores it unchanged @criterion:AC-2', () => {
    for (const s of strings(400)) {
      const name = `x${s}y`
      const once = judgeRegistration({ ...VALID, firstName: name })
      expect(once.ok, JSON.stringify(name)).toBe(true)
      if (!once.ok) continue
      expect(once.value.firstName).toBe(normalise(name))
      expect(once.value.firstName).toBe(once.value.firstName.trim())
      const twice = judgeRegistration({ ...VALID, firstName: once.value.firstName })
      expect(twice).toEqual(once)
    }
  })
})

describe('validationEnvelope @story:ST-11', () => {
  it('lists one message per invalid field and nothing for the valid ones @criterion:AC-2', () => {
    expect(
      validationEnvelope([
        { field: 'email', rule: 'format' },
        { field: 'phone', rule: 'format' },
      ]),
    ).toEqual({
      error: 'validation',
      fields: { email: ['Enter a valid email address.'], phone: [PHONE_MESSAGE] },
    })
    expect(validationEnvelope([])).toEqual({ error: 'validation', fields: {} })
  })

  it('uses the exact message the screen shows for a bad phone number @criterion:AC-2', () => {
    expect(PHONE_MESSAGE).toBe('Enter a 10-digit US number without +1, e.g. (415) 555-0132.')
  })

  it.each([
    [{ field: 'firstName', rule: 'required' }, 'First name is required.'],
    [{ field: 'lastName', rule: 'required' }, 'Last name is required.'],
    [{ field: 'email', rule: 'required' }, 'Email is required.'],
    [{ field: 'phone', rule: 'required' }, 'Phone number is required.'],
    [{ field: 'firstName', rule: 'type' }, 'First name must be text.'],
    [{ field: 'firstName', rule: 'too_long' }, 'First name must be 100 characters or fewer.'],
    [{ field: 'lastName', rule: 'too_long' }, 'Last name must be 100 characters or fewer.'],
    [{ field: 'email', rule: 'too_long' }, 'Email must be 254 characters or fewer.'],
    [{ field: 'firstName', rule: 'characters' }, 'First name contains characters that are not allowed.'],
    [{ field: 'email', rule: 'characters' }, 'Email contains characters that are not allowed.'],
    [{ field: 'email', rule: 'format' }, 'Enter a valid email address.'],
    [{ field: 'phone', rule: 'format' }, PHONE_MESSAGE],
  ] as const)('%j reads %j @criterion:AC-2', (failure, message) => {
    expect(messageFor(failure)).toBe(message)
  })
})
