import { describe, expect, it } from 'vitest'
import {
  REGISTRATION_LIMITS,
  isCrossSiteRequest,
  isJsonContentType,
  malformedJson,
  messageFor,
  normalise,
  readFieldErrors,
  registrationFields,
  registrationMessages,
  requestErrorEnvelope,
  requestErrorEnvelopeSchema,
  requestErrorStatus,
  validateRegistration,
  validationEnvelopeSchema,
  type RegistrationField,
  type FieldRule,
} from './index.js'

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

function refused(body: unknown) {
  const result = validateRegistration(body)
  if (result.ok) throw new Error('expected a refusal')
  return result
}

/** A small seeded generator so the property tests are repeatable without extra packages. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

describe('the four registration fields', () => {
  it('lists the form fields in tab order', () => {
    expect(registrationFields).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it('fixes the name, email and body limits', () => {
    expect(REGISTRATION_LIMITS).toEqual({ nameMax: 100, emailMax: 254, bodyMaxBytes: 4096 })
  })
})

describe('every message, word for word', () => {
  const table: [RegistrationField, FieldRule, string][] = [
    ['firstName', 'required', 'Enter your first name.'],
    ['firstName', 'type', 'Enter your first name.'],
    ['firstName', 'too_long', 'Keep your first name to 100 characters or fewer.'],
    ['firstName', 'invalid_characters', 'Remove hidden or control characters from your first name.'],
    ['lastName', 'required', 'Enter your last name.'],
    ['lastName', 'type', 'Enter your last name.'],
    ['lastName', 'too_long', 'Keep your last name to 100 characters or fewer.'],
    ['lastName', 'invalid_characters', 'Remove hidden or control characters from your last name.'],
    ['email', 'required', 'Enter your email address.'],
    ['email', 'type', 'Enter an email address like name@example.com.'],
    ['email', 'too_long', 'Keep your email address to 254 characters or fewer.'],
    ['email', 'format', 'Enter an email address like name@example.com.'],
    ['phone', 'required', 'Enter your phone number.'],
    ['phone', 'type', PHONE_MESSAGE],
    ['phone', 'format', PHONE_MESSAGE],
  ]

  it.each(table)('%s / %s reads exactly as specified', (field, rule, text) => {
    expect(messageFor(field, rule)).toBe(text)
  })

  it('keeps the phone message the screen and API share (AC-6)', () => {
    expect(registrationMessages.phone.format).toBe(PHONE_MESSAGE)
  })
})

describe('validateRegistration — accepted bodies', () => {
  it('accepts a valid registration and returns the normalised values', () => {
    const result = validateRegistration({
      firstName: '  Jane   Ann ',
      lastName: '\tDoe ',
      email: ' jane.doe@example.com ',
      phone: '(415) 555-0132',
    })
    expect(result).toEqual({
      ok: true,
      value: { firstName: 'Jane Ann', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' },
    })
  })

  it.each(['4155550132', '(415) 555-0132', '415-555-0132', '415.555.0132', '415 555 0132', ' (415)5550132 '])(
    'accepts the US phone format %j',
    (phone) => {
      const result = validateRegistration({ ...valid, phone })
      expect(result).toEqual({ ok: true, value: { ...valid, phone: '4155550132' } })
    },
  )
})

describe('validateRegistration — field refusals (AC-1, AC-2)', () => {
  it('refuses a missing email with an error only under fields.email (AC-1)', () => {
    const result = refused({ firstName: 'Jane', lastName: 'Doe', phone: '4155550132' })
    expect(result.envelope).toEqual({ error: 'validation', fields: { email: ['Enter your email address.'] } })
    expect(result.rejections).toEqual([{ field: 'email', rule: 'required' }])
  })

  it('reports every invalid field at once and none of the valid ones (AC-2)', () => {
    const result = refused({ firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '5550132' })
    expect(result.envelope).toEqual({
      error: 'validation',
      fields: { email: ['Enter an email address like name@example.com.'], phone: [PHONE_MESSAGE] },
    })
    expect(Object.keys(result.envelope.fields)).not.toContain('firstName')
    expect(Object.keys(result.envelope.fields)).not.toContain('lastName')
    expect(result.rejections).toEqual([
      { field: 'email', rule: 'format' },
      { field: 'phone', rule: 'format' },
    ])
  })

  it('reports all four fields when the body is an empty object', () => {
    const result = refused({})
    expect(result.envelope.fields).toEqual({
      firstName: ['Enter your first name.'],
      lastName: ['Enter your last name.'],
      email: ['Enter your email address.'],
      phone: ['Enter your phone number.'],
    })
    expect(result.rejections.map((r) => r.rule)).toEqual(['required', 'required', 'required', 'required'])
  })

  it.each([
    ['blank', '   ', 'required'],
    ['null', null, 'required'],
    ['a number', 42, 'type'],
    ['an object', { first: 'x' }, 'type'],
    ['a control character', 'Ja\u0000ne', 'invalid_characters'],
    ['a bidi override', 'Jane‮eod', 'invalid_characters'],
    ['a bidi isolate', '⁦Jane⁩', 'invalid_characters'],
    ['a zero-width joiner', 'Ja‍ne', 'invalid_characters'],
    ['a byte-order mark', '﻿Jane', 'invalid_characters'],
  ] as const)('refuses a first name that is %s', (_label, firstName, rule) => {
    const result = refused({ ...valid, firstName })
    expect(result.rejections).toEqual([{ field: 'firstName', rule }])
    expect(result.envelope.fields).toEqual({ firstName: [messageFor('firstName', rule)] })
  })

  it.each([
    ['blank', '', 'required'],
    ['a boolean', true, 'type'],
    ['a delete character', 'Doe\u007F', 'invalid_characters'],
  ] as const)('refuses a last name that is %s', (_label, lastName, rule) => {
    expect(refused({ ...valid, lastName }).rejections).toEqual([{ field: 'lastName', rule }])
  })

  it.each([
    ['jane@', 'format'],
    ['jane', 'format'],
    ['@example.com', 'format'],
    ['jane@example', 'format'],
    ['jane doe@example.com', 'format'],
    ['jane@exa mple.com', 'format'],
    ['jane@@example.com', 'format'],
    ['jane@-example.com', 'format'],
    ['jane@example.com‮', 'format'],
    ['ja\u0000ne@example.com', 'format'],
    [' ', 'required'],
    [7, 'type'],
  ] as const)('refuses the email %j', (email, rule) => {
    expect(refused({ ...valid, email }).rejections).toEqual([{ field: 'email', rule }])
  })

  it.each([
    ['5550132', 'format'],
    ['+14155550132', 'format'],
    ['+1 (415) 555-0132', 'format'],
    ['14155550132', 'format'],
    ['1 415 555 0132', 'format'],
    ['41555501320', 'format'],
    ['0155550132', 'format'],
    ['1155550132', 'format'],
    ['9115550132', 'format'],
    ['4150550132', 'format'],
    ['4151550132', 'format'],
    ['415555O132', 'format'],
    ['415‮5550132', 'format'],
    ['', 'required'],
    [4155550132, 'type'],
  ] as const)('refuses the phone %j', (phone, rule) => {
    const result = refused({ ...valid, phone })
    expect(result.rejections).toEqual([{ field: 'phone', rule }])
    expect(result.envelope.fields).toEqual({ phone: [messageFor('phone', rule)] })
  })
})

describe('validateRegistration — length boundaries', () => {
  it.each(['firstName', 'lastName'] as const)('accepts a %s of 100 characters and refuses 101', (field) => {
    expect(validateRegistration({ ...valid, [field]: 'a'.repeat(100) }).ok).toBe(true)
    expect(refused({ ...valid, [field]: 'a'.repeat(101) }).rejections).toEqual([{ field, rule: 'too_long' }])
  })

  it('measures the name after trimming, so padding does not count', () => {
    expect(validateRegistration({ ...valid, firstName: `   ${'a'.repeat(100)}   ` }).ok).toBe(true)
  })

  it('counts characters, not UTF-16 units, so 100 emoji fit', () => {
    expect(validateRegistration({ ...valid, firstName: '😀'.repeat(100) }).ok).toBe(true)
    expect(refused({ ...valid, firstName: '😀'.repeat(101) }).rejections).toEqual([{ field: 'firstName', rule: 'too_long' }])
  })

  const emailOf = (length: number) => `${'a'.repeat(length - '@example.com'.length)}@example.com`

  it('accepts an email of 254 characters and refuses 255', () => {
    expect(emailOf(254)).toHaveLength(254)
    expect(validateRegistration({ ...valid, email: emailOf(254) }).ok).toBe(true)
    expect(refused({ ...valid, email: emailOf(255) }).rejections).toEqual([{ field: 'email', rule: 'too_long' }])
  })
})

describe('validateRegistration — body shape (AC-3)', () => {
  it('refuses a field not in the form with fields {} and names no value', () => {
    const result = refused({ ...valid, id: 5 })
    expect(result.envelope).toEqual({ error: 'validation', fields: {} })
    expect(result.rejections).toEqual([{ field: 'body', rule: 'unknown_field' }])
  })

  it('reports field errors and the unknown field together', () => {
    const result = refused({ ...valid, email: 'jane@', id: 5 })
    expect(result.envelope).toEqual({ error: 'validation', fields: { email: ['Enter an email address like name@example.com.'] } })
    expect(result.rejections).toEqual([
      { field: 'email', rule: 'format' },
      { field: 'body', rule: 'unknown_field' },
    ])
  })

  it.each([
    ['null', null],
    ['an array', [valid]],
    ['a string', 'firstName=Jane'],
    ['a number', 5],
    ['undefined', undefined],
  ])('refuses a body that is %s with fields {}', (_label, body) => {
    const result = refused(body)
    expect(result.envelope).toEqual({ error: 'validation', fields: {} })
    expect(result.rejections).toEqual([{ field: 'body', rule: 'not_object' }])
  })

  it('does not trust an inherited __proto__ key as a form field', () => {
    const body = JSON.parse('{"firstName":"Jane","lastName":"Doe","email":"jane.doe@example.com","phone":"4155550132","__proto__":{"x":1}}')
    const result = refused(body)
    expect(result.envelope).toEqual({ error: 'validation', fields: {} })
    expect(result.rejections).toEqual([{ field: 'body', rule: 'unknown_field' }])
  })

  it('gives malformed JSON the validation envelope with fields {}', () => {
    expect(malformedJson()).toEqual({
      ok: false,
      envelope: { error: 'validation', fields: {} },
      rejections: [{ field: 'body', rule: 'malformed_json' }],
    })
  })
})

describe('no refusal repeats a submitted value (AC-5)', () => {
  const SENTINEL = 'leak-check@bad'

  it.each(registrationFields)('keeps a sentinel in %s out of the envelope and the rejections', (field) => {
    const result = refused({ ...valid, email: 'jane@', [field]: `${SENTINEL}\u0000${'x'.repeat(300)}` })
    const text = JSON.stringify(result)
    expect(text).not.toContain(SENTINEL)
    expect(text).not.toContain('xxxxxxxxxx')
  })

  it('keeps an unknown key and its value out of the envelope and the rejections', () => {
    const text = JSON.stringify(refused({ ...valid, [SENTINEL]: SENTINEL }))
    expect(text).not.toContain(SENTINEL)
  })

  it('names only the field and rule in each rejection', () => {
    const result = refused({ ...valid, email: SENTINEL })
    expect(result.rejections).toEqual([{ field: 'email', rule: 'format' }])
    for (const rejection of result.rejections) expect(Object.keys(rejection).sort()).toEqual(['field', 'rule'])
  })

  it('never builds a message from the input: every message is a fixed string', () => {
    const fixed = new Set<string>(Object.values(registrationMessages).flatMap((m) => Object.values(m)))
    const random = prng(11)
    for (let i = 0; i < 200; i += 1) {
      const body: Record<string, unknown> = {}
      for (const field of registrationFields) body[field] = pick(random, ['', ' ', 'x'.repeat(120), 'a@', '12', 3, null, '‮'])
      const result = validateRegistration(body)
      if (!result.ok) {
        for (const list of Object.values(result.envelope.fields)) for (const message of list ?? []) expect(fixed.has(message)).toBe(true)
      }
    }
  })
})

describe('properties', () => {
  const pieces = ['a', 'B', 'é', ' ', '  ', '\t', '\n', ' ', 'x y', '-', "'"]

  it('normalise is idempotent and leaves no edge or doubled whitespace', () => {
    const random = prng(1)
    for (let i = 0; i < 500; i += 1) {
      let text = ''
      const length = Math.floor(random() * 12)
      for (let j = 0; j < length; j += 1) text += pick(random, pieces)
      const once = normalise(text)
      expect(normalise(once)).toBe(once)
      expect(once).toBe(once.trim())
      expect(once).not.toMatch(/\s{2}/)
    }
  })

  it('validation is idempotent: accepted values re-validate to themselves', () => {
    const random = prng(2)
    for (let i = 0; i < 300; i += 1) {
      const name = () => {
        let text = pick(random, ['a', 'Zoë', 'Ō'])
        const length = Math.floor(random() * 10)
        for (let j = 0; j < length; j += 1) text += pick(random, pieces)
        return text
      }
      const first = validateRegistration({ ...valid, firstName: name(), lastName: name() })
      if (!first.ok) throw new Error('expected acceptance')
      expect(validateRegistration(first.value)).toEqual(first)
    }
  })

  it('accepts every name of 1 to 100 characters and refuses every one of 101 to 200', () => {
    const random = prng(3)
    for (let i = 0; i < 300; i += 1) {
      const length = 1 + Math.floor(random() * 200)
      let text = ''
      for (let j = 0; j < length; j += 1) text += pick(random, ['a', 'Z', 'é', 'ß', '😀'])
      const result = validateRegistration({ ...valid, lastName: text })
      expect(result.ok).toBe(length <= 100)
    }
  })

  it('accepts every NANP number in any common layout and stores its ten digits', () => {
    const random = prng(4)
    const digit = (from: number) => String(from + Math.floor(random() * (10 - from)))
    for (let i = 0; i < 500; i += 1) {
      let area = digit(2) + digit(0) + digit(0)
      if (area[1] === '1' && area[2] === '1') area = `${area[0]}20`
      const exchange = digit(2) + digit(0) + digit(0)
      const line = digit(0) + digit(0) + digit(0) + digit(0)
      const layout = pick(random, [
        `${area}${exchange}${line}`,
        `(${area}) ${exchange}-${line}`,
        `${area}-${exchange}-${line}`,
        `${area}.${exchange}.${line}`,
        `${area} ${exchange} ${line}`,
      ])
      expect(validateRegistration({ ...valid, phone: layout })).toEqual({ ok: true, value: { ...valid, phone: area + exchange + line } })
    }
  })

  it('refuses every number whose area code or exchange starts with 0 or 1', () => {
    const random = prng(5)
    for (let i = 0; i < 200; i += 1) {
      const digits = Array.from({ length: 10 }, () => String(Math.floor(random() * 10)))
      const at = pick(random, [0, 3])
      digits[at] = pick(random, ['0', '1'])
      expect(refused({ ...valid, phone: digits.join('') }).rejections).toEqual([{ field: 'phone', rule: 'format' }])
    }
  })
})

describe('AD-5 envelope schemas', () => {
  it('accepts the validation envelope the story specifies', () => {
    const body = { error: 'validation', fields: { phone: [PHONE_MESSAGE] } }
    expect(validationEnvelopeSchema.safeParse(body).success).toBe(true)
    expect(validationEnvelopeSchema.safeParse({ error: 'validation', fields: {} }).success).toBe(true)
  })

  it.each([
    ['another error code', { error: 'nope', fields: {} }],
    ['a field outside the form', { error: 'validation', fields: { id: ['x'] } }],
    ['an empty message list', { error: 'validation', fields: { email: [] } }],
    ['an extra top-level key', { error: 'validation', fields: {}, id: 'abc' }],
    ['no fields', { error: 'validation' }],
  ])('rejects a validation envelope with %s', (_label, body) => {
    expect(validationEnvelopeSchema.safeParse(body).success).toBe(false)
  })

  it('every refusal produced by validateRegistration matches the schema', () => {
    for (const body of [{}, { ...valid, id: 1 }, { ...valid, email: 'x' }, null]) {
      expect(validationEnvelopeSchema.safeParse(refused(body).envelope).success).toBe(true)
    }
  })

  it.each([
    ['cross_site', 403],
    ['too_large', 413],
    ['unsupported_media_type', 415],
  ] as const)('maps the %s request error to %i with a bare envelope (AC-4)', (code, status) => {
    expect(requestErrorStatus[code]).toBe(status)
    expect(requestErrorEnvelope(code)).toEqual({ error: code })
    expect(requestErrorEnvelopeSchema.safeParse(requestErrorEnvelope(code)).success).toBe(true)
  })

  it('rejects request-error envelopes that carry anything else', () => {
    expect(requestErrorEnvelopeSchema.safeParse({ error: 'too_large', detail: 'x' }).success).toBe(false)
    expect(requestErrorEnvelopeSchema.safeParse({ error: 'validation' }).success).toBe(false)
  })
})

describe('readFieldErrors — what the screen takes from a 400 (AC-6)', () => {
  it('maps the overridden phone refusal to the phone field', () => {
    expect(readFieldErrors({ error: 'validation', fields: { phone: [PHONE_MESSAGE] } })).toEqual({ phone: PHONE_MESSAGE })
  })

  it('takes the first message of each field', () => {
    expect(readFieldErrors({ error: 'validation', fields: { email: ['one', 'two'], firstName: ['three'] } })).toEqual({
      email: 'one',
      firstName: 'three',
    })
  })

  it.each([
    ['not an envelope', { message: 'no' }],
    ['a request error', { error: 'too_large' }],
    ['null', null],
    ['a string', 'validation'],
  ])('returns null for %s', (_label, body) => {
    expect(readFieldErrors(body)).toBeNull()
  })
})

describe('request gates (AC-4)', () => {
  it.each([
    ['application/json', true],
    ['application/json; charset=utf-8', true],
    ['Application/JSON;charset=UTF-8', true],
    [' application/json ', true],
    ['text/plain', false],
    ['application/jsonx', false],
    ['application/json-patch+json', false],
    ['application/x-www-form-urlencoded', false],
    ['multipart/form-data; boundary=x', false],
    ['', false],
    [undefined, false],
  ] as const)('content type %j is JSON: %s', (header, expected) => {
    expect(isJsonContentType(header)).toBe(expected)
  })

  it.each([
    ['cross-site', true],
    ['Cross-Site', true],
    ['same-origin', false],
    ['same-site', false],
    ['none', false],
    [undefined, false],
  ] as const)('Sec-Fetch-Site %j is cross-site: %s', (header, expected) => {
    expect(isCrossSiteRequest(header)).toBe(expected)
  })
})
