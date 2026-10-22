// ST-10 — sends one registration at a time: a second tap while a request is in flight is
// dropped here, before it can reach the network.
import { submitRegistration, type Fetch } from './api.js'
import type { FieldName, FormAction } from './reducer.js'

export function createSubmitter(dispatch: (action: FormAction) => void, fetchFn?: Fetch) {
  let inFlight = false
  return async (values: Readonly<Record<FieldName, string>>): Promise<void> => {
    if (inFlight) return
    inFlight = true
    dispatch({ type: 'submit' })
    try {
      dispatch(await submitRegistration(values, fetchFn))
    } finally {
      inFlight = false
    }
  }
}
