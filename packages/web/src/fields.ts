// SCR-1 — the four visitor fields as the screen shows them (AC-2), in tab order (AC-6).
import type { FieldName } from './reducer.js'

export interface FieldSpec {
  readonly name: FieldName
  readonly label: string
  readonly type: 'text' | 'email' | 'tel'
  readonly inputMode?: 'tel'
  readonly hint?: string
}

export const fields: readonly FieldSpec[] = [
  { name: 'firstName', label: 'First name', type: 'text' },
  { name: 'lastName', label: 'Last name', type: 'text' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone number', type: 'tel', inputMode: 'tel', hint: '10-digit US number, e.g. (415) 555-0132' },
]
