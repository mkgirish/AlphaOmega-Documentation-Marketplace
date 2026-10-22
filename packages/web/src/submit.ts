// ST-9 — what Submit does: the shared email check first, then at most one IF-2 request at a
// time. Each outcome goes to the reducer; focus moves to the first field to fix.
import { postRegistration, type Fetch } from './client.js'
import { emailError } from './email.js'
import { fieldNames, type FieldName, type FormAction } from './reducer.js'

export interface SubmitterDeps {
  readonly dispatch: (action: FormAction) => void
  readonly focus: (field: FieldName) => void
  readonly fetchFn?: Fetch
}

export function createSubmitter({ dispatch, focus, fetchFn }: SubmitterDeps) {
  // A ref-like guard, not state: a double tap lands before React re-renders.
  let inFlight = false

  return async function submit(values: Readonly<Record<FieldName, string>>): Promise<void> {
    if (inFlight) return
    const email = emailError(values.email)
    if (email !== undefined) {
      dispatch({ type: 'failed', errors: { email } })
      focus('email')
      return
    }
    inFlight = true
    dispatch({ type: 'submit' })
    const outcome = await postRegistration(values, fetchFn)
    inFlight = false
    if (outcome.kind === 'saved') {
      dispatch({ type: 'saved', firstName: outcome.firstName })
      return
    }
    const first = outcome.kind === 'invalid' ? fieldNames.find((name) => outcome.errors[name] !== undefined) : undefined
    if (outcome.kind === 'invalid' && first !== undefined) {
      dispatch({ type: 'failed', errors: outcome.errors })
      focus(first)
      return
    }
    dispatch({ type: 'saveFailed' })
  }
}
