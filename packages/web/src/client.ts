// IF-2 consumer — POST /api/registrations, same origin only. Every status the contract lists
// maps to one outcome; the screen shows the confirmation only on a 201.
import { fieldNames, type FieldErrors, type FieldName } from './reducer.js'

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export type SaveOutcome = { kind: 'saved'; firstName: string } | { kind: 'invalid'; errors: FieldErrors } | { kind: 'failed' }

const failed: SaveOutcome = { kind: 'failed' }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The first server message per known field, verbatim; anything else in fields is ignored. */
function fieldErrors(fields: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {}
  for (const name of fieldNames) {
    const list = fields[name]
    if (Array.isArray(list) && typeof list[0] === 'string') errors[name] = list[0]
  }
  return errors
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** Send the four values as entered; the API normalises and validates them with CMP-2. */
export async function postRegistration(values: Readonly<Record<FieldName, string>>, fetchFn: Fetch = fetch): Promise<SaveOutcome> {
  let response: Response
  try {
    response = await fetchFn('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
  } catch {
    return failed
  }
  if (response.status === 201) {
    const body = await readJson(response)
    return isRecord(body) && typeof body.firstName === 'string' ? { kind: 'saved', firstName: body.firstName } : failed
  }
  if (response.status === 400) {
    const body = await readJson(response)
    if (isRecord(body) && body.error === 'validation' && isRecord(body.fields)) return { kind: 'invalid', errors: fieldErrors(body.fields) }
  }
  return failed
}
