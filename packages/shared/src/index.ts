// CMP-2 — the single source of registration field rules, imported by packages/web and
// packages/api (AD-2, AD-3). Scaffold baseline: real, minimal shapes the stories extend.
import { z } from 'zod'

/** Scaffold baseline rules. @deprecated Use registrationRequest, which holds the four ST-2 fields. */
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

/** Human-facing messages, kept here so the screen and the API agree. */
export const messages = {
  required: (field: string) => `${field} is required.`,
  invalidEmail: 'Enter a valid email address.',
} as const

export { formatUtcSeconds, normalise } from './format.js'
export * from './registration.js'
export { envelope, errorEnvelope, type DataEnvelope, type ErrorEnvelope } from './envelope.js'
export * from './required.js'
