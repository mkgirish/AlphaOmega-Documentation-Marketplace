// ST-11 — the four visitor field rules the API enforces whatever sends the request, and the
// AD-5 validation envelope it answers with (AC-1 to AC-3, AC-5). The screen reads the same
// messages, so a refusal from either side names the field the same way (AC-6).
import { z } from 'zod'
import { normalise } from './index.js'

/** The four visitor fields, in the order the screen shows them. */
export const visitorFieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type VisitorField = (typeof visitorFieldNames)[number]

export type VisitorRegistration = Record<VisitorField, string>

/** Longest first or last name, in characters (code points) after normalising. */
export const NAME_MAX = 100

/** Longest email address (RFC 5321 path limit less the angle brackets). */
export const EMAIL_MAX = 254

/** The registration endpoint refuses request bodies above this many bytes with 413 (AC-4). */
export const REGISTRATION_BODY_LIMIT = 4 * 1024

/** Why a value was refused. Logged as-is: it names the rule, never the value (AC-5). */
export type FieldRule = 'required' | 'type' | 'too_long' | 'characters' | 'format'

/** Why the body as a whole was refused, before or beside any field. */
export type BodyRule = 'shape' | 'unknown_field'

export type Rejection = { field: VisitorField; rule: FieldRule } | { field: 'body'; rule: BodyRule }

export const fieldMessages: Readonly<Record<VisitorField, Readonly<Record<FieldRule, string>>>> = {
  firstName: {
    required: 'Enter your first name.',
    type: 'Enter your first name.',
    too_long: `First name must be ${NAME_MAX} characters or fewer.`,
    characters: 'First name contains characters that are not allowed.',
    format: 'Enter your first name.',
  },
  lastName: {
    required: 'Enter your last name.',
    type: 'Enter your last name.',
    too_long: `Last name must be ${NAME_MAX} characters or fewer.`,
    characters: 'Last name contains characters that are not allowed.',
    format: 'Enter your last name.',
  },
  email: {
    required: 'Enter your email address.',
    type: 'Enter your email address.',
    too_long: `Email must be ${EMAIL_MAX} characters or fewer.`,
    characters: 'Email contains characters that are not allowed.',
    format: 'Enter a valid email address.',
  },
  phone: {
    required: 'Enter your phone number.',
    type: 'Enter your phone number.',
    too_long: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
    characters: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
    format: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
  },
}

// Controls, format characters (bidi overrides and isolates, zero-width and soft hyphen,
// tags), lone surrogates and the Hangul fillers: anything that would make a stored value
// display differently from what was typed, or look filled in while showing nothing.
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\u115f\u1160\u3164\uffa0]/u

// Tab, CR and LF are whitespace a pasted value may carry: collapsed or trimmed, not refused.
const PASTED_WHITESPACE = /[\t\n\r]/g

// Separators a visitor may type inside a phone number; anything else is refused.
const PHONE_SEPARATORS = /[ \t\n\r().-]/g

// NANP: area code and exchange each start 2–9 (AC-2: "5550132" is too short).
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/

// RFC 5321: a local part of at most 64 octets and domain labels of at most 63.
const LOCAL_MAX = 64
const LABEL_MAX = 63

const EMAIL = z.string().email()

type Checked = { value: string } | { rule: FieldRule }

const length = (value: string): number => [...value].length

/** The checks every field shares: present, a string, and free of forbidden characters. */
function precheck(raw: unknown): { rule: FieldRule } | undefined {
  if (raw === undefined || raw === null) return { rule: 'required' }
  if (typeof raw !== 'string') return { rule: 'type' }
  if (FORBIDDEN.test(raw.replace(PASTED_WHITESPACE, ' '))) return { rule: 'characters' }
  return undefined
}

function checkName(raw: unknown): Checked {
  const refused = precheck(raw)
  if (refused) return refused
  // NFC first, so a name's length does not depend on how its accents were encoded.
  const value = normalise((raw as string).normalize('NFC'))
  if (value === '') return { rule: 'required' }
  if (length(value) > NAME_MAX) return { rule: 'too_long' }
  return { value }
}

