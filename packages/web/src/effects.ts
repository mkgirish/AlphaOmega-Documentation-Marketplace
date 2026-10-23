// SCR-1 — what the page does around a transition: the two fixed tab titles (never the
// visitor's name, AC-6), where focus lands, so it never falls back to <body>, and what the
// polite region tells a screen reader once the kiosk is cleared (ST-5).
import { confirmation } from '@app/shared'
import { fieldNames, type FormState, type Status } from './reducer.js'

export function titleFor(status: Status): string {
  return status === 'confirmed' ? confirmation.pageTitle : 'Visitor registration'
}

/** The id of the element to focus after moving from `previous` to `next`, or null to leave focus where it is. */
export function focusTargetFor(previous: Status, next: FormState): string | null {
  if (previous === next.status) return null
  if (next.status === 'confirmed') return 'confirmation-title'
  if (previous === 'confirmed') return 'firstName'
  if (next.status === 'invalid') return fieldNames.find((name) => next.errors[name]) ?? null
  return null
}

/**
 * The polite region's text after moving from `previous` to `next`, given its `current` text; null
 * renders no region. Saving removes it, so only the saving status speaks and no reset lingers for the
 * next visitor; the confirmation mounts it empty, so the reset's words are a change a screen reader hears.
 */
export function announcementFor(previous: Status, next: Status, current: string | null): string | null {
  if (previous === next) return current
  if (next === 'submitting') return null
  if (next === 'confirmed') return ''
  if (previous === 'confirmed' && next === 'editing') return 'Form cleared for the next visitor'
  return current
}
