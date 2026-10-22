// SCR-1 — what the page does around a transition: the two fixed tab titles (never the
// visitor's name, AC-6) and where focus lands, so it never falls back to <body>.
import { fieldNames, type FormState, type Status } from './reducer.js'

export function titleFor(status: Status): string {
  return status === 'confirmed' ? 'Registration complete' : 'Visitor registration'
}

/** The id of the element to focus after moving from `previous` to `next`, or null to leave focus where it is. */
export function focusTargetFor(previous: Status, next: FormState): string | null {
  if (previous === next.status) return null
  if (next.status === 'confirmed') return 'confirmation-title'
  if (previous === 'confirmed') return 'firstName'
  if (next.status === 'invalid') return fieldNames.find((name) => next.errors[name]) ?? null
  return null
}