function emailPartsFit(value: string): boolean {
  const at = value.lastIndexOf('@')
  return (
    at <= LOCAL_MAX &&
    value
      .slice(at + 1)
      .split('.')
      .every((label) => label.length <= LABEL_MAX)
  )
}

function checkEmail(raw: unknown): Checked {
  const refused = precheck(raw)
  if (refused) return refused
  const value = (raw as string).trim()
  if (value === '') return { rule: 'required' }
  if (length(value) > EMAIL_MAX) return { rule: 'too_long' }
  if (!EMAIL.safeParse(value).success || !emailPartsFit(value)) return { rule: 'format' }
  return { value }
}

function checkPhone(raw: unknown): Checked {
  const refused = precheck(raw)
  if (refused) return refused
  const trimmed = (raw as string).trim()
  if (trimmed === '') return { rule: 'required' }
  const value = trimmed.replace(PHONE_SEPARATORS, '')
  if (!NANP.test(value)) return { rule: 'format' }
  return { value }
}

const checks: Readonly<Record<VisitorField, (raw: unknown) => Checked>> = {
  firstName: checkName,
  lastName: checkName,
  email: checkEmail,
  phone: checkPhone,
}

function field(name: VisitorField) {
  return z.unknown().transform((raw, ctx): string => {
    const checked = checks[name](raw)
    if ('value' in checked) return checked.value
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: fieldMessages[name][checked.rule], params: { rule: checked.rule } })
    return z.NEVER
  })
}

/**
 * The registration request as the API accepts it: exactly the four visitor fields, each
 * normalised (names trimmed and collapsed, email trimmed, phone reduced to its 10 digits).
 * Any other key refuses the whole body (AC-3).
 */
export const registrationRequest = z
  .object({
    firstName: field('firstName'),
    lastName: field('lastName'),
    email: field('email'),
    phone: field('phone'),
  })
  .strict()

export type FieldErrorMap = Partial<Record<VisitorField, string[]>>

/** AD-5 validation envelope (AC-1): one list of messages per invalid field, nothing else. */
export interface ValidationEnvelope {
  error: 'validation'
  fields: FieldErrorMap
}

export const validationEnvelope = (fields: FieldErrorMap = {}): ValidationEnvelope => ({ error: 'validation', fields })

export type RegistrationCheck =
  { ok: true; value: VisitorRegistration } | { ok: false; envelope: ValidationEnvelope; rejections: Rejection[] }

const isVisitorField = (key: unknown): key is VisitorField => visitorFieldNames.includes(key as VisitorField)

/**
 * Validate a parsed request body. On refusal, returns the envelope to send and the
 * field/rule pairs to log — neither carries a submitted value or an unexpected key's name.
 */
export function checkRegistration(body: unknown): RegistrationCheck {
  const parsed = registrationRequest.safeParse(body)
  if (parsed.success) return { ok: true, value: parsed.data }

  const fields: FieldErrorMap = {}
  const rejections: Rejection[] = []
  for (const issue of parsed.error.issues) {
    const key = issue.path[0]
    if (issue.code === z.ZodIssueCode.custom && isVisitorField(key)) {
      fields[key] = [issue.message]
      rejections.push({ field: key, rule: (issue.params as { rule: FieldRule }).rule })
    } else if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      rejections.push({ field: 'body', rule: 'unknown_field' })
    } else {
      rejections.push({ field: 'body', rule: 'shape' })
    }
  }
  return { ok: false, envelope: validationEnvelope(fields), rejections }
}

/**
 * Parse and validate a raw JSON request body. Text that is not JSON is refused with empty
 * fields (AC-3), so the parser's message — which can quote the body — never reaches a client.
 */
export function checkRegistrationJson(text: string): RegistrationCheck {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { ok: false, envelope: validationEnvelope(), rejections: [{ field: 'body', rule: 'shape' }] }
  }
  return checkRegistration(body)
}
