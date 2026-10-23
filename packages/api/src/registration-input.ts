// ST-2 — the IF-2 request rules for POST /api/registrations: NFC, trim, phone separators
// stripped, then 1–100 code-point names free of control and bidi characters, an ASCII
// email of at most 254 characters and a NANP number. The name and email-format messages
// come from CMP-2; the remaining IF-2 rules are kept here, in the one module the route uses.
// ST-3 — a field that is missing, not a string or only whitespace is empty, and is named
// with the message the screen shows under it (AC-3, AC-6).
import { fieldMessages, messages } from '@app/shared'

export type RegistrationField = 'firstName' | 'lastName' | 'email' | 'phone'

export interface NormalisedRegistration {
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone: string
}

export type RegistrationParse =
  | { readonly ok: true; readonly value: NormalisedRegistration }
  | { readonly ok: false; readonly fields: Partial<Record<RegistrationField, string[]>> }

const FIELDS: readonly RegistrationField[] = ['firstName', 'lastName', 'email', 'phone']

const NAME_MAX = 100
const EMAIL_MAX = 254

// C0/C1 controls and the Unicode bidi marks, embeddings, overrides and isolates.
const FORBIDDEN = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u
const EMAIL =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/
const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const PHONE_SEPARATORS = /[ .()-]/g
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/

function nameRule(label: string) {
  return (value: string): string | null => {
    if ([...value].length > NAME_MAX) return `${label} must be ${NAME_MAX} characters or fewer.`
    if (FORBIDDEN.test(value)) return `${label} cannot contain control or text-direction characters.`
    return null
  }
}

const RULES: Readonly<
  Record<RegistrationField, { required: string; normalise: (value: string) => string; check: (value: string) => string | null }>
> = {
  firstName: { required: fieldMessages.firstName.required, normalise: (v) => v.normalize('NFC').trim(), check: nameRule('First name') },
  lastName: { required: fieldMessages.lastName.required, normalise: (v) => v.normalize('NFC').trim(), check: nameRule('Last name') },
  email: {
    required: 'Enter an email like name@example.com.',
    normalise: (v) => v.trim(),
    check: (v) => {
      if (v.length > EMAIL_MAX) return `Email must be ${EMAIL_MAX} characters or fewer.`
      return EMAIL.test(v) ? null : messages.invalidEmail
    },
  },
  phone: {
    required: PHONE_MESSAGE,
    normalise: (v) => v.trim().replace(PHONE_SEPARATORS, ''),
    check: (v) => (NANP.test(v) ? null : PHONE_MESSAGE),
  },
}

/** Validates and normalises a request body. Messages never contain a submitted value. */
export function parseRegistration(body: unknown): RegistrationParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, fields: {} }
  const record = body as Record<string, unknown>
  if (Object.keys(record).some((key) => !(FIELDS as readonly string[]).includes(key))) return { ok: false, fields: {} }

  const fields: Partial<Record<RegistrationField, string[]>> = {}
  const value: Partial<Record<RegistrationField, string>> = {}
  for (const field of FIELDS) {
    const rule = RULES[field]
    const raw = record[field]
    const normalised = typeof raw === 'string' ? rule.normalise(raw) : ''
    const problem = normalised === '' ? rule.required : rule.check(normalised)
    if (problem === null) value[field] = normalised
    else fields[field] = [problem]
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields }
  return { ok: true, value: value as NormalisedRegistration }
}
