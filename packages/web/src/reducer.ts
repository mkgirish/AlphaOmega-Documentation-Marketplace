// AD-7 — the registration screen's reducer (SCR-1). One state machine holds the four
// visitor fields and the submission: editing → submitting → invalid | saveFailed | saved.
import { registrationInput, type RegistrationInput } from '@app/shared'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

/** The five states of the screen (AD-7). */
export type Status = 'editing' | 'submitting' | 'invalid' | 'saveFailed' | 'saved'

export interface FormState {
  readonly status: Status
  readonly values: Readonly<Record<FieldName, string>>
  readonly errors: FieldErrors
  /** True only in the submitting state. */
  readonly submitting: boolean
  /** The first name the API saved, shown by the confirmation. */
  readonly confirmedName: string
}

export type FormAction =
  | { type: 'change'; field: FieldName; value: string }
  | { type: 'submit' }
  | { type: 'submitted'; firstName?: string }
  | { type: 'failed'; errors: FieldErrors }
  | { type: 'saveFailed' }

export const initialState: FormState = {
  status: 'editing',
  values: { firstName: '', lastName: '', email: '', phone: '' },
  errors: {},
  submitting: false,
  confirmedName: '',
}

const settle = (state: FormState, status: Status, errors: FieldErrors): FormState => ({ ...state, status, errors, submitting: false })

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change':
      return {
        ...state,
        status: state.submitting ? 'submitting' : 'editing',
        values: { ...state.values, [action.field]: action.value },
        errors: { ...state.errors, [action.field]: undefined },
      }
    case 'submit':
      // One request per visit: a second Submit while one is in flight is ignored.
      return state.submitting ? state : { ...state, status: 'submitting', submitting: true, errors: {} }
    case 'submitted':
      return state.submitting ? { ...settle(state, 'saved', {}), confirmedName: action.firstName ?? '' } : state
    case 'failed':
      // The API's field errors (400): the values are kept, no alert, no confirmation.
      return state.submitting ? settle(state, 'invalid', action.errors) : state
    case 'saveFailed':
      return state.submitting ? settle(state, 'saveFailed', {}) : state
    default:
      return state
  }
}

/** The first flagged field in tab order — where focus goes when the screen shows errors. */
export function firstInvalidField(errors: FieldErrors): FieldName | undefined {
  return fieldNames.find((name) => errors[name])
}

/** In the invalid state, move focus to the first flagged input (after it has rendered its error). */
export function focusFirstError(state: FormState, getElement: (id: string) => { focus: () => void } | null): void {
  if (state.status !== 'invalid') return
  const first = firstInvalidField(state.errors)
  if (first) getElement(first)?.focus()
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
