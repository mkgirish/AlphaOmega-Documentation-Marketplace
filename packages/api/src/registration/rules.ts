// ST-10 — the API's registration rules for the four visitor fields. Names are taken as
// written (apostrophes, hyphens, accents) and held to NAME_MAX characters; messages name
// the field and never repeat what was sent. Values are trimmed with CMP-2's normalise().
import { messages, normalise } from '@app/shared'

export const NAME_MAX = 100
/** RFC 5321's practical limit on a forward path. */
export const EMAIL_MAX = 254

export const nameTooLong = {
  firstName: 'First name must be 100 characters or fewer.',
  lastName: 'Last name must be 100 characters or fewer.',
} as const

export const invalidPhone = 'Enter a 10-digit US phone number.'

export const disallowedCharacter = (label: string): string => `${label} contains a character that cannot be used.`

export interface RegistrationValues {
  firstName: string
  lastName: string
  email: string
  phone: string
}

export type FieldName = keyof RegistrationValues

export interface FieldError {
  path: FieldName
  message: string
}

export type ParseResult = { ok: true; value: RegistrationValues } | { ok: false; fields?: FieldError[] }

const labels: Readonly<Record<FieldName, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone number',
}

const FIELD_NAMES = Object.keys(labels) as FieldName[]

// A pragmatic shape check: one @, no whitespace, a dot in the domain.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// NANP: area code and exchange each start 2–9, optional leading 1 or +1.
const NANP = /^(\+?1)?[2-9]\d{2}[2-9]\d{6}$/
/**
 * Control characters (Postgres text cannot hold NUL), bidi overrides that could disguise a
 * name, and lone surrogates (code points D800–DFFF survive spreading only when unpaired).
 */
function disallowed(cp: number): boolean {
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    (cp >= 0xd800 && cp <= 0xdfff)
  )
}

/** Length in characters (code points), so an accented letter counts once. */
const length = (value: string): number => [...value].length

function check(field: FieldName, value: string): string | undefined {
  if (value === '') return messages.required(labels[field])
  if ([...value].some((char) => disallowed(Number(char.codePointAt(0))))) return disallowedCharacter(labels[field])
  switch (field) {
    case 'firstName':
    case 'lastName':
      return length(value) > NAME_MAX ? nameTooLong[field] : undefined
    case 'email':
      return length(value) > EMAIL_MAX || !EMAIL.test(value) ? messages.invalidEmail : undefined
    case 'phone':
      return NANP.test(value.replace(/[\s().-]/g, '')) ? undefined : invalidPhone
  }
}

/** Validate a decoded JSON body. Unknown keys or a non-object body give no field list. */
export function parseRegistration(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false }
  const record = body as Record<string, unknown>
  if (Object.keys(record).some((key) => !(FIELD_NAMES as string[]).includes(key))) return { ok: false }

  const value = {} as RegistrationValues
  const fields: FieldError[] = []
  for (const field of FIELD_NAMES) {
    const raw = record[field]
    value[field] = typeof raw === 'string' ? normalise(raw) : ''
    const message = check(field, value[field])
    if (message !== undefined) fields.push({ path: field, message })
  }
  return fields.length === 0 ? { ok: true, value } : { ok: false, fields }
}
