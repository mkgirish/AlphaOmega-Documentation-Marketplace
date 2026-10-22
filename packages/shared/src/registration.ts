// CMP-2 — the registration rules both sides enforce (AD-2, AD-3): the four form fields,
// their messages, the AD-5 validation and request-error envelopes, and the request gates.
// A refusal names only fields and rules; no message is ever built from a submitted value.
import { z } from 'zod'
import { normalise } from './normalise.js'

/** The four visitor fields, in tab order. */
export const registrationFields = ['firstName', 'lastName', 'email', 'phone'] as const

export type RegistrationField = (typeof registrationFields)[number]

export const REGISTRATION_LIMITS = { nameMax: 100, emailMax: 254, bodyMaxBytes: 4096 } as const

export type FieldRule = 'required' | 'type' | 'too_long' | 'invalid_characters' | 'format'

export type BodyRule = 'malformed_json' | 'not_object' | 'unknown_field'

/** One refused check, safe to log: the field and the rule, never the value. */
export type Rejection = { field: RegistrationField; rule: FieldRule } | { field: 'body'; rule: BodyRule }

const PHONE_FORMAT = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const EMAIL_FORMAT = 'Enter an email address like name@example.com.'

/** Every message a field can show, keyed by the rule that produced it. */
export const registrationMessages = {
  firstName: {
    required: 'Enter your first name.',
    too_long: 'Keep your first name to 100 characters or fewer.',
    invalid_characters: 'Remove hidden or control characters from your first name.',
  },
  lastName: {
    required: 'Enter your last name.',
    too_long: 'Keep your last name to 100 characters or fewer.',
    invalid_characters: 'Remove hidden or control characters from your last name.',
  },
  email: {
    required: 'Enter your email address.',
    too_long: 'Keep your email address to 254 characters or fewer.',
    format: EMAIL_FORMAT,
  },
  phone: {
    required: 'Enter your phone number.',
    format: PHONE_FORMAT,
  },
} as const

/** The fixed message for a refused field rule. A wrong type reads like the field's main rule. */
export function messageFor(field: RegistrationField, rule: FieldRule): string {
  const own: Partial<Record<FieldRule, string>> = registrationMessages[field]
  if (rule === 'type') return own.format ?? own.required ?? ''
  return own[rule] ?? ''
}

// Control characters (Cc) other than the whitespace normalise() folds away, and invisible
// format characters (Cf: bidi overrides and isolates, zero-width joiners, byte-order marks),
// lone surrogates (Cs) and private-use characters (Co)
// are never part of a real entry. Checked on the raw value, before trimming can hide them.
const HIDDEN = /[\p{Cf}\p{Cs}\p{Co}]|(?![\t\n\v\f\r])\p{Cc}/u
// Dot-separated atoms before the @; dot-separated labels after it, ending in a lettered TLD.
const EMAIL =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
// NANP: area code and exchange start 2-9; an N11 area code is a service code, not a number.
const NANP = /^(?!\d11)[2-9]\d{2}[2-9]\d{6}$/
const PHONE_LAYOUT = /[ ().-]/g

const length = (value: string) => [...value].length

type Check = (value: string) => { value: string; rule?: FieldRule }

const name: Check = (raw) => {
  const value = normalise(raw)
  if (value === '') return { value, rule: 'required' }
  if (HIDDEN.test(raw)) return { value, rule: 'invalid_characters' }
  if (length(value) > REGISTRATION_LIMITS.nameMax) return { value, rule: 'too_long' }
  return { value }
}

const email: Check = (raw) => {
  const value = raw.trim()
  if (value === '') return { value, rule: 'required' }
  if (length(value) > REGISTRATION_LIMITS.emailMax) return { value, rule: 'too_long' }
  if (HIDDEN.test(raw) || !EMAIL.test(value)) return { value, rule: 'format' }
  return { value }
}

const phone: Check = (raw) => {
  if (raw.trim() === '') return { value: '', rule: 'required' }
  const value = raw.replace(PHONE_LAYOUT, '')
  if (HIDDEN.test(raw) || !NANP.test(value)) return { value, rule: 'format' }
  return { value }
}

const checks: Record<RegistrationField, Check> = { firstName: name, lastName: name, email, phone }

