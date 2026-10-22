// IF-2 — the screen's one call: POST /api/registrations, same origin, no credentials. Every
// response the contract documents maps to one outcome the reducer understands; anything the
// contract does not allow, and a network failure, is a failed save.
import { fieldNames, type FieldErrors, type FieldName } from './reducer.js'

export const registrationPath = '/api/registrations'

export type Outcome = { kind: 'saved'; firstName: string } | { kind: 'invalid'; errors: FieldErrors } | { kind: 'failed' }

export type Send = (input: string, init: RequestInit) => Promise<Response>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The 400 body's per-field messages, kept verbatim; fields the form does not have are dropped. */
function fieldErrors(fields: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {}
  for (const name of fieldNames) {
    const list = fields[name]
    const messages = Array.isArray(list) ? list.filter((message): message is string => typeof message === 'string') : []
    if (messages.length > 0) errors[name as FieldName] = messages.join(' ')
  }
  return errors
}

function outcome(status: number, body: unknown): Outcome {
  if (status === 201 && isRecord(body) && typeof body.firstName === 'string') return { kind: 'saved', firstName: body.firstName }
  if (status === 400 && isRecord(body) && body.error === 'validation' && isRecord(body.fields)) {
    return { kind: 'invalid', errors: fieldErrors(body.fields) }
  }
  return { kind: 'failed' }
}

/** Send the four values to IF-2 and map the answer to the screen's outcome. */
export async function submitRegistration(
  values: Readonly<Record<FieldName, string>>,
  send: Send = (input, init) => fetch(input, init),
): Promise<Outcome> {
  try {
    const response = await send(registrationPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, application/problem+json' },
      body: JSON.stringify(values),
      credentials: 'omit',
      cache: 'no-store',
    })
    const body: unknown = await response.json().catch(() => undefined)
    return outcome(response.status, body)
  } catch {
    return { kind: 'failed' }
  }
}
