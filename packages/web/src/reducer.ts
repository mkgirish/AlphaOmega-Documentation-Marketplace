// AD-7 — the registration screen's reducer (SCR-1). One state machine holds the four
// visitor fields and the five screen states (DG-5); any transition not listed below is
// forbidden and answered with the very same state.
import { normalise, registrationInput, type RegistrationInput } from '@app/shared'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

/** DG-5: editing → submitting → confirmed | invalid | saveFailed; confirmed → editing on reset. */
export type Status = 'editing' | 'submitting' | 'invalid' | 'saveFailed' | 'confirmed'

export interface FormState {
  readonly status: Status
  readonly values: Readonly<Record<FieldName, string>>
  readonly errors: FieldErrors
  /** True only while the save is in progress (status 'submitting'). */
  readonly submitting: boolean
  /** The first name the confirmation thanks; empty in every other state. */
  readonly firstName: string
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
      return { ...state, status: 'submitting', submitting: true, errors: {} }
    case 'submitted':
      if (state.status !== 'submitting') return state
      // The values go as soon as the visit is saved; only the first name to thank stays.
      return { ...initialState, status: 'confirmed', firstName: action.firstName ?? normalise(state.values.firstName) }
    case 'failed':
      if (state.status !== 'submitting') return state
      // A 400 that names no field leaves nothing to fix: it is a failed save.
      if (Object.keys(action.errors).length === 0) return { ...state, status: 'saveFailed', submitting: false, errors: {} }
      return { ...state, status: 'invalid', submitting: false, errors: action.errors }
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
