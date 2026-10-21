// AD-7 — the registration screen's reducer (SCR-1). One state machine holds the four
// visitor fields and the errors of a stopped Submit (ST-3); submission lands with its story.
import { normalise, registrationInput, type RegistrationInput } from '@app/shared'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

export interface FormState {
  readonly values: Readonly<Record<FieldName, string>>
  readonly errors: FieldErrors
  readonly submitting: boolean
}

export type FormAction =
  | { type: 'change'; field: FieldName; value: string }
  | { type: 'submit' }
  | { type: 'submitted' }
  | { type: 'failed'; errors: FieldErrors }
  | { type: 'invalid'; errors: FieldErrors }

export const initialState: FormState = {
  values: { firstName: '', lastName: '', email: '', phone: '' },
  errors: {},
  submitting: false,
}

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change':
      // Typing only spaces leaves the field as empty as before (AC-2), so its message stays.
      if (normalise(action.value) === '') return { ...state, values: { ...state.values, [action.field]: action.value } }
      return { ...state, values: { ...state.values, [action.field]: action.value }, errors: { ...state.errors, [action.field]: undefined } }
    case 'submit':
      return { ...state, submitting: true, errors: {} }
    case 'submitted':
      return { ...state, submitting: false }
    case 'failed':
      return { ...state, submitting: false, errors: action.errors }
    case 'invalid':
      // A Submit stopped by an empty field (ST-3): the values stay, only the errors change.
      return state.submitting ? state : { ...state, errors: action.errors }
    default:
      return state
  }
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
