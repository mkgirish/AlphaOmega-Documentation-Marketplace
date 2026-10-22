// CMP-2 — the single source of registration field rules, imported by packages/web and
// packages/api (AD-2, AD-3). Scaffold baseline: real, minimal shapes the stories extend.
import { z } from 'zod'

/** The registration input rules. Stories tighten and extend these. */
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
  firstNameTooLong: 'First name must be 100 characters or fewer.',
  lastNameTooLong: 'Last name must be 100 characters or fewer.',
} as const

/** Trim and collapse internal whitespace before validating or storing. */
export function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** The most characters a first or last name may hold once trimmed (ST-10). */
export const NAME_MAX_LENGTH = 100

/**
 * Count characters as a person (and PostgreSQL's varchar) does: by Unicode code point,
 * so an astral letter is one character, not two UTF-16 code units.
 */
export function characterCount(value: string): number {
  return Array.from(value).length
}

export type NameField = 'firstName' | 'lastName'

const nameRules = {
  firstName: { label: 'First name', tooLong: messages.firstNameTooLong },
  lastName: { label: 'Last name', tooLong: messages.lastNameTooLong },
} as const satisfies Record<NameField, { label: string; tooLong: string }>

/**
 * The one name rule (ST-10): trimmed, required, and at most NAME_MAX_LENGTH characters.
 * Only surrounding whitespace is removed: apostrophes, hyphens, accents and inner spacing
 * are kept exactly as typed (AC-1).
 * Returns the message to show under the field, or undefined when the name is acceptable.
 */
export function nameError(field: NameField, value: string): string | undefined {
  const rule = nameRules[field]
  const count = characterCount(value.trim())
  if (count === 0) return messages.required(rule.label)
  if (count > NAME_MAX_LENGTH) return rule.tooLong
  return undefined
}

function nameSchema(field: NameField) {
  const required = messages.required(nameRules[field].label)
  return z
    .string({ required_error: required, invalid_type_error: required })
    .transform((value) => value.trim())
    .superRefine((value, ctx) => {
      const message = nameError(field, value)
      if (message !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    })
}

/** First name as the screen and the API both parse it; the output is the value to store. */
export const firstName = nameSchema('firstName')

/** Last name as the screen and the API both parse it; the output is the value to store. */
export const lastName = nameSchema('lastName')

/** The visitor's two name fields; issues carry the field name as their path. */
export const visitorName = z.object({ firstName, lastName })

export type VisitorName = z.infer<typeof visitorName>

/** Format a Date (or epoch milliseconds) as whole UTC seconds, ISO-8601 with a Z. */
export function formatUtcSeconds(at: Date | number): string {
  const ms = new Date(at).getTime()
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}
