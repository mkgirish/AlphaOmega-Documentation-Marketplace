// ST-8 — what Submit does: the field rules run first and a flagged form is never sent; a
// valid one is sent once, however often Submit is pressed while it is in flight.
import { submitRegistration, type Send, type SubmitResult } from './client.js'
import { fieldNames, validateForm, type FieldErrors, type FieldName, type FormAction, type FormValues } from './reducer.js'

export interface SubmitterDeps {
  readonly send: Send
  readonly dispatch: (action: FormAction) => void
  /** Move focus to a field's input. */
  readonly focus: (field: FieldName) => void
}

export function outcomeAction(result: SubmitResult): FormAction {
  if (result.kind === 'saved') return { type: 'saved', firstName: result.firstName }
  if (result.kind === 'invalid' && Object.keys(result.errors).length > 0) return { type: 'failed', errors: result.errors }
  return { type: 'saveFailed' }
}

const firstFlagged = (errors: FieldErrors) => fieldNames.find((field) => errors[field] !== undefined)

export function createSubmitter({ send, dispatch, focus }: SubmitterDeps): (values: FormValues) => Promise<void> {
  let inFlight = false
  return async (values) => {
    if (inFlight) return
    const errors = validateForm(values)
    const flagged = firstFlagged(errors)
    if (flagged) {
      dispatch({ type: 'failed', errors })
      focus(flagged)
      return
    }
    inFlight = true
    dispatch({ type: 'submit' })
    const action = outcomeAction(await submitRegistration(values, send))
    inFlight = false
    dispatch(action)
    const refocus = action.type === 'failed' ? firstFlagged(action.errors) : undefined
    if (refocus) focus(refocus)
  }
}
