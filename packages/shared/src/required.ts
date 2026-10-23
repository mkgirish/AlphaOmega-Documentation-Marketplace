// ST-3 — the empty-field rules: which fields are blank, the message under each and the
// summary box. The screen checks these before Submit and the API before the schema, so a
// field of only spaces is empty on both sides (AC-1, AC-2, AC-6).

/** The four visitor fields in screen order: focus goes to the first empty one (AC-3, AC-5). */
export const registrationFields = ['firstName', 'lastName', 'email', 'phone'] as const

export type RegistrationField = (typeof registrationFields)[number]

/**
 * The message shown directly under each empty field (AC-3). They name what the field
 * needs, never what was submitted.
 */
export const requiredMessages: Readonly<Record<RegistrationField, string>> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
}

/** The summary box text for how many fields need attention; empty when none do. */
export function attentionSummary(count: number): string {
  if (!Number.isInteger(count) || count < 1) return ''
  const fields = count === 1 ? '1 field needs' : `${count} fields need`
  return `${fields} attention. Check the messages below.`
}

/** True for a missing or non-string value, or one holding only whitespace. */
export function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

export interface EmptyField {
  readonly field: RegistrationField
  readonly message: string
}

/** The blank fields of a form or request body, in screen order, each with its message. */
export function emptyFields(body: unknown): EmptyField[] {
  const record: Record<string, unknown> =
    typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  return registrationFields
    .filter((field) => isBlank(Object.hasOwn(record, field) ? record[field] : undefined))
    .map((field) => ({ field, message: requiredMessages[field] }))
}
