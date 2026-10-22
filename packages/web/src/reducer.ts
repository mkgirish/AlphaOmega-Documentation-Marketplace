// AD-7 — the registration screen's reducer (SCR-1). One state machine, five states (DG-5):
// editing → submitting → confirmed | invalid | saveFailed, and confirmed → editing on RESET.
// Every transition not listed returns the state untouched, so a forbidden action is a no-op.
import { registrationInput, type RegistrationInput } from '@app/shared'
import { copy } from './copy.js'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

export type Status = 'editing' | 'submitting' | 'invalid' | 'saveFailed' | 'confirmed'

export interface FormState {
  readonly status: Status
  readonly values: Readonly<Record<FieldName, string>>
  readonly errors: FieldErrors
  /** Mirrors status === 'submitting'. */
  readonly submitting: boolean
  /** The first name the API saved; shown only on the confirmation. */
  readonly confirmedName: string
  /** The polite live region's text. */
  readonly announcement: string
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
  announcement: '',
}

/** Whether SUBMIT is allowed: never twice in flight, never from the confirmation. */
export function canSubmit(state: FormState): boolean {
  return state.status !== 'submitting' && state.status !== 'confirmed'
}

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change':
      if (!canSubmit(state)) return state
      return {
        ...state,
        values: { ...state.values, [action.field]: action.value },
        errors: { ...state.errors, [action.field]: undefined },
        announcement: '',
      }
    case 'submit':
      if (!canSubmit(state)) return state
      return { ...state, status: 'submitting', submitting: true, errors: {}, announcement: '' }
    case 'submitted':
      // The confirmation keeps only the saved first name; the submitted values are dropped.
      if (state.status !== 'submitting') return state
      return { ...initialState, status: 'confirmed', confirmedName: action.firstName ?? '' }
    case 'failed':
      if (state.status !== 'submitting') return state
      return { ...state, status: 'invalid', submitting: false, errors: action.errors }
    case 'saveFailed':
      if (state.status !== 'submitting') return state
      return { ...state, status: 'saveFailed', submitting: false }
    case 'reset':
      if (state.status !== 'confirmed') return state
      return { ...initialState, announcement: copy.formCleared }
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
