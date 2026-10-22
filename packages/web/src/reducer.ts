// AD-7 — the registration screen's reducer (SCR-1). One state machine holds the four
// visitor fields, the errors Submit found, and the save in flight or its outcome.
import { messages, registrationInput, type RegistrationInput } from '@app/shared'
import { isUsPhone, phoneMessage } from './phone.js'

/** The four visitor fields, in tab order. */
export const fieldNames = ['firstName', 'lastName', 'email', 'phone'] as const

export type FieldName = (typeof fieldNames)[number]

export type FieldErrors = Partial<Record<FieldName, string>>

export type FormValues = Readonly<Record<FieldName, string>>

export interface FormState {
  readonly values: FormValues
  readonly errors: FieldErrors
  readonly submitting: boolean
  /** Submit has been pressed at least once; nothing is flagged before it (ST-8 AC-7). */
  readonly attempted: boolean
  /** The first name the API saved, once a 201 arrives; the confirmation shows only then. */
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
  attempted: false,
  saved: null,
  saveFailed: false,
}

/** A flagged phone keeps its message until it holds a valid number (ST-8 AC-7); other fields clear on edit. */
function errorAfterChange(state: FormState, field: FieldName, value: string): string | undefined {
  const error = state.errors[field]
  return field === 'phone' && error !== undefined && !isUsPhone(value) ? error : undefined
}

export function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'change':
      return {
        ...state,
        values: { ...state.values, [action.field]: action.value },
        errors: { ...state.errors, [action.field]: errorAfterChange(state, action.field, action.value) },
      }
    case 'submit':
      if (state.submitting) return state
      return { ...state, submitting: true, attempted: true, errors: {}, saveFailed: false }
    case 'submitted':
      return { ...state, submitting: false }
    case 'failed':
      return { ...state, submitting: false, attempted: true, saveFailed: false, errors: action.errors }
    case 'saved':
      return { ...state, submitting: false, saved: action.firstName }
    case 'saveFailed':
      return { ...state, submitting: false, saveFailed: true }
    default:
      return state
  }
}

const labels: Readonly<Record<FieldName, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone number',
}

/** What Submit flags before anything is sent: empty fields, a malformed email, and a phone that is not a US number. */
export function validateForm(values: FormValues): FieldErrors {
  const errors: FieldErrors = {}
  for (const field of fieldNames) {
    if (values[field].trim() === '') errors[field] = messages.required(labels[field])
  }
  if (errors.email === undefined && !registrationInput.shape.email.safeParse(values.email.trim()).success)
    errors.email = messages.invalidEmail
  if (errors.phone === undefined && !isUsPhone(values.phone)) errors.phone = phoneMessage
  return errors
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
