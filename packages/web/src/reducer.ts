// AD-7 — the registration screen's reducer (SCR-1). One state machine holds the four
// visitor fields; submission and error display land with their stories.
import { registrationInput, type RegistrationInput } from '@app/shared'
import { checkPhone } from './phone.js'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

export interface FormState {
  readonly values: Readonly<Record<FieldName, string>>
  readonly errors: FieldErrors
  readonly submitting: boolean
  /** Submit has been pressed at least once: until then nothing is flagged (ST-8 AC-7). */
  readonly attempted: boolean
}

export type FormAction =
  { type: 'change'; field: FieldName; value: string } | { type: 'submit' } | { type: 'submitted' } | { type: 'failed'; errors: FieldErrors }

export const initialState: FormState = {
  values: { firstName: '', lastName: '', email: '', phone: '' },
  errors: {},
  submitting: false,
  attempted: false,
}

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change': {
      // A flagged phone keeps its message until it holds a valid number (ST-8 AC-7).
      const kept = action.field === 'phone' && state.attempted && state.errors.phone !== undefined ? checkPhone(action.value) : undefined
      return { ...state, values: { ...state.values, [action.field]: action.value }, errors: { ...state.errors, [action.field]: kept } }
    }
    case 'submit':
      return { ...state, submitting: true, errors: {} }
    case 'submitted':
      return { ...state, submitting: false }
    case 'failed':
      return { ...state, submitting: false, attempted: true, errors: action.errors }
    default:
      return state
  }
}

/** The field errors Submit raises on the screen's values: the phone rule (ST-8 AC-2, AC-3). */
export function formErrors(values: FormState['values']): FieldErrors {
  const phone = checkPhone(values.phone)
  return phone === undefined ? {} : { phone }
}

/** Validate the current values against the shared rules, mapping issues to field errors. */
export function validate(values: RegistrationInput): Partial<Record<keyof RegistrationInput, string>> {
  const parsed = registrationInput.safeParse(values)
  if (parsed.success) return {}
  const errors: Partial<Record<keyof RegistrationInput, string>> = {}
  for (const issue of parsed.error.issues) {
    const key = issue.path[0]
    if (key === 'fullName' || key === 'email') errors[key] = issue.message
  }
  return errors
}
