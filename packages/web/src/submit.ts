// ST-2 — Submit's one path to the API. A second tap while a request is in flight sends
// nothing (AC-4), and the confirmation is dispatched only after the API answers 201 (AC-5).
import { postRegistration, type Outcome } from './client.js'
import type { FormAction, FormState } from './reducer.js'

export function createSubmit(
  dispatch: (action: FormAction) => void,
  post: (values: FormState['values']) => Promise<Outcome> = postRegistration,
) {
  let inFlight = false
  return async (state: FormState): Promise<void> => {
    if (inFlight || state.status === 'submitting' || state.status === 'confirmed') return
    inFlight = true
    dispatch({ type: 'submit' })
    try {
      const outcome = await post(state.values)
      if (outcome.kind === 'created') dispatch({ type: 'submitted', firstName: outcome.firstName })
      else if (outcome.kind === 'invalid') dispatch({ type: 'failed', errors: outcome.fieldErrors })
      else dispatch({ type: 'saveFailed' })
    } catch {
      dispatch({ type: 'saveFailed' })
    } finally {
      inFlight = false
    }
  }
}
