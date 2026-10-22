// CMP-2 — the single source of registration field rules, imported by packages/web and
// packages/api (AD-2, AD-3). Scaffold baseline: real, minimal shapes the stories extend.
import { z } from 'zod'

/** Human-facing messages, kept here so the screen and the API agree. */
export const messages = {
  required: (field: string) => `${field} is required.`,
  invalidEmail: 'Enter an email like name@example.com.',
} as const

/** ST-9 AC-3 — the longest email accepted, counted after trimming. */
export const EMAIL_MAX_LENGTH = 254

// local@domain.tld: a dot-atom local part, LDH domain labels of 1–63 characters, and a
// letters-only (or xn-- punycode) TLD of at least two. ASCII only, so control and bidi characters never pass.
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const TOP_LEVEL = /^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/

/** ST-9 — true when the (already trimmed) value is a complete local@domain.tld address of at most 254 characters. */
export function isCompleteEmail(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > EMAIL_MAX_LENGTH) return false
  const at = value.indexOf('@')
  if (at < 0 || at !== value.lastIndexOf('@')) return false
  const labels = value.slice(at + 1).split('.')
  return (
    LOCAL_PART.test(value.slice(0, at)) &&
    labels.length >= 2 &&
    labels.every((label) => DOMAIN_LABEL.test(label)) &&
    TOP_LEVEL.test(labels[labels.length - 1])
  )
}

/** ST-9 — the email rule: trimmed, then held to isCompleteEmail with the one message. */
export const emailSchema = z
  .string({ required_error: messages.invalidEmail, invalid_type_error: messages.invalidEmail })
  .trim()
  .refine(isCompleteEmail, { message: messages.invalidEmail })

/** The registration input rules. Stories tighten and extend these. */
export const registrationInput = z.object({
  fullName: z.string().min(1).max(200),
  email: emailSchema,
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

/** Map validation issues to AD-5 field errors: one per top-level field, first message wins. */
export function toFieldErrors(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): { path: string; message: string }[] {
  const fields = new Map<string, string>()
  for (const { path, message } of issues) {
    if (path.length > 0 && !fields.has(String(path[0]))) fields.set(String(path[0]), message)
  }
  return [...fields].map(([path, message]) => ({ path, message }))
}

/** Trim and collapse internal whitespace before validating or storing. */
export function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** Format a Date (or epoch milliseconds) as whole UTC seconds, ISO-8601 with a Z. */
export function formatUtcSeconds(at: Date | number): string {
  const ms = typeof at === 'number' ? at : at.getTime()
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}
