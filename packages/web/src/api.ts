// IF-2 — the screen's only request: POST /api/registrations on the page's own origin
// (AD-5). Every answer, and a network failure, becomes one SubmitOutcome; nothing throws.
import { fieldNames, type FieldErrors, type FieldName } from './reducer.js'

/** Same-origin and relative, so the submission can reach no other host (AC-6). */
export const registrationsPath = '/api/registrations'

export type SubmitOutcome =
  { kind: 'saved'; firstName?: string } | { kind: 'invalid'; fieldErrors: FieldErrors } | { kind: 'saveFailed'; status?: number }

const readJson = (response: Response): Promise<unknown> => response.json().catch(() => undefined)

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** A 400's fields, each field's server-sent messages kept verbatim; anything unreadable flags nothing. */
function fieldErrorsOf(body: unknown): FieldErrors {
  const fields = isRecord(body) && isRecord(body.fields) ? body.fields : {}
  const errors: FieldErrors = {}
  for (const name of fieldNames) {
    const messages = fields[name]
    if (Array.isArray(messages) && messages.length > 0) errors[name] = messages.join(' ')
  }
  return errors
}

export async function postRegistration(values: Readonly<Record<FieldName, string>>, fetcher: typeof fetch = fetch): Promise<SubmitOutcome> {
  let response: Response
  try {
    response = await fetcher(registrationsPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, application/problem+json' },
      body: JSON.stringify(values),
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch {
    return { kind: 'saveFailed' }
  }
  if (response.status === 201) {
    const body = await readJson(response)
    return isRecord(body) && typeof body.firstName === 'string' ? { kind: 'saved', firstName: body.firstName } : { kind: 'saved' }
  }
  if (response.status === 400) return { kind: 'invalid', fieldErrors: fieldErrorsOf(await readJson(response)) }
  return { kind: 'saveFailed', status: response.status }
}
