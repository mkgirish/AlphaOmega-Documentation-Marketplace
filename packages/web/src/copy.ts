// SCR-1 copy, character for character from ST-1's acceptance criteria.
import type { FieldName } from './reducer.js'

export interface FieldCopy {
  readonly name: FieldName
  readonly label: string
  readonly type: 'text' | 'email' | 'tel'
  readonly hint?: string
}

export const screenCopy = {
  title: 'Visitor registration',
  intro: 'Please register. All fields are required.',
  submit: 'Submit',
  fields: [
    { name: 'firstName', label: 'First name', type: 'text' },
    { name: 'lastName', label: 'Last name', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone number', type: 'tel', hint: '10-digit US number, e.g. (415) 555-0132' },
  ] satisfies readonly FieldCopy[] as readonly FieldCopy[],
} as const
