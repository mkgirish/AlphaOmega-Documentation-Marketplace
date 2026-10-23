// ST-11 — how POST /api/registrations refuses a request, whatever sent it: the problem
// envelopes and their statuses, the body check that turns registrationRequest issues into
// per-field errors, the field-and-rule reasons the registration.rejected log may carry,
// and the reader the screen uses to put an API refusal next to its fields. No output here
// ever holds a submitted value or a submitted key.
import { z } from 'zod'
import { fieldMessages, registrationRequest, type RegistrationRequest } from './registration.js'

/** The four form fields, in the order the screen shows them. */
export const registrationFields = ['firstName', 'lastName', 'email', 'phone'] as const

export type RegistrationField = (typeof registrationFields)[number]

/** Each refusal's code and the HTTP status that carries it. */
export const problemCodes = {
  validation: 400,
  forbidden: 403,
  method_not_allowed: 405,
  too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal: 500,
} as const

export type ProblemCode = keyof typeof problemCodes

/** Field messages keyed by field; a field appears only when it broke a rule. */
export type FieldErrors = Partial<Record<RegistrationField, string[]>>

const messageList = z.array(z.string().min(1)).min(1)

export const fieldErrorsSchema = z
  .object({ firstName: messageList, lastName: messageList, email: messageList, phone: messageList })
  .partial()
  .strict()

/** The 400 body: {"error":"validation","fields":{...}}; malformed or unexpected bodies carry "fields": {}. */
export const validationEnvelopeSchema = z.object({ error: z.literal('validation'), fields: fieldErrorsSchema }).strict()

export type ValidationEnvelope = z.infer<typeof validationEnvelopeSchema>

type OtherProblem = Exclude<ProblemCode, 'validation'>

const otherCodes = Object.keys(problemCodes).filter((code): code is OtherProblem => code !== 'validation') as [
  OtherProblem,
  ...OtherProblem[],
]

/** Every refusal body: the validation envelope, or the bare code for the other statuses. */
export const problemEnvelopeSchema = z.union([validationEnvelopeSchema, z.object({ error: z.enum(otherCodes) }).strict()])

export type ProblemEnvelope = z.infer<typeof problemEnvelopeSchema>

export const problem = <C extends OtherProblem>(code: C): { error: C } => ({ error: code })

export const validationProblem = (fields: FieldErrors = {}): ValidationEnvelope => ({ error: 'validation', fields })

export type RegistrationValidation = { ok: true; value: RegistrationRequest } | { ok: false; fields: FieldErrors }

const isField = (key: unknown): key is RegistrationField => (registrationFields as readonly unknown[]).includes(key)

/**
 * Check a parsed request body against the shared rules. A body that is not a JSON object,
 * or that holds a key the form never sends, is refused whole with empty fields, so the
 * attacker-chosen key is never named back.
 */
export function validateRegistration(body: unknown): RegistrationValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, fields: {} }
  if (!Object.keys(body).every(isField)) return { ok: false, fields: {} }

  const parsed = registrationRequest.safeParse(body)
  if (parsed.success) return { ok: true, value: parsed.data }

  // Each field rule stops at its first failure, so a field carries one message; fields are
  // collected in form order so the first error the screen focuses is the first field.
  const fields: FieldErrors = {}
  for (const field of registrationFields) {
    const messages = parsed.error.issues.filter((issue) => issue.path[0] === field).map((issue) => issue.message)
    if (messages.length > 0) fields[field] = messages
  }
  return { ok: false, fields }
}

export type FieldRule = 'required' | 'tooLong' | 'invalid'

/** What registration.rejected may log: the field and the rule, never the value or message. */
export type RejectionReason = { field: RegistrationField; rule: FieldRule } | { field: null; rule: 'body' }

function ruleOf(field: RegistrationField, message: string): FieldRule {
  const rules = fieldMessages[field] as Partial<Record<FieldRule, string>>
  const match = (Object.keys(rules) as FieldRule[]).find((rule) => rules[rule] === message)
  return match ?? 'invalid'
}

export function rejectionReasons(fields: FieldErrors): RejectionReason[] {
  const reasons: RejectionReason[] = []
  for (const field of registrationFields) {
    for (const message of fields[field] ?? []) reasons.push({ field, rule: ruleOf(field, message) })
  }
  return reasons.length > 0 ? reasons : [{ field: null, rule: 'body' }]
}

/**
 * Read a 400 body from the API into field errors, in form order, or null when it is not a
 * validation envelope the screen can place next to its fields.
 */
export function readFieldErrors(body: unknown): FieldErrors | null {
  const parsed = validationEnvelopeSchema.safeParse(body)
  if (!parsed.success) return null
  const fields: FieldErrors = {}
  for (const field of registrationFields) {
    const messages = parsed.data.fields[field]
    if (messages) fields[field] = messages
  }
  return fields
}
