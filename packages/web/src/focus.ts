// ST-10 — where focus lands after a transition, so it never falls back to the page body:
// the confirmation, the first flagged field in tab order, or Submit after a failed save.
import { fieldNames, type FormState } from './reducer.js'

export function focusTarget(state: Pick<FormState, 'status' | 'errors'>): string | null {
  if (state.status === 'confirmed') return 'confirmation'
  if (state.status === 'invalid') return fieldNames.find((name) => state.errors[name] !== undefined) ?? null
  if (state.status === 'saveFailed') return 'submit'
  return null
}

/** Move focus to the transition's target, if it is on the page. */
export function applyFocus(state: Pick<FormState, 'status' | 'errors'>, doc: Pick<Document, 'getElementById'>): void {
  const target = focusTarget(state)
  if (target) doc.getElementById(target)?.focus()
}
