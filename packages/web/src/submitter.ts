// ST-2 — Submit to the API: one request per save however often Submit is pressed (AC-4),
// and the confirmation dispatched only once the API has answered 201 (AC-5). The guard is
// synchronous, so a double tap that lands before React re-renders still sends once.
import type { SubmitOutcome } from './api.js'
import type { FieldName, FormAction } from './reducer.js'

type Values = Readonly<Record<FieldName, string>>

export function toAction(outcome: SubmitOutcome): FormAction {
  switch (outcome.kind) {
    case 'saved':
      return { type: 'submitted', firstName: outcome.firstName }
    case 'invalid':
      return { type: 'failed', errors: outcome.fieldErrors }
    default:
      return { type: 'saveFailed' }
  }
}

export function createSubmitter(send: (values: Values) => Promise<SubmitOutcome>, dispatch: (action: FormAction) => void) {
  let inFlight = false
  return async (values: Values): Promise<void> => {
    if (inFlight) return
    inFlight = true
    dispatch({ type: 'submit' })
    try {
      dispatch(toAction(await send(values)))
    } catch {
      dispatch({ type: 'saveFailed' })
    } finally {
      inFlight = false
    }
  }
}
