// ST-2 — the IF-2 request rules for POST /api/registrations: NFC, trim, phone separators
// stripped, then the per-field checks. CMP-2 still exports only the scaffold baseline
// (fullName/email), so the four-field rules live here until it carries them; the shared
// messages and formatUtcSeconds() are reused so both sides already agree on those.
import { messages } from '@app/shared'

export const FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const
export type Field = (typeof FIELDS)[number]

export type RegistrationRequest = Record<Field, string>
export type FieldErrors = Partial<Record<Field, string[]>>

export type Validation = { ok: true; value: RegistrationRequest } | { ok: false; fields: FieldErrors }

export const NAME_MAX = 100
export const EMAIL_MAX = 254

const LABELS: Readonly<Record<Field, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone number',
}

export const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

// C0/C1 controls, plus the bidi marks, embeddings, overrides and isolates.
const CONTROL_OR_BIDI = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u
const EMAIL =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/
const PHONE_SEPARATORS = /[\s\-.()]/g
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/

/** NFC then trim: the form every stored and echoed value takes. Idempotent. */
export function clean(value: string): string {
  return value.normalize('NFC').trim()
}

/** The phone as stored: cleaned, with spaces, dashes, dots and parentheses removed. */
export function cleanPhone(value: string): string {
  return clean(value).replace(PHONE_SEPARATORS, '')
}

function checkName(field: 'firstName' | 'lastName', value: string): string | undefined {
  if (value.length === 0) return messages.required(LABELS[field])
  if (CONTROL_OR_BIDI.test(value)) return `${LABELS[field]} contains characters that are not allowed.`
  if ([...value].length > NAME_MAX) return `${LABELS[field]} must be ${NAME_MAX} characters or fewer.`
  return undefined
}

function checkEmail(value: string): string | undefined {
  if (value.length === 0) return messages.required(LABELS.email)
  if (value.length > EMAIL_MAX) return `${LABELS.email} must be ${EMAIL_MAX} characters or fewer.`
  return EMAIL.test(value) ? undefined : messages.invalidEmail
}

function checkPhone(value: string): string | undefined {
  if (value.length === 0) return messages.required(LABELS.phone)
  return NANP.test(value) ? undefined : PHONE_MESSAGE
}

/**
 * Validates an already-parsed JSON body. A body that is not an object, or that carries a
 * property IF-2 does not define, fails with no per-field messages (fields {}).
 */
export function validateRegistration(body: unknown): Validation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, fields: {} }
  const record = body as Record<string, unknown>
  if (Object.keys(record).some((key) => !(FIELDS as readonly string[]).includes(key))) {
    return { ok: false, fields: {} }
  }
  const raw = (field: Field): string => {
    const value = record[field]
    return typeof value === 'string' ? value : ''
  }
  const value: RegistrationRequest = {
    firstName: clean(raw('firstName')),
    lastName: clean(raw('lastName')),
    email: clean(raw('email')),
    phone: cleanPhone(raw('phone')),
  }
  const problems: [Field, string | undefined][] = [
    ['firstName', checkName('firstName', value.firstName)],
    ['lastName', checkName('lastName', value.lastName)],
    ['email', checkEmail(value.email)],
    ['phone', checkPhone(value.phone)],
  ]
  const fields: FieldErrors = {}
  for (const [field, message] of problems) {
    if (message !== undefined) fields[field] = [message]
  }
  return Object.keys(fields).length === 0 ? { ok: true, value } : { ok: false, fields }
}
