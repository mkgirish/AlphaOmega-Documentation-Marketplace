// SCR-1 — the four visitor fields as the screen shows them (AC-2), in tab order (AC-6),
// each with the message shown under it when a Submit finds it empty (ST-3 AC-3).
import type { FieldName } from './reducer.js'

export interface FieldSpec {
  readonly name: FieldName
  readonly label: string
  readonly type: 'text' | 'email' | 'tel'
  readonly inputMode?: 'tel'
  readonly hint?: string
  readonly missing: string
}

export const fields: readonly FieldSpec[] = [
  { name: 'firstName', label: 'First name', type: 'text', missing: 'Enter your first name.' },
  { name: 'lastName', label: 'Last name', type: 'text', missing: 'Enter your last name.' },
  { name: 'email', label: 'Email', type: 'email', missing: 'Enter an email like name@example.com.' },
  {
    name: 'phone',
    label: 'Phone number',
    type: 'tel',
    inputMode: 'tel',
    hint: '10-digit US number, e.g. (415) 555-0132',
    missing: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
  },
]
