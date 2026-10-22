// ST-11 — the registration rules POST /api/registrations applies itself, so a client that
// bypasses the screen is held to the same fields. Normalisation and the email message come
// from CMP-2; the four-field rules move there once its schema carries these fields.
import { z } from 'zod'
import { messages, normalise } from '@app/shared'

export const FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const
export type Field = (typeof FIELDS)[number]

export const NAME_MAX = 100
export const EMAIL_MAX = 254
export const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

export type FieldRule = 'required' | 'type' | 'too_long' | 'characters' | 'email' | 'phone'
export type BodyRule = 'not_object' | 'unknown_field'

export interface RegistrationFields {
  firstName: string
  lastName: string
  email: string
  phone: string
}

/** A field failure names the field; a body failure (field null) names nothing the client sent. */
export type Failure = { field: Field; rule: FieldRule; message: string } | { field: null; rule: BodyRule; message: '' }

export type Validation = { ok: true; value: RegistrationFields } | { ok: false; failures: Failure[] }

// Each field's messages; a rule without its own message (type) falls back to required.
const MESSAGES: Readonly<Record<Field, { required: string } & Partial<Record<FieldRule, string>>>> = {
  firstName: {
    required: 'Enter your first name.',
    too_long: `First name must be ${NAME_MAX} characters or fewer.`,
    characters: 'First name contains characters that are not allowed.',
  },
  lastName: {
    required: 'Enter your last name.',
    too_long: `Last name must be ${NAME_MAX} characters or fewer.`,
    characters: 'Last name contains characters that are not allowed.',
  },
  email: {
    required: 'Enter your email address.',
    too_long: `Email must be ${EMAIL_MAX} characters or fewer.`,
    email: messages.invalidEmail,
  },
  phone: {
    required: 'Enter your phone number.',
    phone: PHONE_MESSAGE,
  },
}

// C0/C1 controls and format characters (bidi overrides, zero-width joiners and spaces).
const DISALLOWED = /[\p{Cc}\p{Cf}]/u
const EMAIL = z.string().email()
// NANP: area code and exchange each start 2-9; punctuation the screen allows is stripped.
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/
const PHONE_PUNCTUATION = /[\s().-]/g

type Check = (value: string) => FieldRule | null

const nameCheck: Check = (value) => (value.length > NAME_MAX ? 'too_long' : DISALLOWED.test(value) ? 'characters' : null)

const CHECKS: Readonly<Record<Field, Check>> = {
  firstName: nameCheck,
  lastName: nameCheck,
  email: (value) => (value.length > EMAIL_MAX ? 'too_long' : EMAIL.safeParse(value).success ? null : 'email'),
  phone: (value) => (NANP.test(value) ? null : 'phone'),
}

function clean(field: Field, value: string): string {
  return field === 'phone' ? value.replace(PHONE_PUNCTUATION, '') : normalise(value)
}

export function validateRegistration(body: unknown): Validation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, failures: [{ field: null, rule: 'not_object', message: '' }] }
  }
  const record = body as Record<string, unknown>
  if (Object.keys(record).some((key) => !(FIELDS as readonly string[]).includes(key))) {
    return { ok: false, failures: [{ field: null, rule: 'unknown_field', message: '' }] }
  }
  const value: Partial<RegistrationFields> = {}
  const failures: Failure[] = []
  for (const field of FIELDS) {
    const raw = record[field]
    const cleaned = typeof raw === 'string' ? clean(field, raw) : raw
    const rule: FieldRule | null =
      cleaned === undefined || cleaned === '' ? 'required' : typeof cleaned !== 'string' ? 'type' : CHECKS[field](cleaned)
    if (rule === null) value[field] = cleaned as string
    else failures.push({ field, rule, message: MESSAGES[field][rule] ?? MESSAGES[field].required })
  }
  return failures.length === 0 ? { ok: true, value: value as RegistrationFields } : { ok: false, failures }
}
