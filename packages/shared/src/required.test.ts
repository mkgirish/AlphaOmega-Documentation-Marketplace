import { describe, expect, it } from 'vitest'
import {
  attentionSummary,
  emptyFields,
  fieldMessages,
  isBlank,
  registrationFields,
  registrationRequest,
  requiredMessages,
} from './index.js'

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

describe('requiredMessages — the ST-3 copy under each empty field (AC-3)', () => {
  it.each([
    ['firstName', 'Enter your first name.'],
    ['lastName', 'Enter your last name.'],
    ['email', 'Enter an email like name@example.com.'],
    ['phone', 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'],
  ] as const)('%s reads %j', (field, message) => {
    expect(requiredMessages[field]).toBe(message)
  })

  it('lists the four fields in screen order, first name first', () => {
    expect(registrationFields).toEqual(['firstName', 'lastName', 'email', 'phone'])
    expect(Object.keys(requiredMessages)).toEqual([...registrationFields])
  })

  it('gives the schema the same required message for the names and email', () => {
    for (const field of ['firstName', 'lastName', 'email'] as const) {
      expect(fieldMessages[field].required).toBe(requiredMessages[field])
      const parsed = registrationRequest.safeParse({ ...valid, [field]: '   ' })
      expect(parsed.success).toBe(false)
      if (!parsed.success) expect(parsed.error.issues.map((i) => [i.path.join('.'), i.message])).toEqual([[field, requiredMessages[field]]])
    }
  })
})

describe('attentionSummary() — the summary box (AC-3)', () => {
  it.each([
    [4, '4 fields need attention. Check the messages below.'],
    [3, '3 fields need attention. Check the messages below.'],
    [2, '2 fields need attention. Check the messages below.'],
    [1, '1 field needs attention. Check the messages below.'],
  ])('reads %j fields as %j', (count, text) => {
    expect(attentionSummary(count)).toBe(text)
  })

  it.each([0, -1, 1.5, Number.NaN])('has nothing to say for %j', (count) => {
    expect(attentionSummary(count)).toBe('')
  })
})

describe('isBlank() — empty or only whitespace counts as empty (AC-1, AC-2, AC-6)', () => {
  it.each(['', ' ', '   ', '\t', '\n', ' \t\r\n ', '\u00a0', '\u2003', '\u3000'])('treats %j as blank', (value) => {
    expect(isBlank(value)).toBe(true)
  })

  it.each([undefined, null, 42, true, {}, []])('treats a missing or non-string value %j as blank', (value) => {
    expect(isBlank(value)).toBe(true)
  })

  it.each(['a', ' a ', '0', '\u200b', '.'])('treats %j as filled', (value) => {
    expect(isBlank(value)).toBe(false)
  })

  it('agrees with the schema: a blank field always fails with its required message (property)', () => {
    const pads = ['', ' ', '  ', '\t', ' \t ', '\u00a0', '   \n']
    for (const field of registrationFields) {
      for (const pad of pads) {
        const parsed = registrationRequest.safeParse({ ...valid, [field]: pad })
        expect(isBlank(pad)).toBe(true)
        expect(parsed.success).toBe(false)
        if (!parsed.success) expect(parsed.error.issues.map((i) => i.message)).toEqual([fieldMessages[field].required])
      }
    }
  })
})

describe('emptyFields() — which fields stop the Submit, in screen order (AC-1 to AC-6)', () => {
  it('finds nothing when every field is filled', () => {
    expect(emptyFields(valid)).toEqual([])
  })

  it.each(registrationFields)('stops on an empty %s alone', (field) => {
    expect(emptyFields({ ...valid, [field]: '' })).toEqual([{ field, message: requiredMessages[field] }])
  })

  it('treats a last name of only spaces as empty (AC-2)', () => {
    expect(emptyFields({ ...valid, lastName: '   ' })).toEqual([{ field: 'lastName', message: 'Enter your last name.' }])
  })

  it('lists all four for an empty form, first name first (AC-3)', () => {
    const empty = emptyFields({ firstName: '', lastName: '', email: '', phone: '' })
    expect(empty.map((e) => e.field)).toEqual(['firstName', 'lastName', 'email', 'phone'])
    expect(empty.map((e) => e.message)).toEqual([
      'Enter your first name.',
      'Enter your last name.',
      'Enter an email like name@example.com.',
      'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
    ])
    expect(attentionSummary(empty.length)).toBe('4 fields need attention. Check the messages below.')
  })

  it('names only the phone when the other three are typed, so focus goes there (AC-5)', () => {
    const typed = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' }
    expect(emptyFields(typed)).toEqual([{ field: 'phone', message: requiredMessages.phone }])
    expect(typed).toEqual({ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' })
  })

  it('keeps screen order whatever order the keys arrive in', () => {
    expect(emptyFields({ phone: ' ', email: 'a@b.co', lastName: '', firstName: '\t' }).map((e) => e.field)).toEqual([
      'firstName',
      'lastName',
      'phone',
    ])
  })

  it('treats a missing, null or non-string field as empty, as a raw JSON body may send (AC-6)', () => {
    expect(emptyFields({ firstName: 'Jane', lastName: null, email: 7 }).map((e) => e.field)).toEqual(['lastName', 'email', 'phone'])
  })

  it.each([null, undefined, 'Jane', 42, ['Jane']])('flags all four for a body %j that is not an object', (body) => {
    expect(emptyFields(body).map((e) => e.field)).toEqual([...registrationFields])
  })

  it('checks only emptiness, leaving format rules to the schema', () => {
    expect(emptyFields({ firstName: 'J', lastName: 'D', email: 'not-an-email', phone: '12' })).toEqual([])
  })

  it('never echoes a submitted value in a message', () => {
    const sentinel = 'SENTINEL-☃'
    const out = JSON.stringify(emptyFields({ firstName: sentinel, lastName: ' ', email: sentinel, phone: '' }))
    expect(out).not.toContain('SENTINEL')
  })

  it('agrees with the schema on which fields are blank (property)', () => {
    const choices = ['', ' ', '\t ', 'x', ' Jane ']
    let seed = 7
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return choices[seed % choices.length] as string
    }
    for (let i = 0; i < 200; i++) {
      const body = { firstName: next(), lastName: next(), email: next(), phone: next() }
      const blank = emptyFields(body).map((e) => e.field)
      const parsed = registrationRequest.safeParse(body)
      const required = parsed.success
        ? []
        : parsed.error.issues.filter((iss) => iss.message === fieldMessages[iss.path[0] as keyof typeof fieldMessages].required)
      expect(required.map((iss) => iss.path[0])).toEqual(blank)
    }
  })
})
