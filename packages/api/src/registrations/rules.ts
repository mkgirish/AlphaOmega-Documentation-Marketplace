// ST-11 — the server-side gate on a registration body, so bad data stays out whatever sends
// it. The messages and normalise() come from CMP-2 (@app/shared); the four-field rules sit
// here until CMP-2's schema carries firstName, lastName and phone, then move there whole.
import { z } from 'zod'
import { messages, normalise } from '@app/shared'

export const REGISTRATION_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const
export type RegistrationField = (typeof REGISTRATION_FIELDS)[number]

export const NAME_MAX = 100
export const EMAIL_MAX = 254
export const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

export type Rule = 'required' | 'type' | 'too_long' | 'characters' | 'format'

export interface NewRegistration {
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  /** Ten NANP digits, no punctuation. */
  readonly phone: string
}

export interface Failure {
  readonly field: RegistrationField
  readonly rule: Rule
}

export type Verdict =
  | { readonly ok: true; readonly value: NewRegistration }
  | { readonly ok: false; readonly reason: 'malformed' | 'unknown_field' }
  | { readonly ok: false; readonly reason: 'validation'; readonly failures: readonly Failure[] }

const LABELS: Readonly<Record<RegistrationField, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone number',
}

/** The message the screen shows under the field; never contains the submitted value. */
export function messageFor({ field, rule }: Failure): string {
  if (rule === 'required') return messages.required(LABELS[field])
  if (rule === 'type') return `${LABELS[field]} must be text.`
  if (field === 'phone') return PHONE_MESSAGE
  if (rule === 'too_long') return `${LABELS[field]} must be ${field === 'email' ? EMAIL_MAX : NAME_MAX} characters or fewer.`
  if (rule === 'characters') return `${LABELS[field]} contains characters that are not allowed.`
  return messages.invalidEmail
}

// Control and invisible format characters (the bidi overrides and U+FEFF among them), lone
// surrogates, private-use characters and U+FFFD, which stands in for bytes that were not
// UTF-8. Checked before normalise(), which would fold U+FEFF into a space; tabs and line
// breaks are whitespace it collapses.
const DISALLOWED = /(?![\t\n\r])[\p{Cc}\p{Cf}\p{Cs}\p{Co}\uFFFD]/u
// NANP: area code and exchange each start 2-9; punctuation a person types is allowed.
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/
const PHONE_PUNCTUATION = /[\s().-]/g
const email = z.string().email()

type Check = { value: string } | { rule: Rule }

function checkName(raw: string): Check {
  const value = normalise(raw)
  if (value === '') return { rule: 'required' }
  if (DISALLOWED.test(raw)) return { rule: 'characters' }
  if (value.length > NAME_MAX) return { rule: 'too_long' }
  return { value }
}

function checkEmail(raw: string): Check {
  const value = normalise(raw)
  if (value === '') return { rule: 'required' }
  if (DISALLOWED.test(raw)) return { rule: 'characters' }
  if (value.length > EMAIL_MAX) return { rule: 'too_long' }
  return email.safeParse(value).success ? { value } : { rule: 'format' }
}

function checkPhone(raw: string): Check {
  const value = normalise(raw)
  if (value === '') return { rule: 'required' }
  const digits = value.replace(PHONE_PUNCTUATION, '')
  return NANP.test(digits) ? { value: digits } : { rule: 'format' }
}

const CHECKS: Readonly<Record<RegistrationField, (raw: string) => Check>> = {
  firstName: checkName,
  lastName: checkName,
  email: checkEmail,
  phone: checkPhone,
}

function isField(key: string): key is RegistrationField {
  return (REGISTRATION_FIELDS as readonly string[]).includes(key)
}

/** Judges a parsed JSON body: every invalid field is reported at once, in form order. */
export function judgeRegistration(body: unknown): Verdict {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, reason: 'malformed' }
  const record = body as Record<string, unknown>
  if (!Object.keys(record).every(isField)) return { ok: false, reason: 'unknown_field' }
  const failures: Failure[] = []
  const value: Partial<Record<RegistrationField, string>> = {}
  for (const field of REGISTRATION_FIELDS) {
    const raw = record[field]
    const check: Check = typeof raw === 'string' ? CHECKS[field](raw) : { rule: raw === undefined || raw === null ? 'required' : 'type' }
    if ('rule' in check) failures.push({ field, rule: check.rule })
    else value[field] = check.value
  }
  if (failures.length > 0) return { ok: false, reason: 'validation', failures }
  return { ok: true, value: value as NewRegistration }
}

/** The 400 body: one list of messages per invalid field, none for the valid ones. */
export function validationEnvelope(failures: readonly Failure[]): {
  error: 'validation'
  fields: Partial<Record<RegistrationField, string[]>>
} {
  const fields: Partial<Record<RegistrationField, string[]>> = {}
  for (const failure of failures) (fields[failure.field] ??= []).push(messageFor(failure))
  return { error: 'validation', fields }
}
