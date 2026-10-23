// ST-3 — a field left empty or holding only spaces stops the registration. The screen and the
// API both run validateRegistration(), so they flag the same fields with the same copy (AD-3).
import { z } from 'zod'
import { registrationRequest, type RegistrationRequest } from './registration.js'

/** The four visitor fields in on-screen order: the order messages are listed and focus is chosen. */
export const fieldOrder = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldOrder)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

/** The visible label of each field, as the form shows it. */
export const fieldLabels: Record<FieldName, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone number',
}

export type RegistrationValidation =
  { ok: true; value: RegistrationRequest } | { ok: false; fieldErrors: FieldErrors; firstInvalid: FieldName | null }

const isFieldName = (value: unknown): value is FieldName => (fieldOrder as readonly unknown[]).includes(value)

/** True when the value would be stored as nothing: not a string, empty, or only whitespace (AC-2). */
export function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

/** The text of the summary box after a failed Submit (AC-3). */
export function errorSummary(count: number): string {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('errorSummary needs at least one flagged field.')
  return count === 1 ? '1 field needs attention. Check the messages below.' : `${count} fields need attention. Check the messages below.`
}

/** The field focus moves to after a failed Submit: the first flagged one on screen (AC-3, AC-5). */
export function firstInvalidField(fieldErrors: FieldErrors): FieldName | null {
  return fieldOrder.find((field) => fieldErrors[field] !== undefined) ?? null
}

/** Validate a submitted body, keeping one message per field, the first the rules raise, in on-screen order. */
export function validateRegistration(input: unknown): RegistrationValidation {
  const parsed = registrationRequest.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data }
  // An unknown key fails the whole body, never a visitor field, as IF-2 shapes the 400.
  if (parsed.error.issues.some((issue) => issue.code === z.ZodIssueCode.unrecognized_keys)) {
    return { ok: false, fieldErrors: {}, firstInvalid: null }
  }
  const raised: FieldErrors = {}
  for (const issue of parsed.error.issues) {
    // A non-object body has no path, so it flags no field either.
    const field = issue.path[0]
    if (isFieldName(field) && raised[field] === undefined) raised[field] = issue.message
  }
  const fieldErrors: FieldErrors = {}
  for (const field of fieldOrder) if (raised[field] !== undefined) fieldErrors[field] = raised[field]
  return { ok: false, fieldErrors, firstInvalid: firstInvalidField(fieldErrors) }
}

const fieldList = z.array(z.string()).optional()

/** IF-2 ValidationProblem: the RFC 9457 members it allows, then each flagged field's messages. */
export const validationProblemSchema = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    status: z.number().int().optional(),
    error: z.literal('validation'),
    fields: z.object({ firstName: fieldList, lastName: fieldList, email: fieldList, phone: fieldList }).strict(),
  })
  .strict()

export type ValidationProblem = z.infer<typeof validationProblemSchema>

/** The 400 body naming each flagged field in on-screen order; messages never carry a submitted value (AC-6). */
export function validationProblem(fieldErrors: FieldErrors): { error: 'validation'; fields: Partial<Record<FieldName, string[]>> } {
  const fields: Partial<Record<FieldName, string[]>> = {}
  for (const field of fieldOrder) {
    const message = fieldErrors[field]
    if (message !== undefined) fields[field] = [message]
  }
  return { error: 'validation', fields }
}
