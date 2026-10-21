// ST-3 — the screen's required-field check. Whether a value is empty is decided by the
// shared normalise() (CMP-2), so a value of only whitespace counts as empty (AC-2).
import { normalise } from '@app/shared'
import { fields } from './fields.js'
import type { FieldErrors, FieldName, FormState } from './reducer.js'

/** Each empty field mapped to its own message, in tab order; empty when nothing is missing. */
export function missingFields(values: FormState['values']): FieldErrors {
  const errors: FieldErrors = {}
  for (const field of fields) if (normalise(values[field.name]) === '') errors[field.name] = field.missing
  return errors
}

/** The first flagged field in tab order — where focus goes after a stopped Submit (AC-3). */
export function firstFlagged(errors: FieldErrors): FieldName | undefined {
  return fields.find((field) => errors[field.name] !== undefined)?.name
}

/** The summary box's text for the given number of flagged fields (AC-3). */
export function attentionSummary(count: number): string {
  return `${count} ${count === 1 ? 'field needs' : 'fields need'} attention. Check the messages below.`
}
