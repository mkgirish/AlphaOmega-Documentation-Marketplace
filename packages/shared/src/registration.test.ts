import { describe, expect, it } from 'vitest'
import {
  EMAIL_MAX,
  NAME_MAX,
  REGISTRATION_BODY_LIMIT,
  checkRegistration,
  checkRegistrationJson,
  errorEnvelope,
  formatUtcSeconds,
  messages,
  fieldMessages,
  normalise,
  registrationRequest,
  validationEnvelope,
  visitorFieldNames,
  type RegistrationCheck,
  type VisitorField,
} from './index.js'

const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

// A small seeded generator so the property checks are repeatable run to run.
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const pick = <T>(random: () => number, items: readonly T[]): T => items[Math.floor(random() * items.length)] as T

function refused(check: RegistrationCheck) {
  if (check.ok) throw new Error('expected a refusal')
  return check
}

function accepted(check: RegistrationCheck) {
  if (!check.ok) throw new Error(`expected acceptance, got ${JSON.stringify(check.envelope)}`)
  return check.value
}

describe('the visitor fields (ST-11)', () => {
  it('names exactly the four fields the screen shows, in order', () => {
    expect(visitorFieldNames).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it('caps names at 100, email at 254 and the request body at 4 KB', () => {
    expect(NAME_MAX).toBe(100)
    expect(EMAIL_MAX).toBe(254)
    expect(REGISTRATION_BODY_LIMIT).toBe(4096)
  })
})

describe('the validation envelope (AC-1)', () => {
  it('is {"error":"validation","fields":{...}} and defaults to empty fields', () => {
    expect(validationEnvelope({ email: ['x'] })).toEqual({ error: 'validation', fields: { email: ['x'] } })
    expect(validationEnvelope()).toEqual({ error: 'validation', fields: {} })
  })
})

describe('checkRegistration — accepted bodies', () => {
  it('accepts a valid registration unchanged', () => {
    expect(accepted(checkRegistration(valid))).toEqual(valid)
  })

  it('stores trimmed, collapsed names, a trimmed email and the phone as its 10 digits', () => {
    const value = accepted(
      checkRegistration({ firstName: '  Mary \t Ann ', lastName: '\nDoe  ', email: ' jane@example.com ', phone: ' (415) 555-0132 ' }),
    )
    expect(value).toEqual({ firstName: 'Mary Ann', lastName: 'Doe', email: 'jane@example.com', phone: '4155550132' })
  })

  it.each([['4155550132'], ['(415) 555-0132'], ['415-555-0132'], ['415.555.0132'], ['415 555 0132'], ['2125550000'], ['9999999999']])(
    'accepts the NANP number %s',
    (phone) => {
      expect(accepted(checkRegistration({ ...valid, phone })).phone).toBe(phone.replace(/\D/g, ''))
    },
  )

  it('keeps accented and non-Latin names', () => {
    const value = accepted(checkRegistration({ ...valid, firstName: 'Zoë', lastName: '李' }))
    expect(value.firstName).toBe('Zoë')
    expect(value.lastName).toBe('李')
  })
})

describe('checkRegistration — every refusal message, by field and rule (table)', () => {
  const cases: [string, Record<string, unknown>, VisitorField, string, string][] = [
    ['missing first name', { ...valid, firstName: undefined }, 'firstName', 'required', 'Enter your first name.'],
    ['blank first name', { ...valid, firstName: '   ' }, 'firstName', 'required', 'Enter your first name.'],
    ['null first name', { ...valid, firstName: null }, 'firstName', 'required', 'Enter your first name.'],
    ['numeric first name', { ...valid, firstName: 5 }, 'firstName', 'type', 'Enter your first name.'],
    [
      '101-char first name',
      { ...valid, firstName: 'a'.repeat(101) },
      'firstName',
      'too_long',
      'First name must be 100 characters or fewer.',
    ],
    [
      'control char in first name',
      { ...valid, firstName: 'Ja\u0000ne' },
      'firstName',
      'characters',
      'First name contains characters that are not allowed.',
    ],
    ['missing last name', { ...valid, lastName: undefined }, 'lastName', 'required', 'Enter your last name.'],
    ['array last name', { ...valid, lastName: ['Doe'] }, 'lastName', 'type', 'Enter your last name.'],
    ['101-char last name', { ...valid, lastName: 'b'.repeat(101) }, 'lastName', 'too_long', 'Last name must be 100 characters or fewer.'],
    [
      'bidi override in last name',
      { ...valid, lastName: 'Doe‮' },
      'lastName',
      'characters',
      'Last name contains characters that are not allowed.',
    ],
    ['missing email', { ...valid, email: undefined }, 'email', 'required', 'Enter your email address.'],
    ['blank email', { ...valid, email: ' ' }, 'email', 'required', 'Enter your email address.'],
    ['object email', { ...valid, email: {} }, 'email', 'type', 'Enter your email address.'],
    ['email without domain', { ...valid, email: 'jane@' }, 'email', 'format', 'Enter a valid email address.'],
    ['email without @', { ...valid, email: 'jane.example.com' }, 'email', 'format', 'Enter a valid email address.'],
    [
      '255-char email',
      { ...valid, email: `${'a'.repeat(243)}@example.com` },
      'email',
      'too_long',
      'Email must be 254 characters or fewer.',
    ],
    [
      'bidi isolate in email',
      { ...valid, email: 'jane⁦@example.com' },
      'email',
      'characters',
      'Email contains characters that are not allowed.',
    ],
    ['missing phone', { ...valid, phone: undefined }, 'phone', 'required', 'Enter your phone number.'],
    ['blank phone', { ...valid, phone: '' }, 'phone', 'required', 'Enter your phone number.'],
    ['numeric phone', { ...valid, phone: 4155550132 }, 'phone', 'type', 'Enter your phone number.'],
    ['seven-digit phone', { ...valid, phone: '5550132' }, 'phone', 'format', PHONE_MESSAGE],
    ['phone with +1', { ...valid, phone: '+1 415 555 0132' }, 'phone', 'format', PHONE_MESSAGE],
    ['eleven-digit phone', { ...valid, phone: '14155550132' }, 'phone', 'format', PHONE_MESSAGE],
    ['area code starting 1', { ...valid, phone: '1155550132' }, 'phone', 'format', PHONE_MESSAGE],
    ['area code starting 0', { ...valid, phone: '0155550132' }, 'phone', 'format', PHONE_MESSAGE],
    ['exchange starting 1', { ...valid, phone: '4151550132' }, 'phone', 'format', PHONE_MESSAGE],
    ['letters in phone', { ...valid, phone: '415555013a' }, 'phone', 'format', PHONE_MESSAGE],
    ['control char in phone', { ...valid, phone: '415555\u00070132' }, 'phone', 'characters', PHONE_MESSAGE],
  ]

  it.each(cases)('%s', (_name, body, field, rule, message) => {
    const check = refused(checkRegistration(body))
    expect(check.envelope).toEqual({ error: 'validation', fields: { [field]: [message] } })
    expect(check.rejections).toEqual([{ field, rule }])
    expect(fieldMessages[field][rule as keyof (typeof fieldMessages)[VisitorField]]).toBe(message)
  })

  it('carries the exact phone message the screen shows (AC-6)', () => {
    expect(fieldMessages.phone.format).toBe(PHONE_MESSAGE)
  })
})

describe('the Gherkin request bodies', () => {
  it('AC-1: a body missing email is refused with an error under fields.email only', () => {
    const check = refused(checkRegistration({ firstName: 'Jane', lastName: 'Doe', phone: '4155550132' }))
    expect(check.envelope.error).toBe('validation')
    expect(Object.keys(check.envelope.fields)).toEqual(['email'])
    expect(check.envelope.fields.email?.length).toBeGreaterThan(0)
  })

  it('AC-2: several invalid fields are all reported, and the valid ones are not', () => {
    const check = refused(checkRegistration({ firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '5550132' }))
    expect(check.envelope.fields.email).toEqual(['Enter a valid email address.'])
    expect(check.envelope.fields.phone).toEqual([PHONE_MESSAGE])
    expect(check.envelope.fields).not.toHaveProperty('firstName')
    expect(check.envelope.fields).not.toHaveProperty('lastName')
    expect(check.rejections).toEqual([
      { field: 'email', rule: 'format' },
      { field: 'phone', rule: 'format' },
    ])
  })

  it('AC-2: an empty object reports all four fields at once', () => {
    const check = refused(checkRegistration({}))
    expect(Object.keys(check.envelope.fields).sort()).toEqual([...visitorFieldNames].sort())
  })

  it('AC-3: malformed JSON is refused with "fields" {}', () => {
    const check = refused(checkRegistrationJson('{firstName:'))
    expect(check.envelope).toEqual({ error: 'validation', fields: {} })
    expect(check.rejections).toEqual([{ field: 'body', rule: 'shape' }])
  })

  it('AC-3: valid JSON text is checked like a parsed body', () => {
    expect(accepted(checkRegistrationJson(JSON.stringify(valid)))).toEqual(valid)
    expect(refused(checkRegistrationJson(JSON.stringify({ ...valid, email: 'jane@' }))).envelope.fields).toEqual({
      email: ['Enter a valid email address.'],
    })
  })

  it('AC-3: an unexpected field such as "id" refuses an otherwise valid body', () => {
    const check = refused(checkRegistration({ ...valid, id: 5 }))
    expect(check.envelope).toEqual({ error: 'validation', fields: {} })
    expect(check.rejections).toEqual([{ field: 'body', rule: 'unknown_field' }])
  })

  it('AC-3: an unexpected field is reported beside the invalid known ones', () => {
    const check = refused(checkRegistration({ ...valid, phone: '5550132', id: 5 }))
    expect(check.envelope.fields).toEqual({ phone: [PHONE_MESSAGE] })
    expect(check.rejections).toContainEqual({ field: 'body', rule: 'unknown_field' })
  })

  it.each([[null], [[]], ['text'], [42], [true], [[valid]]])('AC-3: a JSON body that is not an object (%j) is refused', (body) => {
    const check = refused(checkRegistration(body))
    expect(check.envelope).toEqual({ error: 'validation', fields: {} })
    expect(check.rejections).toEqual([{ field: 'body', rule: 'shape' }])
  })

  it('AC-3: JSON that parses to a non-object is refused the same way', () => {
    expect(refused(checkRegistrationJson('null')).envelope).toEqual({ error: 'validation', fields: {} })
    expect(refused(checkRegistrationJson('')).envelope).toEqual({ error: 'validation', fields: {} })
  })

  it('the schema itself is strict and normalising', () => {
    expect(registrationRequest.safeParse({ ...valid, id: 5 }).success).toBe(false)
    expect(registrationRequest.parse({ ...valid, firstName: ' Jane ' }).firstName).toBe('Jane')
  })
})

describe('AC-5: no refusal repeats a submitted value or an unexpected key', () => {
  const SENTINEL = 'leak-check@bad'

  it('the Gherkin sentinel email appears in neither the envelope nor the rejections', () => {
    const check = refused(checkRegistration({ ...valid, email: SENTINEL }))
    expect(JSON.stringify(check.envelope)).not.toContain(SENTINEL)
    expect(JSON.stringify(check.rejections)).not.toContain(SENTINEL)
    expect(check.rejections).toEqual([{ field: 'email', rule: 'format' }])
  })

  it.each(visitorFieldNames)('a sentinel in %s never comes back', (field) => {
    const sentinel = `zz${field}SENTINEL‮+1@`
    const check = refused(checkRegistration({ ...valid, [field]: sentinel.repeat(30) }))
    const text = JSON.stringify(check)
    expect(text).not.toContain('SENTINEL')
    expect(text).not.toContain(field + 'SENTINEL')
  })

  it('an unexpected key and its value are not named', () => {
    const check = refused(checkRegistration({ ...valid, secretKeySENTINEL: 'valueSENTINEL' }))
    expect(JSON.stringify(check)).not.toContain('SENTINEL')
  })

  it('malformed JSON text is not quoted back', () => {
    expect(JSON.stringify(checkRegistrationJson('{"email":"SENTINEL'))).not.toContain('SENTINEL')
  })

  it('no rejection carries anything but a field name and a rule', () => {
    const check = refused(checkRegistration({ firstName: 1, lastName: '', email: 'x', phone: '1', extra: 'SENTINEL' }))
    for (const rejection of check.rejections) expect(Object.keys(rejection).sort()).toEqual(['field', 'rule'])
  })
})

describe('boundaries', () => {
  it.each(['firstName', 'lastName'] as const)('%s: 100 characters pass, 101 are refused', (field) => {
    expect(accepted(checkRegistration({ ...valid, [field]: 'a'.repeat(100) }))[field]).toHaveLength(100)
    expect(refused(checkRegistration({ ...valid, [field]: 'a'.repeat(101) })).rejections).toEqual([{ field, rule: 'too_long' }])
  })

  it('names are measured after normalising, so padding does not count', () => {
    expect(accepted(checkRegistration({ ...valid, firstName: `  ${'a'.repeat(100)}  ` })).firstName).toHaveLength(100)
  })

  it('names are measured in characters, not UTF-16 units', () => {
    expect(accepted(checkRegistration({ ...valid, firstName: '😀'.repeat(100) })).firstName).toBe('😀'.repeat(100))
    expect(refused(checkRegistration({ ...valid, firstName: '😀'.repeat(101) })).rejections).toEqual([
      { field: 'firstName', rule: 'too_long' },
    ])
  })

  it('email: 254 characters pass, 255 are refused', () => {
    const local = 'a'.repeat(64)
    const domain = (n: number) => `${'b'.repeat(n - 4)}.com`
    // 64 + 1 + 189 = 254; the domain is split into labels of 63 or fewer.
    const at254 = `${local}@${'c'.repeat(63)}.${'d'.repeat(63)}.${domain(61)}`
    const at255 = `${local}@${'c'.repeat(63)}.${'d'.repeat(63)}.${domain(62)}`
    expect(at254).toHaveLength(254)
    expect(at255).toHaveLength(255)
    expect(accepted(checkRegistration({ ...valid, email: at254 })).email).toBe(at254)
    expect(refused(checkRegistration({ ...valid, email: at255 })).rejections).toEqual([{ field: 'email', rule: 'too_long' }])
  })

  it('email is measured after trimming', () => {
    const at254 = `${'a'.repeat(64)}@${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(57)}.com`
    expect(accepted(checkRegistration({ ...valid, email: `  ${at254}  ` })).email).toBe(at254)
  })

  it('phone: 10 digits pass, 9 and 11 are refused', () => {
    expect(accepted(checkRegistration({ ...valid, phone: '4155550132' })).phone).toBe('4155550132')
    expect(refused(checkRegistration({ ...valid, phone: '415555013' })).rejections).toEqual([{ field: 'phone', rule: 'format' }])
    expect(refused(checkRegistration({ ...valid, phone: '41555501320' })).rejections).toEqual([{ field: 'phone', rule: 'format' }])
  })
})

describe('control and bidirectional characters', () => {
  const forbidden = ['\u0000', '\u0007', '\u001b', '\u007f', '\u0085', '\u009f', '؜', '‎', '‏', '‪', '‭', '‮', '⁦', '⁩']

  it.each(forbidden.map((c) => [`U+${c.codePointAt(0)?.toString(16).padStart(4, '0')}`, c]))('%s is refused in every field', (_name, c) => {
    for (const field of visitorFieldNames) {
      const value = field === 'phone' ? `415${c}5550132` : field === 'email' ? `ja${c}ne@example.com` : `Ja${c}ne`
      expect(refused(checkRegistration({ ...valid, [field]: value })).rejections).toEqual([{ field, rule: 'characters' }])
    }
  })

  it('tabs and newlines in names are whitespace, collapsed rather than refused', () => {
    expect(accepted(checkRegistration({ ...valid, firstName: 'Mary\t\r\nAnn' })).firstName).toBe('Mary Ann')
  })
})

describe('properties (seeded)', () => {
  const RUNS = 300
  const pieces = [' ', '  ', '\t', '\n', 'a', 'Zoë', '李', '-', "'", 'Mary Ann', ' ', ' ']

  it('normalise is idempotent and leaves no edge or doubled whitespace', () => {
    const random = prng(11)
    for (let run = 0; run < RUNS; run++) {
      const input = Array.from({ length: Math.floor(random() * 12) }, () => pick(random, pieces)).join('')
      const once = normalise(input)
      expect(normalise(once)).toBe(once)
      expect(once).toBe(once.trim())
      expect(once).not.toMatch(/\s{2}/)
    }
  })

  it('accepted names are already normalised, and re-checking them is a fixed point', () => {
    const random = prng(23)
    for (let run = 0; run < RUNS; run++) {
      const firstName = Array.from({ length: 1 + Math.floor(random() * 10) }, () => pick(random, pieces)).join('') + 'x'
      const value = accepted(checkRegistration({ ...valid, firstName }))
      expect(value.firstName).toBe(normalise(firstName))
      expect(accepted(checkRegistration(value))).toEqual(value)
    }
  })

  it('every NANP number is accepted however it is punctuated, and stored as its digits', () => {
    const random = prng(37)
    const digit = () => String(Math.floor(random() * 10))
    const lead = () => String(2 + Math.floor(random() * 8))
    for (let run = 0; run < RUNS; run++) {
      const area = lead() + digit() + digit()
      const exchange = lead() + digit() + digit()
      const line = digit() + digit() + digit() + digit()
      const phone = pick(random, [
        `${area}${exchange}${line}`,
        `(${area}) ${exchange}-${line}`,
        `${area}-${exchange}-${line}`,
        `${area}.${exchange}.${line}`,
        ` ${area} ${exchange} ${line} `,
      ])
      expect(accepted(checkRegistration({ ...valid, phone })).phone).toBe(`${area}${exchange}${line}`)
    }
  })

  it('no number whose area code or exchange starts 0 or 1 is accepted, nor any other length', () => {
    const random = prng(41)
    const digits = (n: number) => Array.from({ length: n }, () => String(Math.floor(random() * 10))).join('')
    for (let run = 0; run < RUNS; run++) {
      const bad = pick(random, ['0', '1'])
      const phone = pick(random, [
        `${bad}${digits(9)}`,
        `${2 + Math.floor(random() * 8)}${digits(2)}${bad}${digits(6)}`,
        digits(Math.floor(random() * 10)),
        `${digits(11 + Math.floor(random() * 5))}`,
      ])
      expect(refused(checkRegistration({ ...valid, phone })).rejections[0]?.field).toBe('phone')
    }
  })

  it('names of 1–100 characters pass and 101–200 are refused', () => {
    const random = prng(53)
    for (let run = 0; run < RUNS; run++) {
      const n = 1 + Math.floor(random() * 200)
      const name = Array.from({ length: n }, () => pick(random, ['a', 'é', '李', '😀'])).join('')
      expect(checkRegistration({ ...valid, lastName: name }).ok).toBe(n <= NAME_MAX)
    }
  })

  it('no refusal ever contains the submitted value', () => {
    const random = prng(67)
    for (let run = 0; run < RUNS; run++) {
      const field = pick(random, visitorFieldNames)
      const value = `SENTINEL${Math.floor(random() * 1e9)}${pick(random, ['\u0007', '\u202e', 'x'.repeat(300)])}`
      const text = JSON.stringify(refused(checkRegistration({ ...valid, [field]: value })))
      expect(text).not.toContain('SENTINEL')
    }
  })
})

describe('the scaffold helpers the validation sits beside', () => {
  it('formats a Date as whole UTC seconds, like epoch milliseconds', () => {
    expect(formatUtcSeconds(new Date(Date.UTC(2026, 9, 22, 8, 9, 10, 999)))).toBe('2026-10-22T08:09:10Z')
  })

  it('carries field errors in the AD-5 message envelope and names a required field', () => {
    expect(errorEnvelope('x', [{ path: 'email', message: 'y' }])).toEqual({
      error: { message: 'x', fields: [{ path: 'email', message: 'y' }] },
    })
    expect(messages.required('Email')).toBe('Email is required.')
  })
})
