// AD-7 — the registration screen's reducer (SCR-1). One state machine holds the four
// visitor fields and their errors; submission lands with its story.
import { messages, normalise, registrationInput, type RegistrationInput } from '@app/shared'

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
  { type: 'change'; field: FieldName; value: string } | { type: 'submit' } | { type: 'submitted' } | { type: 'failed'; errors: FieldErrors }

export const initialState: FormState = {
  values: { firstName: '', lastName: '', email: '', phone: '' },
  errors: {},
  submitting: false,
}

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change': {
      const values = { ...state.values, [action.field]: action.value }
      // A flagged field is judged again as it is edited, so its message clears once it is fixed (ST-9 AC-4).
      const error = fieldErrors(values)[action.field] === undefined ? undefined : state.errors[action.field]
      return { ...state, values, errors: { ...state.errors, [action.field]: error } }
    }
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

/** The screen's field errors under the shared rules (CMP-2): the email rule and its message (ST-9). */
export function fieldErrors(values: FormState['values']): FieldErrors {
  return registrationInput.shape.email.safeParse(normalise(values.email)).success ? {} : { email: messages.invalidEmail }
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
