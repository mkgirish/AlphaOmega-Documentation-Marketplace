// SCR-1 — the screen's client for POST /api/registrations (IF-2) and the submitter around
// it (ST-11). The API is the authority on every field: its 400 field errors are shown
// verbatim next to the matching fields, with focus moved to the first one (AC-6).
import { fieldNames, type FieldErrors, type FieldName, type FormAction } from './reducer.js'

/** Same-origin and relative: the bundle calls nothing else. */
export const registrationsPath = '/api/registrations'

export type SubmitOutcome = { kind: 'created' } | { kind: 'invalid'; errors: FieldErrors } | { kind: 'failed' }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The first message for each visitor field in an AD-5 validation envelope,
 * {"error":"validation","fields":{<field>:[<message>, ...]}}; undefined for any other body.
 * Fields the form does not have are dropped, so nothing is flagged that cannot be fixed.
 */
export function readFieldErrors(body: unknown): FieldErrors | undefined {
  if (!isRecord(body) || body.error !== 'validation' || !isRecord(body.fields)) return undefined
  const errors: FieldErrors = {}
  for (const name of fieldNames) {
    const messages = Object.hasOwn(body.fields, name) ? body.fields[name] : undefined
    if (Array.isArray(messages) && typeof messages[0] === 'string') errors[name] = messages[0]
  }
  return errors
}

/** POST the four values; every status other than 201 or a field-error 400 is a save failure. */
export async function sendRegistration(
  values: Readonly<Record<FieldName, string>>,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitOutcome> {
  try {
    const response = await fetchImpl(registrationsPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ firstName: values.firstName, lastName: values.lastName, email: values.email, phone: values.phone }),
    })
    if (response.status === 201) return { kind: 'created' }
    if (response.status === 400) {
      const errors = readFieldErrors(await response.json().catch(() => undefined))
      if (errors !== undefined) return { kind: 'invalid', errors }
    }
    return { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}

/** The first flagged field in tab order — where focus goes after a refusal. */
export function firstInvalid(errors: FieldErrors): FieldName | undefined {
  return fieldNames.find((name) => errors[name] !== undefined)
}

export interface SubmitterDeps {
  readonly send: (values: Readonly<Record<FieldName, string>>) => Promise<SubmitOutcome>
  readonly dispatch: (action: FormAction) => void
  readonly focus: (field: FieldName) => void
}

/**
 * One submission at a time: a second tap while a request is in flight sends nothing. The
 * confirmation and the save-failed alert land with their stories; until then a save failure
 * keeps the values and flags no field.
 */
export function createSubmitter({ send, dispatch, focus }: SubmitterDeps): (values: Readonly<Record<FieldName, string>>) => Promise<void> {
  let inFlight = false
  return async (values) => {
    if (inFlight) return
    inFlight = true
    let outcome: SubmitOutcome
    try {
      dispatch({ type: 'submit' })
      outcome = await Promise.resolve()
        .then(() => send(values))
        .catch((): SubmitOutcome => ({ kind: 'failed' }))
    } finally {
      inFlight = false
    }
    if (outcome.kind === 'created') {
      dispatch({ type: 'submitted' })
      return
    }
    const errors = outcome.kind === 'invalid' ? outcome.errors : {}
    dispatch({ type: 'failed', errors })
    const first = firstInvalid(errors)
    if (first !== undefined) focus(first)
  }
}
