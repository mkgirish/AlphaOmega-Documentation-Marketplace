// ST-2 — the four visitor fields the kiosk submits (AD-2, AD-3): one Zod schema both the
// screen and the API parse with, the 201 response shape and the confirmation wording.
import { z } from 'zod'
import { formatUtcSeconds, normalise } from './format.js'

export const limits = { nameMax: 100, emailMax: 254 } as const

/** Field messages. Constant strings only: no message ever repeats a submitted value. */
export const fieldMessages = {
  firstName: {
    required: 'Enter your first name.',
    tooLong: `First name must be ${limits.nameMax} characters or fewer.`,
    invalid: 'First name contains characters that are not allowed.',
  },
  lastName: {
    required: 'Enter your last name.',
    tooLong: `Last name must be ${limits.nameMax} characters or fewer.`,
    invalid: 'Last name contains characters that are not allowed.',
  },
  email: {
    required: 'Enter your email address.',
    tooLong: `Email must be ${limits.emailMax} characters or fewer.`,
    invalid: 'Enter a valid email address.',
  },
  phone: {
    required: 'Enter your phone number.',
    invalid: 'Enter a 10-digit US phone number, e.g. (415) 555-0132.',
  },
  unknownField: 'The request contains a field that is not allowed.',
  notAnObject: 'The request body must be a JSON object.',
} as const

/** The confirmation that replaces the form once the API answers 201 (AC-1, AC-4, AC-6). */
export const confirmationCopy = {
  heading: (firstName: string) => `Thank you, ${firstName}!`,
  body: 'Your visit has been registered.',
  registerAnother: 'Register another visitor',
  title: 'Registration complete',
  submitting: 'Submitting…',
} as const

// C0/C1 controls (tab and newline included), lone surrogates, the Unicode bidi overrides,
// isolates and marks, and the invisible zero-width, joiner and soft-hyphen characters.
const controlOrBidi = /[\p{Cc}\p{Cs}\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u
const nanp = /^\s*(?:\+?1[\s.-]?)?(?:\(([2-9]\d{2})\)\s?|([2-9]\d{2})[\s.-]?)([2-9]\d{2})[\s.-]?(\d{4})\s*$/
const emailShape = z.string().email()

/** A US (NANP) number in any common format as its ten digits, or null when it is not one. */
export function normalisePhone(value: string): string | null {
  const match = nanp.exec(value)
  return match === null ? null : `${match[1] ?? match[2]}${match[3]}${match[4]}`
}

const text = (required: string) =>
  z.unknown().transform((value, ctx) => {
    if (typeof value === 'string') return value
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: required })
    return z.NEVER
  })

const name = (messages: (typeof fieldMessages)['firstName' | 'lastName']) =>
  text(messages.required).transform((raw, ctx) => {
    const value = normalise(raw)
    const issue =
      value === ''
        ? messages.required
        : controlOrBidi.test(raw)
          ? messages.invalid
          : [...value].length > limits.nameMax
            ? messages.tooLong
            : null
    if (issue === null) return value
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue })
    return z.NEVER
  })

const email = text(fieldMessages.email.required).transform((raw, ctx) => {
  const value = raw.trim()
  const m = fieldMessages.email
  const issue =
    value === '' ? m.required : value.length > limits.emailMax ? m.tooLong : emailShape.safeParse(value).success ? null : m.invalid
  if (issue === null) return value
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue })
  return z.NEVER
})

const phone = text(fieldMessages.phone.required).transform((raw, ctx) => {
  const value = normalisePhone(raw)
  if (value !== null) return value
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: raw.trim() === '' ? fieldMessages.phone.required : fieldMessages.phone.invalid })
  return z.NEVER
})

/** POST /api/registrations body: parses to the trimmed, normalised values that are stored. */
export const registrationRequest = z
  .object(
    { firstName: name(fieldMessages.firstName), lastName: name(fieldMessages.lastName), email, phone },
    { errorMap: () => ({ message: fieldMessages.notAnObject }) },
  )
  .strict(fieldMessages.unknownField)

/** The four values as the visitor typed them, before parsing. */
export interface RegistrationRequest {
  firstName: string
  lastName: string
  email: string
  phone: string
}
export type NormalisedRegistration = z.output<typeof registrationRequest>

/** The AD-5 `fields` list for a failed parse; paths name fields, messages are constants. */
export function fieldErrors(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/** Whole-second UTC ISO 8601, e.g. 2026-10-20T14:03:27Z. */
export const utcSecondsPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** The 201 body's data: the visitor's first name and when the visit was saved, never the row id. */
export const registrationCreated = z.object({ firstName: z.string().min(1), createdAt: z.string().regex(utcSecondsPattern) }).strict()

export const registrationCreatedEnvelope = z.object({ data: registrationCreated }).strict()

export type RegistrationCreated = z.infer<typeof registrationCreated>

export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({ message: z.string(), fields: z.array(z.object({ path: z.string(), message: z.string() }).strict()).optional() })
      .strict(),
  })
  .strict()

/** Build the 201 envelope from a stored row; only firstName and createdAt are copied. */
export function toRegistrationCreated(row: {
  firstName: string
  createdAt: Date | number | string
}): z.infer<typeof registrationCreatedEnvelope> {
  const at = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : row.createdAt
  const ms = typeof at === 'number' ? at : at.getTime()
  if (Number.isNaN(ms)) throw new RangeError('createdAt is not a valid date')
  return { data: { firstName: row.firstName, createdAt: formatUtcSeconds(ms) } }
}
