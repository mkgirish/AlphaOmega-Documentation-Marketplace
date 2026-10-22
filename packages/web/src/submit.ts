// AD-7 — Submit as one request at a time: the reducer moves to submitting, the IF-2
// outcome moves it on. A second press while a request is in flight sends nothing.
import { submitRegistration, type RegistrationValues, type SubmitOutcome } from './api.js'
import type { FormAction } from './reducer.js'

/** The reducer action for an IF-2 outcome. A 400 naming no field has nothing to fix: it is a failed save. */
export function outcomeAction(outcome: SubmitOutcome): FormAction {
  switch (outcome.kind) {
    case 'created':
      return { type: 'submitted', firstName: outcome.firstName }
    case 'invalid':
      return Object.keys(outcome.fieldErrors).length > 0 ? { type: 'failed', errors: outcome.fieldErrors } : { type: 'saveFailed' }
    case 'failed':
      return { type: 'saveFailed' }
  }
}

export function createSubmit(
  dispatch: (action: FormAction) => void,
  send: (values: RegistrationValues) => Promise<SubmitOutcome> = submitRegistration,
): (values: RegistrationValues) => Promise<void> {
  let inFlight = false
  return async (values) => {
    if (inFlight) return
    inFlight = true
    dispatch({ type: 'submit' })
    try {
      dispatch(outcomeAction(await send(values)))
    } catch {
      dispatch({ type: 'saveFailed' })
    } finally {
      inFlight = false
    }
  }
}
