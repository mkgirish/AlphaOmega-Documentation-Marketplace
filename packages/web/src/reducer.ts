// AD-7 — the registration screen's reducer (SCR-1). One state machine holds the four
// visitor fields and the five screen states: editing, submitting, invalid (the server
// flagged fields), saveFailed and confirmed. A transition not listed is ignored.
import { registrationInput, type RegistrationInput } from '@app/shared'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

/** The five screen states (AD-7). */
export const statuses = ['editing', 'submitting', 'invalid', 'saveFailed', 'confirmed'] as const

export type Status = (typeof statuses)[number]

export interface FormState {
  readonly status: Status
  readonly values: Readonly<Record<FieldName, string>>
  readonly errors: FieldErrors
  /** True exactly while status is submitting. */
  readonly submitting: boolean
  /** The first name the confirmation greets; empty until a 201. */
  readonly confirmedName: string
}

export type FormAction =
  | { type: 'change'; field: FieldName; value: string }
  | { type: 'submit' }
  | { type: 'submitted'; firstName?: string }
  | { type: 'failed'; errors: FieldErrors }
  | { type: 'saveFailed' }
  | { type: 'reset' }

export const initialState: FormState = {
  status: 'editing',
  values: { firstName: '', lastName: '', email: '', phone: '' },
  errors: {},
  submitting: false,
  confirmedName: '',
}

const hasErrors = (errors: FieldErrors) => Object.values(errors).some((message) => message !== undefined)

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change': {
      // Editing a flagged field clears its message and red border without a new Submit;
      // editing after a failed save dismisses its alert.
      const errors = { ...state.errors, [action.field]: undefined }
      const settled = (state.status === 'invalid' && !hasErrors(errors)) || state.status === 'saveFailed'
      const status = settled ? 'editing' : state.status
      return { ...state, status, values: { ...state.values, [action.field]: action.value }, errors }
    }
    case 'submit':
      if (state.status === 'submitting' || state.status === 'confirmed') return state
      return { ...state, status: 'submitting', submitting: true, errors: {} }
    case 'submitted':
      if (state.status !== 'submitting') return state
      return { ...state, status: 'confirmed', submitting: false, confirmedName: action.firstName ?? '' }
    case 'failed':
      if (state.status !== 'submitting') return state
      return { ...state, status: hasErrors(action.errors) ? 'invalid' : 'saveFailed', submitting: false, errors: action.errors }
    case 'saveFailed':
      if (state.status !== 'submitting') return state
      return { ...state, status: 'saveFailed', submitting: false }
    case 'reset':
      return initialState
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
