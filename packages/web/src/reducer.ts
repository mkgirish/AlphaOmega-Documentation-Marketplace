// AD-7 — the registration screen's reducer (SCR-1). One state machine holds the four
// visitor fields, their errors and the outcome of the last save.
import { registrationInput, type RegistrationInput } from '@app/shared'
import { emailError } from './email.js'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

export interface FormState {
  readonly values: Readonly<Record<FieldName, string>>
  readonly errors: FieldErrors
  readonly submitting: boolean
  /** The first name the API saved, for the confirmation; null until a 201. */
  readonly saved: string | null
  readonly saveFailed: boolean
}

export type FormAction =
  | { type: 'change'; field: FieldName; value: string }
  | { type: 'submit' }
  | { type: 'submitted' }
  | { type: 'failed'; errors: FieldErrors }
  | { type: 'saved'; firstName: string }
  | { type: 'saveFailed' }

export const initialState: FormState = {
  values: { firstName: '', lastName: '', email: '', phone: '' },
  errors: {},
  submitting: false,
  saved: null,
  saveFailed: false,
}

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change': {
      // A flagged email keeps its message until it holds a valid address (ST-9 AC-4).
      const stillFlagged = action.field === 'email' && state.errors.email !== undefined && emailError(action.value) !== undefined
      return {
        ...state,
        values: { ...state.values, [action.field]: action.value },
        errors: { ...state.errors, [action.field]: stillFlagged ? state.errors.email : undefined },
        saved: null,
      }
    }
    case 'submit':
      // One request at a time: a second Submit while saving is ignored.
      if (state.submitting) return state
      return { ...state, submitting: true, errors: {}, saved: null, saveFailed: false }
    case 'submitted':
      return { ...state, submitting: false }
    case 'failed':
      return { ...state, submitting: false, saveFailed: false, errors: action.errors }
    case 'saved':
      // The next visitor starts on an empty form; only the confirmation's first name remains.
      return { ...initialState, saved: action.firstName }
    case 'saveFailed':
      return { ...state, submitting: false, saveFailed: true }
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
