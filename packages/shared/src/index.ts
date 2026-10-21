// CMP-2 — the single source of registration field rules, imported by packages/web and
// packages/api (AD-2, AD-3). Scaffold baseline: real, minimal shapes the stories extend.
import { z } from 'zod'

/** Human-facing messages, kept here so the screen and the API agree. */
export const messages = {
  required: (field: string) => `${field} is required.`,
  invalidEmail: 'Enter an email like name@example.com.',
} as const

/** The longest email address accepted, counted after trimming (ST-9 AC-3). */
export const EMAIL_MAX_LENGTH = 254

// local@domain.tld: a dot-atom local part (RFC 5322 atext, no leading, trailing or doubled
// dot), one or more hostname labels, and an alphabetic TLD of two or more letters. ASCII
// only, so control, bidi and zero-width characters can never pass.
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/

/** The email rule (ST-9): trimmed, at most 254 characters, local@domain.tld, one message for every failure. */
export const emailRule = z
  .string({ required_error: messages.invalidEmail, invalid_type_error: messages.invalidEmail })
  .trim()
  .refine((value) => value.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(value), { message: messages.invalidEmail })

/** Whether a value passes the email rule; parse with emailRule to get the trimmed address. */
export const isCompleteEmail = (value: unknown): boolean => emailRule.safeParse(value).success

/** The registration input rules. Stories tighten and extend these. */
export const registrationInput = z.object({
  fullName: z.string().min(1, messages.required('Full name')).max(200),
  email: emailRule,
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

/** AD-5 error envelope; `fields` is left out entirely rather than sent as undefined. */
export const errorEnvelope = (message: string, fields?: { path: string; message: string }[]): ErrorEnvelope => ({
  error: Object.fromEntries(Object.entries({ message, fields }).filter(([, value]) => value !== undefined)) as ErrorEnvelope['error'],
})

/** Trim and collapse internal whitespace before validating or storing. */
export function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** Format a Date (or epoch milliseconds) as whole UTC seconds, ISO-8601 with a Z. */
export function formatUtcSeconds(at: Date | number): string {
  const ms = new Date(at).getTime()
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}
