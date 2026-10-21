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

/** Format a Date (or epoch milliseconds) as whole UTC seconds, ISO-8601 with a Z. */
export function formatUtcSeconds(at: Date | number): string {
  const ms = new Date(at).getTime()
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}

// ST-10 — the name rules shared by the screen (CMP-1) and the API (CMP-3): names are taken
// as written (apostrophes, hyphens, accents), trimmed, and capped at 100 characters.

/** The longest first or last name accepted, in characters (Unicode code points). */
export const NAME_MAX_LENGTH = 100

/** Length in characters, so an accented or astral character counts once, as PostgreSQL counts it. */
export function nameLength(value: string): number {
  return [...value].length
}

const nameRule = (label: string, tooLong: string) =>
  z
    .string({ required_error: messages.required(label), invalid_type_error: messages.required(label) })
    .transform(normalise)
    .pipe(
      z
        .string()
        .min(1, messages.required(label))
        .refine((value) => nameLength(value) <= NAME_MAX_LENGTH, tooLong),
    )

export const firstName = nameRule('First name', messages.firstNameTooLong)
export const lastName = nameRule('Last name', messages.lastNameTooLong)

/** The two name fields, as the screen and POST /api/registrations name them. */
export const nameFields = z.object({ firstName, lastName })

export type NameFields = z.infer<typeof nameFields>

/** AD-5 field errors from a failed parse: the first message per field, never the submitted value. */
export function toFieldErrors(error: z.ZodError): { path: string; message: string }[] {
  const seen = new Map<string, string>()
  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (!seen.has(path)) seen.set(path, issue.message)
  }
  return [...seen].map(([path, message]) => ({ path, message }))
}
