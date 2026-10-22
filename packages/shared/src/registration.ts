// ST-2 — the four visitor fields, their normalisation, the 201 body and the confirmation
// copy. packages/web and packages/api import these; neither defines its own (AD-3).
import { z } from 'zod'
import { formatUtcSeconds, normalise } from './format.js'

export const fieldLimits = {
  nameMax: 100,
  emailMax: 254,
} as const

/** The four visitor fields, in the order the form shows them. */
export const registrationFields = ['firstName', 'lastName', 'email', 'phone'] as const

export type RegistrationField = (typeof registrationFields)[number]

/** The on-screen label of each field. */
export const fieldLabels: Readonly<Record<RegistrationField, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone number',
}

/** Field-level messages. They name the rule, never the submitted value. */
export const fieldMessages = {
  firstName: {
    required: 'Enter your first name.',
    tooLong: `First name must be ${fieldLimits.nameMax} characters or fewer.`,
    invalid: 'First name contains characters that are not allowed.',
  },
  lastName: {
    required: 'Enter your last name.',
    tooLong: `Last name must be ${fieldLimits.nameMax} characters or fewer.`,
    invalid: 'Last name contains characters that are not allowed.',
  },
  email: {
    required: 'Enter an email like name@example.com.',
    tooLong: `Email address must be ${fieldLimits.emailMax} characters or fewer.`,
    invalid: 'Enter a valid email address.',
  },
  phone: {
    required: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
    invalid: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
  },
} as const

/** The summary box shown above the form after a failed Submit (ST-3 AC-3). */
export function errorSummary(count: number): string {
  return count === 1 ? '1 field needs attention. Check the message below.' : `${count} fields need attention. Check the messages below.`
}

/** The confirmation that replaces the form once the API answers 201 (AC-1, AC-4, AC-6). */
export const confirmation = {
  heading: (firstName: string) => `Thank you, ${firstName}!`,
  body: 'Your visit has been registered.',
  registerAnother: 'Register another visitor',
  pageTitle: 'Registration complete',
  submitting: 'Submitting…',
} as const

// C0/C1 controls (including DEL), the Unicode bidi marks, embeddings, overrides and isolates,
// and the invisible zero-width space, word joiner and byte-order mark.
const forbidden = /[\p{Cc}\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u

// Characters that render as nothing: format controls (zero-width, bidi, soft hyphen) and the
// blank Hangul, Braille and Mongolian fillers. A value of only these and whitespace is empty.
const invisible = /[\p{Cc}\p{Cf}\u115f\u1160\u180e\u2800\u3164\uffa0]/gu

/** True when a value holds nothing visible: empty, only spaces, or only invisible characters (ST-3 AC-2). */
const isBlank = (value: string): boolean => value.replace(invisible, '').trim() === ''

// NANP: an area code and exchange each starting 2-9, then four digits.
const nanp = /^[2-9]\d{2}[2-9]\d{6}$/

/** Strip a NANP number to its ten digits, or null when it is not one. */
export function normalisePhone(value: string): string | null {
  const trimmed = value.trim()
  // A leading + must carry the NANP country code 1.
  if (!/^(?:\+1)?[\d\s().-]+$/.test(trimmed)) return null
  let digits = trimmed.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  return nanp.test(digits) ? digits : null
}

const text = (messages: { required: string }) => z.string({ required_error: messages.required, invalid_type_error: messages.required })

const name = (messages: (typeof fieldMessages)['firstName' | 'lastName']) =>
  text(messages).transform((raw, ctx) => {
    const trimmed = raw.normalize('NFC').trim()
    const fail = (message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message })
      return z.NEVER
    }
    if (isBlank(trimmed)) return fail(messages.required)
    if (forbidden.test(trimmed)) return fail(messages.invalid)
    const value = normalise(trimmed)
    // Count code points, so a name in astral-plane script is not cut short.
    if ([...value].length > fieldLimits.nameMax) return fail(messages.tooLong)
    return value
  })

const emailFormat = z.string().email()

const email = text(fieldMessages.email).transform((raw, ctx) => {
  const value = raw.trim()
  const fail = (message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    return z.NEVER
  }
  if (isBlank(value)) return fail(fieldMessages.email.required)
  if (value.length > fieldLimits.emailMax) return fail(fieldMessages.email.tooLong)
  if (forbidden.test(value) || !emailFormat.safeParse(value).success) return fail(fieldMessages.email.invalid)
  return value
})

const phone = text(fieldMessages.phone).transform((raw, ctx) => {
  const fail = (message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    return z.NEVER
  }
  if (isBlank(raw)) return fail(fieldMessages.phone.required)
  return normalisePhone(raw) ?? fail(fieldMessages.phone.invalid)
})

/** The POST /api/registrations body: parsed values come out trimmed and normalised (AC-3). */
export const registrationRequest = z
  .object({
    firstName: name(fieldMessages.firstName),
    lastName: name(fieldMessages.lastName),
    email,
    phone,
  })
  .strict()

export type RegistrationRequestInput = z.input<typeof registrationRequest>
export type RegistrationRequest = z.output<typeof registrationRequest>

/** True for an ISO 8601 UTC timestamp in whole seconds, e.g. 2026-10-20T14:03:27Z. */
export function isUtcSeconds(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false
  const ms = Date.parse(value)
  return !Number.isNaN(ms) && formatUtcSeconds(ms) === value
}

/** The 201 body's data: the visitor's first name and when the visit was saved, no row id (AC-5). */
export const createdResponse = z
  .object({
    firstName: z.string().min(1),
    createdAt: z.string().refine(isUtcSeconds),
  })
  .strict()

export type CreatedResponse = z.infer<typeof createdResponse>

export const registrationCreatedEnvelope = z.object({ data: createdResponse }).strict()

export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        message: z.string(),
        fields: z.array(z.object({ path: z.string(), message: z.string() }).strict()).optional(),
      })
      .strict(),
  })
  .strict()

/** Build the 201 body from a stored row, picking only what the visitor may see. */
export function toCreatedResponse(row: { firstName: string; createdAt: Date | string }): { data: CreatedResponse } {
  // Re-format strings too, so a driver's 'YYYY-MM-DD HH:MM:SS+00' or milliseconds never reach the body.
  const at = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : row.createdAt
  return { data: { firstName: row.firstName, createdAt: formatUtcSeconds(at) } }
}

/** Field errors keyed by field, in form order: one message each, never a submitted value. */
export type FieldErrors = Partial<Record<RegistrationField, string[]>>

export type RegistrationValidation =
  { readonly ok: true; readonly value: RegistrationRequest } | { readonly ok: false; readonly fields: FieldErrors }

/** Map the schema's issues to the first message of each named field, in form order. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {}
  for (const field of registrationFields) {
    const issue = error.issues.find((i) => i.path[0] === field)
    if (issue !== undefined) fields[field] = [issue.message]
  }
  return fields
}

/**
 * Validate a body against the shared rules, so the screen and the API refuse the same input
 * with the same messages. A blank or whitespace-only field is empty (ST-3 AC-1, AC-2, AC-6).
 */
export function validateRegistration(body: unknown): RegistrationValidation {
  const parsed = registrationRequest.safeParse(body)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, fields: fieldErrors(parsed.error) }
}

/** The first flagged field in form order: where focus moves after a failed Submit (ST-3 AC-3). */
export function firstInvalidField(fields: FieldErrors): RegistrationField | null {
  return registrationFields.find((field) => (fields[field]?.length ?? 0) > 0) ?? null
}
