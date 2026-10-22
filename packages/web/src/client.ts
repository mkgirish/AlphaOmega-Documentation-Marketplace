// IF-2 consumer — the screen's one request (AD-5): POST the four values, as typed, to the
// same-origin /api/registrations, and read the answer strictly as the contract shapes it.
import { fieldNames, type FieldErrors, type FormState } from './reducer.js'

export const registrationsPath = '/api/registrations'

export type Outcome =
  { kind: 'created'; firstName: string; createdAt: string } | { kind: 'invalid'; fieldErrors: FieldErrors } | { kind: 'failed' }

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const failed: Outcome = { kind: 'failed' }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

/** 201: the normalised first name and createdAt — nothing else is read, so no row id can surface. */
function created(body: unknown): Outcome {
  if (!isRecord(body) || typeof body.firstName !== 'string' || typeof body.createdAt !== 'string') return failed
  return { kind: 'created', firstName: body.firstName, createdAt: body.createdAt }
}

/** 400: each field's CMP-2 messages, verbatim; a field with no message is never flagged. */
function invalid(body: unknown): Outcome {
  if (!isRecord(body) || !isRecord(body.fields)) return failed
  const fieldErrors: FieldErrors = {}
  for (const name of fieldNames) {
    const messages = body.fields[name]
    if (messages === undefined) continue
    if (!isStringList(messages)) return failed
    if (messages.length > 0) fieldErrors[name] = messages.join(' ')
  }
  return { kind: 'invalid', fieldErrors }
}

export async function postRegistration(values: FormState['values'], fetchImpl: Fetch = (url, init) => fetch(url, init)): Promise<Outcome> {
  try {
    const response = await fetchImpl(registrationsPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, application/problem+json' },
      body: JSON.stringify(values),
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (response.status === 201) return created(await response.json())
    if (response.status === 400) return invalid(await response.json())
    return failed
  } catch {
    return failed
  }
}
