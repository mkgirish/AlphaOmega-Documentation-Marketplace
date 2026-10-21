// CMP-2 — the single source of registration field rules, imported by packages/web and
// packages/api (AD-2, AD-3). Scaffold baseline: real, minimal shapes the stories extend.
import { z } from 'zod'

/** The registration input rules. Stories tighten and extend these.
 * @deprecated The scaffold's two-field shape; use visitorRegistrationInput and validateRegistration(). */
export const registrationInput = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().max(320),
})

export type RegistrationInput = z.infer<typeof registrationInput>

export interface Registration extends RegistrationInput {
  id: string
  /** UTC seconds, formatted by formatUtcSeconds(). */
  createdAt: string
}

/** AD-5 success envelope. */
export interface DataEnvelope<T> {
  data: T
}

/** AD-5 error envelope. */
export interface ErrorEnvelope {
  error: {
    message: string
    fields?: { path: string; message: string }[]
  }
}

export const envelope = <T>(data: T): DataEnvelope<T> => ({ data })

export const errorEnvelope = (message: string, fields?: { path: string; message: string }[]): ErrorEnvelope => ({
  error: fields === undefined ? { message } : { message, fields },
})

/** Human-facing messages, kept here so the screen and the API agree. */
export const messages = {
  required: (field: string) => `${field} is required.`,
  invalidEmail: 'Enter a valid email address.',
} as const

/** Trim and collapse internal whitespace before validating or storing. */
export function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** The four visitor fields, in tab order (ST-3). */
export const registrationFields = ['firstName', 'lastName', 'email', 'phone'] as const

export type RegistrationField = (typeof registrationFields)[number]

export type RegistrationFieldErrors = Partial<Record<RegistrationField, string>>

/** The label each field shows on the screen. */
export const fieldLabels: Readonly<Record<RegistrationField, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone number',
}

/** The message each field shows directly under it when it is left empty (ST-3 AC-3). */
export const requiredMessages: Readonly<Record<RegistrationField, string>> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
}

/** The summary box text for a failed Submit: how many fields need attention. */
export function attentionSummary(count: number): string {
  return count === 1 ? '1 field needs attention. Check the messages below.' : `${count} fields need attention. Check the messages below.`
}

/**
 * Characters that render as nothing: control and format characters (zero-width, bidi, BOM),
 * the combining grapheme joiner and the Hangul and Braille fillers.
 */
const invisible = /[\p{Cc}\p{Cf}\u034f\u115f\u1160\u2800\u3164\uffa0]/gu

/** A value that is empty, only whitespace, or only invisible characters counts as empty (ST-3 AC-2). */
export function isBlank(value: string): boolean {
  return normalise(value.replace(invisible, '')) === ''
}

const requiredText = (field: RegistrationField) => {
  const message = requiredMessages[field]
  return z
    .string({ required_error: message, invalid_type_error: message })
    .refine((value) => !isBlank(value), { message })
    .transform(normalise)
}

/** The four-field registration rules, used by both the screen and the API. */
export const visitorRegistrationInput = z.object({
  firstName: requiredText('firstName'),
  lastName: requiredText('lastName'),
  email: requiredText('email'),
  phone: requiredText('phone'),
})

export type VisitorRegistrationInput = z.infer<typeof visitorRegistrationInput>

export type RegistrationValidation =
  | { success: true; data: VisitorRegistrationInput }
  | {
      success: false
      /** One message per invalid field. */
      errors: RegistrationFieldErrors
      /** The same messages as AD-5 field entries, in tab order. */
      fields: { path: RegistrationField; message: string }[]
      /** The first invalid field in tab order: where focus moves. */
      firstInvalid: RegistrationField
      /** The summary box text. */
      summary: string
    }

export type RegistrationFailure = Extract<RegistrationValidation, { success: false }>

/** Copy the four fields into a fresh plain object; a non-object or a throwing getter yields missing fields. */
function pickFields(input: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return body
  for (const field of registrationFields) {
    try {
      body[field] = (input as Record<string, unknown>)[field]
    } catch {
      // Leave the field missing: it is then reported with its required message.
    }
  }
  return body
}

/**
 * Validate a submission against the shared rules. Anything that is not a plain object is
 * treated as an empty one, so every field is named. Messages are fixed strings: nothing
 * submitted is ever echoed back.
 */
export function validateRegistration(input: unknown): RegistrationValidation {
  const parsed = visitorRegistrationInput.safeParse(pickFields(input))
  if (parsed.success) return { success: true, data: parsed.data }
  const errors: RegistrationFieldErrors = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as RegistrationField
    errors[field] ??= issue.message
  }
  const fields = registrationFields.flatMap((path) => {
    const message = errors[path]
    return message === undefined ? [] : [{ path, message }]
  })
  return { success: false, errors, fields, firstInvalid: fields[0].path, summary: attentionSummary(fields.length) }
}

/** The AD-5 400 body for a failed validation. */
export function validationErrorEnvelope(result: RegistrationFailure): ErrorEnvelope {
  return errorEnvelope(result.summary, result.fields)
}

/** Format a Date (or epoch milliseconds) as whole UTC seconds, ISO-8601 with a Z. */
export function formatUtcSeconds(at: Date | number): string {
  const ms = typeof at === 'number' ? at : at.getTime()
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}
