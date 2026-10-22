// IF-2 — the screen's only request: POST /api/registrations on the page's own origin
// (AD-5). Every response the contract lists maps to one outcome; messages the server sends
// for a field are passed through verbatim, so the screen never words a rule itself (AD-3).
import { fieldNames, type FieldErrors, type FieldName } from './reducer.js'

export const REGISTRATIONS_PATH = '/api/registrations'

export type RegistrationValues = Readonly<Record<FieldName, string>>

export type SubmitOutcome = { kind: 'created'; firstName: string } | { kind: 'invalid'; fieldErrors: FieldErrors } | { kind: 'failed' }

type Send = (url: string, init: RequestInit) => Promise<Response>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** The first message per known field of a 400 ValidationProblem; anything else flags nothing. */
function fieldErrorsOf(body: unknown): FieldErrors {
  const errors: FieldErrors = {}
  if (!isRecord(body) || !isRecord(body.fields)) return errors
  for (const name of fieldNames) {
    const list = body.fields[name]
    if (Array.isArray(list) && typeof list[0] === 'string') errors[name] = list[0]
  }
  return errors
}

/** Send the four values exactly as entered; the API normalises and validates them. */
export async function submitRegistration(values: RegistrationValues, send: Send = fetch): Promise<SubmitOutcome> {
  const body = { firstName: values.firstName, lastName: values.lastName, email: values.email, phone: values.phone }
  let response: Response
  try {
    response = await send(REGISTRATIONS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { kind: 'failed' }
  }
  if (response.status === 201) {
    const created = await readJson(response)
    const firstName = isRecord(created) && typeof created.firstName === 'string' ? created.firstName : values.firstName
    return { kind: 'created', firstName }
  }
  if (response.status === 400) return { kind: 'invalid', fieldErrors: fieldErrorsOf(await readJson(response)) }
  return { kind: 'failed' }
}
