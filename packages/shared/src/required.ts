// ST-3 — the "required field" rules the screen and the API share (AD-2, AD-3): a field
// that is missing, empty or only whitespace is blank, and each blank field has its own message.
import { z } from 'zod'
import { errorEnvelope, type ErrorEnvelope } from './envelope.js'
import { normalise } from './format.js'

/** The four visitor fields, in tab order: the first blank one takes focus. */
export const registrationFields = ['firstName', 'lastName', 'email', 'phone'] as const

export type RegistrationField = (typeof registrationFields)[number]

/** The message shown directly under each blank field and named in the API's 400. */
export const requiredMessages: Readonly<Record<RegistrationField, string>> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
}

/** The summary box text for `count` fields needing attention. */
export function attentionSummary(count: number): string {
  return count === 1 ? '1 field needs attention. Check the message below.' : `${count} fields need attention. Check the messages below.`
}

/** A value is blank when it is not a string or holds nothing but whitespace. */
export function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

/** A field of a submitted body; Object() gives null, undefined and primitives no fields. */
function fieldOf(values: unknown, field: RegistrationField): unknown {
  return (Object(values) as Record<string, unknown>)[field]
}

/** The blank visitor fields of `values`, in tab order. */
export function blankFields(values: unknown): RegistrationField[] {
  return registrationFields.filter((field) => isBlank(fieldOf(values, field)))
}

/** One `{ path, message }` per blank field, in tab order; never carries a submitted value. */
export function requiredFieldErrors(values: unknown): { path: RegistrationField; message: string }[] {
  return blankFields(values).map((field) => ({ path: field, message: requiredMessages[field] }))
}

/** The AD-5 400 body for a submission with blank fields, or undefined when none is blank. */
export function requiredFieldsEnvelope(values: unknown): ErrorEnvelope | undefined {
  const fields = requiredFieldErrors(values)
  return fields.length === 0 ? undefined : errorEnvelope(attentionSummary(fields.length), fields)
}

const requiredText = (message: string) =>
  z.string({ required_error: message, invalid_type_error: message }).transform(normalise).pipe(z.string().min(1, message))

/** Every visitor field present and not blank; parsed values come back normalised. */
export const registrationRequired = z.object({
  firstName: requiredText(requiredMessages.firstName),
  lastName: requiredText(requiredMessages.lastName),
  email: requiredText(requiredMessages.email),
  phone: requiredText(requiredMessages.phone),
})

export type RegistrationRequired = z.infer<typeof registrationRequired>
