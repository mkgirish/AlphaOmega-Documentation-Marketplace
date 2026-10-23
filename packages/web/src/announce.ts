// ST-5 — what the kiosk's polite status region says after an action: once "Register another
// visitor" brings the form back, "Form cleared for the next visitor" is announced (AC-3), and
// the next visitor's first keystroke or Submit silences it.
import type { FormAction, FormState } from './reducer.js'

export const clearedAnnouncement = 'Form cleared for the next visitor'

/** The announcement after `action` is dispatched in `state`: only a reset the reducer accepts (from confirmed) speaks. */
export function announcementAfter(state: FormState, action: FormAction): string {
  return state.status === 'confirmed' && action.type === 'reset' ? clearedAnnouncement : ''
}
