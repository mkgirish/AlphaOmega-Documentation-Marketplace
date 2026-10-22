// SCR-1 — pressing Submit: one request per visit to IF-2, its outcome dispatched to the reducer.
import { submitRegistration, type Outcome } from './api.js'
import type { FieldName, FormAction, FormState } from './reducer.js'

export interface SubmitDeps {
  readonly getState: () => FormState
  readonly dispatch: (action: FormAction) => void
  readonly send?: (values: Readonly<Record<FieldName, string>>) => Promise<Outcome>
}

/** The Submit handler. A tap while a request is in flight sends nothing, even before React re-renders. */
export function createSubmit({ getState, dispatch, send = (values) => submitRegistration(values) }: SubmitDeps): () => Promise<void> {
  let inFlight = false
  return async () => {
    const state = getState()
    if (inFlight || state.submitting) return
    inFlight = true
    dispatch({ type: 'submit' })
    try {
      const outcome = await send(state.values)
      if (outcome.kind === 'saved') dispatch({ type: 'submitted', firstName: outcome.firstName })
      else if (outcome.kind === 'invalid') dispatch({ type: 'failed', errors: outcome.errors })
      else dispatch({ type: 'saveFailed' })
    } finally {
      inFlight = false
    }
  }
}

/** The form's submit listener: never a native post (no values in the URL), always the IF-2 call. */
export function onSubmitWith(submit: () => Promise<void>): (event: { preventDefault: () => void }) => void {
  return (event) => {
    event.preventDefault()
    void submit()
  }
}

export interface FocusDocument {
  readonly activeElement: unknown
  getElementById(id: string): { focus: () => void; blur: () => void } | null
}

/**
 * Look up the input to focus. One that already holds focus (Enter pressed in it) is blurred
 * first, so focusing it again makes the screen reader read its new error.
 */
export function focusTargetIn(doc: FocusDocument): (id: string) => { focus: () => void } | null {
  return (id) => {
    const input = doc.getElementById(id)
    if (input && input === doc.activeElement) input.blur()
    return input
  }
}
