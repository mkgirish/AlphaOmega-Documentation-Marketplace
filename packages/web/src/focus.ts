// SCR-1 — where focus goes after a transition, so it never falls back to <body>: the
// first flagged field, the confirmation, or First name for the next visitor.
import { fieldNames, type FormState } from './reducer.js'

/** The id of the element to focus after moving from `previous` to `next`, or null to leave focus alone. */
export function focusTarget(previous: FormState, next: FormState): string | null {
  if (previous.phase === next.phase) return null
  if (next.phase === 'invalid') return fieldNames.find((name) => next.errors[name] !== undefined) ?? null
  if (next.phase === 'confirmed') return 'confirmation'
  if (previous.phase === 'confirmed') return 'firstName'
  return null
}

/** Move focus for the transition from `previous` to `next`, if it calls for a move. */
export function applyFocus(previous: FormState, next: FormState, doc: Pick<Document, 'getElementById'>): void {
  const target = focusTarget(previous, next)
  if (target) doc.getElementById(target)?.focus()
}
