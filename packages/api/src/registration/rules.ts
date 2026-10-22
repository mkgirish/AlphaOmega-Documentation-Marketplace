// ST-10 — the registration field rules the API enforces. Names are accepted as written
// (apostrophes, hyphens, accents), trimmed with the shared normalise(), and limited to
// NAME_MAX characters, counted as Unicode code points so PostgreSQL's char_length agrees.
// These belong with CMP-2's shared rules; they live here until that package carries the
// first/last name fields, and the wording matches the screen's messages exactly.
import { messages, normalise } from '@app/shared'
import { z } from 'zod'

export const NAME_MAX = 100
export const EMAIL_MAX = 254

export const nameMessages = {
  firstName: {
    required: messages.required('First name'),
    tooLong: `First name must be ${NAME_MAX} characters or fewer.`,
    hidden: 'First name contains a character that cannot be shown.',
  },
  lastName: {
    required: messages.required('Last name'),
    tooLong: `Last name must be ${NAME_MAX} characters or fewer.`,
    hidden: 'Last name contains a character that cannot be shown.',
  },
} as const

export const INVALID_PHONE = 'Enter a valid phone number.'
export const UNKNOWN_FIELD = 'The request contains a field that is not accepted.'
export const UNREADABLE_BODY = 'The request could not be read.'

export interface RegistrationFields {
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone: string
}

export interface FieldError {
  readonly path: string
  readonly message: string
}

export type Validation = { ok: true; value: RegistrationFields } | { ok: false; fields: FieldError[] }

/** Characters as a person counts them (code points), not UTF-16 code units. */
export function characterCount(value: string): number {
  return [...value].length
}

// Control characters, unpaired surrogates, invisible spaces and bidi overrides: a name made
// of them would look empty or misleading, and PostgreSQL refuses NUL outright. The zero-width
// joiner and non-joiner stay allowed: Persian and Indic names need them.
const HIDDEN = /[\p{Cc}\p{Cs}\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/u

// NANP: optional +1, then a 10-digit number whose area code and exchange start 2–9.
const NANP = /^(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})$/

const text = (required: string) => z.string({ required_error: required, invalid_type_error: required }).transform(normalise)

const personName = (field: keyof typeof nameMessages) =>
  text(nameMessages[field].required)
    .refine((value) => value.length > 0, nameMessages[field].required)
    .refine((value) => !HIDDEN.test(value), nameMessages[field].hidden)
    .refine((value) => characterCount(value) <= NAME_MAX, nameMessages[field].tooLong)

const schema = z.object({
  firstName: personName('firstName'),
  lastName: personName('lastName'),
  email: text(messages.required('Email'))
    .refine((value) => value.length > 0, messages.required('Email'))
    .refine((value) => value.length <= EMAIL_MAX && z.string().email().safeParse(value).success, messages.invalidEmail),
  phone: text(messages.required('Phone'))
    .refine((value) => value.length > 0, messages.required('Phone'))
    .refine((value) => NANP.test(value), INVALID_PHONE),
})

const FIELD_ORDER: readonly string[] = Object.keys(schema.shape)

/**
 * Validates a submitted body. Messages are fixed strings: neither a submitted value nor an
 * unknown key ever appears in the result's errors, only in the accepted value itself.
 */
export function validateRegistration(body: unknown): Validation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, fields: [{ path: '', message: UNREADABLE_BODY }] }
  }
  if (Object.keys(body).some((key) => !FIELD_ORDER.includes(key))) {
    return { ok: false, fields: [{ path: '', message: UNKNOWN_FIELD }] }
  }
  const result = schema.safeParse(body)
  if (result.success) {
    return { ok: true, value: result.data }
  }
  // One message per field, the first rule it breaks, in the order the form shows them.
  const fields = FIELD_ORDER.flatMap((path) => {
    const issue = result.error.issues.find((i) => i.path[0] === path)
    return issue === undefined ? [] : [{ path, message: issue.message }]
  })
  return { ok: false, fields }
}
