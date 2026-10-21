// AD-7 — the registration screen's reducer (SCR-1): one state machine over five statuses.
// Field rules and messages come from CMP-2 and the API; the reducer only carries them.

export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]
export type FormValues = Record<FieldName, string>
export type FieldErrors = Partial<Record<FieldName, string>>
export type FormStatus = 'editing' | 'invalid' | 'submitting' | 'saved' | 'saveFailed'

export interface FormState {
  readonly status: FormStatus
  readonly values: FormValues
  readonly fieldErrors: FieldErrors
  /** The server's message after a failed save, rendered verbatim. */
  readonly formError: string
  /** Kept only for the confirmation; RESET clears it. */
  readonly savedFirstName: string
}

export type FormAction =
  | { type: 'CHANGE'; field: FieldName; value: string }
  | { type: 'INVALID'; fieldErrors: FieldErrors }
  | { type: 'SUBMIT' }
  | { type: 'SAVED' }
  | { type: 'SAVE_FAILED'; message: string; fieldErrors?: FieldErrors }
  | { type: 'RESET' }

const blank: FormValues = { firstName: '', lastName: '', email: '', phone: '' }

export const initialState: FormState = {
  status: 'editing',
  values: blank,
  fieldErrors: {},
  formError: '',
  savedFirstName: '',
}

/** Statuses in which the visitor may edit and submit the form. */
const editable: ReadonlySet<FormStatus> = new Set(['editing', 'invalid', 'saveFailed'])

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'CHANGE': {
      if (!editable.has(state.status)) return state
      const { [action.field]: _cleared, ...fieldErrors } = state.fieldErrors
      return { ...state, values: { ...state.values, [action.field]: action.value }, fieldErrors }
    }
    case 'INVALID':
      if (!editable.has(state.status)) return state
      return { ...state, status: 'invalid', fieldErrors: action.fieldErrors }
    case 'SUBMIT':
      if (!editable.has(state.status)) return state
      return { ...state, status: 'submitting', fieldErrors: {}, formError: '' }
    case 'SAVED':
      if (state.status !== 'submitting') return state
      return { ...initialState, status: 'saved', savedFirstName: state.values.firstName }
    case 'SAVE_FAILED': {
      if (state.status !== 'submitting') return state
      const fieldErrors = action.fieldErrors ?? {}
      const status = Object.keys(fieldErrors).length > 0 ? 'invalid' : 'saveFailed'
      return { ...state, status, fieldErrors, formError: action.message }
    }
    case 'RESET':
      return initialState
    default:
      return state
  }
}
