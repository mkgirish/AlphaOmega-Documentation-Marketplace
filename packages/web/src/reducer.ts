// AD-7 — the registration screen's reducer (SCR-1). One state machine holds the four
// visitor fields and the five states of a submission (ST-2); a transition a state does not
// allow returns that state unchanged, so a double tap or a stray answer changes nothing.
import { registrationInput, type RegistrationInput } from '@app/shared'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

/** The five states of the screen (DG-5). */
export const statuses = ['editing', 'submitting', 'invalid', 'saveFailed', 'confirmed'] as const

export type Status = (typeof statuses)[number]

export interface FormState {
  readonly status: Status
  readonly values: Readonly<Record<FieldName, string>>
  readonly errors: FieldErrors
  /** True exactly while status is 'submitting'. */
  readonly submitting: boolean
  /** The first name the API answered 201 with; blank in every other state. */
  readonly firstName: string
  /** True when Submit was stopped on the screen for an empty field (ST-3); the summary box shows only then. */
  readonly blocked?: boolean
}

export type FormAction =
  | { type: 'change'; field: FieldName; value: string }
  | { type: 'submit' }
  | { type: 'submitted'; firstName?: string }
  | { type: 'failed'; errors: FieldErrors }
  | { type: 'blocked'; errors: FieldErrors }
  | { type: 'saveFailed' }
  | { type: 'reset' }

export const initialState: FormState = {
  status: 'editing',
  values: { firstName: '', lastName: '', email: '', phone: '' },
  errors: {},
  submitting: false,
  firstName: '',
}

const editable = (status: Status) => status === 'editing' || status === 'invalid' || status === 'saveFailed'

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change':
      if (!editable(state.status)) return state
      return { ...state, values: { ...state.values, [action.field]: action.value }, errors: { ...state.errors, [action.field]: undefined } }
    case 'submit':
      if (!editable(state.status)) return state
      return { ...state, status: 'submitting', submitting: true, errors: {}, blocked: undefined }
    case 'submitted':
      if (state.status !== 'submitting') return state
      return { ...initialState, status: 'confirmed', firstName: action.firstName ?? '' }
    case 'failed': {
      if (state.status !== 'submitting') return state
      const flagged = Object.values(action.errors).some(Boolean)
      return { ...state, status: flagged ? 'invalid' : 'saveFailed', submitting: false, errors: action.errors }
    }
    case 'blocked':
      if (!editable(state.status)) return state
      return { ...state, status: 'invalid', errors: action.errors, blocked: true }
    case 'saveFailed':
      if (state.status !== 'submitting') return state
      return { ...state, status: 'saveFailed', submitting: false, errors: {} }
    case 'reset':
      return state.status === 'confirmed' ? initialState : state
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
