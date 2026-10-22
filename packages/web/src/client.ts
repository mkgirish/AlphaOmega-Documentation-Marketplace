// IF-2 consumer — POST /api/registrations, same origin, relative path only (AD-5). Each
// documented status maps to one outcome; anything else, or no answer, is a failed save.
import { fieldNames, type FieldErrors, type FieldName, type FormAction } from './reducer.js'

export const registrationsUrl = '/api/registrations'

export type SubmitOutcome = { kind: 'saved'; firstName: string } | { kind: 'invalid'; errors: FieldErrors } | { kind: 'failed' }

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export type Send = (values: Readonly<Record<FieldName, string>>) => Promise<SubmitOutcome>

const failed: SubmitOutcome = { kind: 'failed' }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The 400's per-field messages, verbatim; unknown keys and non-string entries are ignored. */
function fieldErrors(fields: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {}
  for (const name of fieldNames) {
    const messages = fields[name]
    if (!Array.isArray(messages)) continue
    const text = messages.filter((message): message is string => typeof message === 'string')
    if (text.length > 0) errors[name] = text.join(' ')
  }
  return errors
}

export async function submitRegistration(
  values: Readonly<Record<FieldName, string>>,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<SubmitOutcome> {
  try {
    const response = await fetchImpl(registrationsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, application/problem+json' },
      body: JSON.stringify(values),
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (response.status !== 201 && response.status !== 400) return failed
    const body: unknown = await response.json()
    if (response.status === 201) {
      return isObject(body) && typeof body.firstName === 'string' ? { kind: 'saved', firstName: body.firstName } : failed
    }
    if (isObject(body) && body.error === 'validation' && isObject(body.fields)) return { kind: 'invalid', errors: fieldErrors(body.fields) }
    return failed
  } catch {
    return failed
  }
}

export function outcomeToAction(outcome: SubmitOutcome): FormAction {
  switch (outcome.kind) {
    case 'saved':
      return { type: 'submitted', firstName: outcome.firstName }
    case 'invalid':
      return { type: 'failed', errors: outcome.errors }
    default:
      return { type: 'saveFailed' }
  }
}

/** One request at a time: a second submit while the first is in flight is dropped. */
export function createSubmitter(send: Send, dispatch: (action: FormAction) => void) {
  let inFlight = false
  return async (values: Readonly<Record<FieldName, string>>): Promise<void> => {
    if (inFlight) return
    inFlight = true
    dispatch({ type: 'submit' })
    try {
      dispatch(outcomeToAction(await send(values)))
    } catch {
      dispatch({ type: 'saveFailed' })
    } finally {
      inFlight = false
    }
  }
}