const field = (key: RegistrationField) =>
  z.unknown().transform((input, ctx) => {
    if (input === undefined || input === null) return addRule(ctx, 'required')
    if (typeof input !== 'string') return addRule(ctx, 'type')
    const { value, rule } = checks[key](input)
    return rule === undefined ? value : addRule(ctx, rule)
  })

function addRule(ctx: z.RefinementCtx, rule: FieldRule): typeof z.NEVER {
  ctx.addIssue({ code: z.ZodIssueCode.custom, params: { rule } })
  return z.NEVER
}

/** The registration body: exactly the four fields, each normalised and checked. */
export const registrationSchema = z
  .object({ firstName: field('firstName'), lastName: field('lastName'), email: field('email'), phone: field('phone') })
  .strict()

export type NormalisedRegistration = z.infer<typeof registrationSchema>

/** AD-5 validation envelope: messages under the form fields that failed, nothing else. */
export const validationEnvelopeSchema = z
  .object({
    error: z.literal('validation'),
    fields: z.record(z.enum(registrationFields), z.array(z.string().min(1)).nonempty()),
  })
  .strict()

export type ValidationEnvelope = z.infer<typeof validationEnvelopeSchema>

export type ValidationResult =
  { ok: true; value: NormalisedRegistration } | { ok: false; envelope: ValidationEnvelope; rejections: Rejection[] }

/** Validate an untrusted parsed body. Refusals carry only fixed messages and field/rule pairs. */
export function validateRegistration(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return refusal({}, [{ field: 'body', rule: 'not_object' }])
  }
  const parsed = registrationSchema.safeParse(body)
  if (parsed.success) return { ok: true, value: parsed.data }

  const fields: ValidationEnvelope['fields'] = {}
  const found: Rejection[] = []
  let unknown = false
  for (const issue of parsed.error.issues) {
    const key = issue.path[0]
    if (issue.code === z.ZodIssueCode.custom && isField(key)) {
      const rule = (issue.params as { rule: FieldRule }).rule
      fields[key] = [messageFor(key, rule)]
      found.push({ field: key, rule })
    } else {
      unknown = true
    }
  }
  const rejections = registrationFields.flatMap((key) => found.filter((r) => r.field === key))
  if (unknown) rejections.push({ field: 'body', rule: 'unknown_field' })
  return refusal(fields, rejections)
}

/** The refusal for a body that is not valid JSON at all. */
export function malformedJson(): ValidationResult {
  return refusal({}, [{ field: 'body', rule: 'malformed_json' }])
}

function refusal(fields: ValidationEnvelope['fields'], rejections: Rejection[]): ValidationResult {
  return { ok: false, envelope: { error: 'validation', fields }, rejections }
}

function isField(key: unknown): key is RegistrationField {
  return typeof key === 'string' && (registrationFields as readonly string[]).includes(key)
}

/** The screen's view of a 400: the first message per field, or null if it is not a validation envelope. */
export function readFieldErrors(body: unknown): Partial<Record<RegistrationField, string>> | null {
  const parsed = validationEnvelopeSchema.safeParse(body)
  if (!parsed.success) return null
  const errors: Partial<Record<RegistrationField, string>> = {}
  for (const key of registrationFields) {
    const list = parsed.data.fields[key]
    if (list !== undefined) errors[key] = list[0]
  }
  return errors
}

/** Requests the form would never send, refused before the body is read (AC-4). */
export const requestErrorStatus = { cross_site: 403, too_large: 413, unsupported_media_type: 415 } as const

export type RequestError = keyof typeof requestErrorStatus

export const requestErrorEnvelopeSchema = z.object({ error: z.enum(['cross_site', 'too_large', 'unsupported_media_type']) }).strict()

export type RequestErrorEnvelope = z.infer<typeof requestErrorEnvelopeSchema>

export const requestErrorEnvelope = (error: RequestError): RequestErrorEnvelope => ({ error })

/** True only for application/json, with or without parameters such as charset. */
export function isJsonContentType(header: string | string[] | undefined): boolean {
  return firstValue(header)?.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

/** True when the browser marks the request as sent from another site. */
export function isCrossSiteRequest(header: string | string[] | undefined): boolean {
  return firstValue(header)?.split(',')[0]?.trim().toLowerCase() === 'cross-site'
}

/** Node hands a repeated header over as an array; the first value is the one that counts. */
function firstValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header
}
