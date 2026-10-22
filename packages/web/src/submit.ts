// ST-8 — pressing Submit (SCR-1): the phone rule flags the field and focus moves to it
// (AC-2, AC-3). Sending a valid form lands with the submission story.
import { fieldNames, formErrors, type FieldName, type FormAction, type FormState } from './reducer.js'

export function submitForm(values: FormState['values'], dispatch: (action: FormAction) => void, focus: (field: FieldName) => void): void {
  const errors = formErrors(values)
  const first = fieldNames.find((name) => errors[name] !== undefined)
  if (first === undefined) return
  dispatch({ type: 'failed', errors })
  focus(first)
}
