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
} as const

export { normalise } from './normalise.js'

/** Format a Date (or epoch milliseconds) as whole UTC seconds, ISO-8601 with a Z. */
export function formatUtcSeconds(at: Date | number): string {
  const ms = typeof at === 'number' ? at : at.getTime()
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}

export * from './registration.js'
