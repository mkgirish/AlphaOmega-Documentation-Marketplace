// ST-3 — a Submit with any field empty, or holding only whitespace, is stopped on the
// screen: nothing is sent, each empty field says what it needs and focus moves to the first.
import { normalise } from '@app/shared'
import { fieldNames, type FieldErrors, type FieldName, type FormAction } from './reducer.js'

/** The message shown under each field left empty (AC-3). */
export const requiredMessages: Readonly<Record<FieldName, string>> = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
}

/** The empty fields, in tab order; whitespace alone counts as empty (AC-2). */
export function blankFieldErrors(values: Readonly<Record<FieldName, string>>): FieldErrors {
  const errors: FieldErrors = {}
  for (const field of fieldNames) {
    if (normalise(values[field]) === '') errors[field] = requiredMessages[field]
  }
  return errors
}

/** The summary box text for a Submit that missed `count` fields. */
export function attentionSummary(count: number): string {
  return `${count} ${count === 1 ? 'field needs' : 'fields need'} attention. Check the messages below.`
}

/** Put the cursor in the input with the given id. */
export function focusField(id: string): void {
  document.getElementById(id)?.focus()
}

/**
 * Handle Submit: when a field is empty, record the errors and focus the first empty field —
 * no request is made (AC-1). Returns true when the Submit was stopped.
 */
export function submitRegistration(
  values: Readonly<Record<FieldName, string>>,
  dispatch: (action: FormAction) => void,
  focus: (id: FieldName) => void,
): boolean {
  const errors = blankFieldErrors(values)
  const [first] = Object.keys(errors) as FieldName[]
  if (first === undefined) return false
  dispatch({ type: 'blocked', errors })
  focus(first)
  return true
}
