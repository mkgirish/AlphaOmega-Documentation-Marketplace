// SCR-1 side effects as pure decisions, applied by App after each transition.
import { copy } from './copy.js'
import type { FormState } from './reducer.js'

/** The tab title: one of two fixed strings, never a visitor's detail (kiosk hygiene). */
export function titleFor(state: FormState): string {
  return state.status === 'confirmed' ? copy.confirmationTitle : copy.formTitle
}

/** The id of the element that takes focus after a transition, or null to leave focus be. */
export function focusTargetFor(previous: FormState, next: FormState): string | null {
  if (previous.status === next.status) return null
  if (next.status === 'confirmed') return 'confirmation-title'
  if (previous.status === 'confirmed') return 'firstName'
  if (next.status === 'invalid') return 'error-summary'
  // Submitting and a failed save keep focus on Submit; the alert announces itself.
  return null
}
