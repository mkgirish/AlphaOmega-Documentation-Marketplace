// ST-3 — a field left empty, or holding only whitespace, stops the registration. The screen
// and the API both run the request through validateRegistration(), so each empty field gets
// the same message on both sides, in form order, and the 400 body names those fields.
import type { ErrorEnvelope } from './index.js'
import { registrationRequest, type RegistrationRequest } from './registration.js'

/** The four visitor fields in form (and tab) order. */
export const registrationFields = ['firstName', 'lastName', 'email', 'phone'] as const

export type RegistrationField = (typeof registrationFields)[number]

export interface FieldError {
  path: RegistrationField
  message: string
}

export type RegistrationValidation =
  { ok: true; value: RegistrationRequest } | { ok: false; errors: FieldError[]; firstInvalid: RegistrationField | null }

/** The summary box shown above the form after a failed Submit (AC-3). */
export function attentionSummary(count: number): string {
  return `${count} ${count === 1 ? 'field needs' : 'fields need'} attention. Check the messages below.`
}

/** The 400 message when the body is refused before any field can be named. */
export const invalidRequestMessage = 'The request could not be read.'

const isField = (key: unknown): key is RegistrationField => (registrationFields as readonly unknown[]).includes(key)

/**
 * Validate and normalise a registration. On failure: one message per failing field, in form
 * order, and the first of those fields, which takes focus. Messages never echo a submitted value.
 */
export function validateRegistration(input: unknown): RegistrationValidation {
  const parsed = registrationRequest.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data }
  // A body that is not an object, or carries an unknown field, names no field.
  if (parsed.error.issues.some((issue) => !isField(issue.path[0]))) return { ok: false, errors: [], firstInvalid: null }
  const byField = new Map<RegistrationField, string>()
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as RegistrationField
    if (!byField.has(field)) byField.set(field, issue.message)
  }
  const errors = registrationFields.flatMap((path) => {
    const message = byField.get(path)
    return message === undefined ? [] : [{ path, message }]
  })
  return { ok: false, errors, firstInvalid: errors[0]?.path ?? null }
}

/** The AD-5 400 body for a refused registration: a count of what needs attention, and each field. */
export function validationErrorEnvelope(errors: readonly FieldError[]): ErrorEnvelope {
  if (errors.length === 0) return { error: { message: invalidRequestMessage } }
  return { error: { message: attentionSummary(errors.length), fields: errors.map(({ path, message }) => ({ path, message })) } }
}
