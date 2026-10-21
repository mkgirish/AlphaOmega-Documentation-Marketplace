// AD-7 — the registration screen's reducer (SCR-1). Scaffold baseline: a minimal form
// state machine over the shared rules; the story fleshes out fields, submission and
// error display.
import { registrationInput, type RegistrationInput } from '@app/shared'

export interface FormState {
  readonly values: RegistrationInput
  readonly errors: Partial<Record<keyof RegistrationInput, string>>
  readonly submitting: boolean
}

export type FormAction =
  | { type: 'change'; field: keyof RegistrationInput; value: string }
  | { type: 'submit' }
  | { type: 'submitted' }
  | { type: 'failed'; errors: Partial<Record<keyof RegistrationInput, string>> }

export const initialState: FormState = {
  values: { fullName: '', email: '' },
  errors: {},
  submitting: false,
}

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change':
      return { ...state, values: { ...state.values, [action.field]: action.value }, errors: { ...state.errors, [action.field]: undefined } }
    case 'submit':
      return { ...state, submitting: true, errors: {} }
    case 'submitted':
      return { ...state, submitting: false }
    case 'failed':
      return { ...state, submitting: false, errors: action.errors }
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
