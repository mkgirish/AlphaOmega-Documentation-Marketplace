// AD-7 — the registration screen's reducer (SCR-1). One state machine, five phases:
// editing → submitting → confirmed, invalid (fields flagged) or saveFailed; reset returns
// to a blank editing form. Transitions a phase does not allow return the state unchanged.
import { registrationInput, type RegistrationInput } from '@app/shared'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

export type Phase = 'editing' | 'submitting' | 'invalid' | 'saveFailed' | 'confirmed'

export interface FormState {
  readonly phase: Phase
  readonly values: Readonly<Record<FieldName, string>>
  readonly errors: FieldErrors
  readonly submitting: boolean
  /** The first name the confirmation greets; the only value kept once a visit is saved. */
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
  phase: 'editing',
  values: { firstName: '', lastName: '', email: '', phone: '' },
  errors: {},
  submitting: false,
  confirmedName: '',
}

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change': {
      if (state.phase === 'submitting' || state.phase === 'confirmed') return state
      // Editing a flagged field clears its message and red border at once, without another Submit (ST-10 AC-5).
      const errors: FieldErrors = { ...state.errors }
      delete errors[action.field]
      const phase = state.phase === 'invalid' && Object.keys(errors).length === 0 ? 'editing' : state.phase
      return { ...state, phase, values: { ...state.values, [action.field]: action.value }, errors }
    }
    case 'submit':
      if (state.phase === 'submitting' || state.phase === 'confirmed') return state
      return { ...state, phase: 'submitting', submitting: true, errors: {} }
    case 'submitted':
      if (state.phase !== 'submitting') return state
      return { ...initialState, phase: 'confirmed', confirmedName: action.firstName ?? state.values.firstName }
    case 'failed':
      if (state.phase !== 'submitting') return state
      return { ...state, phase: 'invalid', submitting: false, errors: action.errors }
    case 'saveFailed':
      if (state.phase !== 'submitting') return state
      return { ...state, phase: 'saveFailed', submitting: false }
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
