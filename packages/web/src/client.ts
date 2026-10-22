// ST-8 — the IF-2 client: POST /api/registrations on the page's own origin (AD-5). Every
// status the contract lists maps to one outcome; only a 201 confirms.
import { fieldNames, type FieldErrors, type FormValues } from './reducer.js'
import { phoneDigits } from './phone.js'

/** IF-2 RegistrationRequest. */
export interface RegistrationRequest {
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone: string
}

export type SubmitResult = { kind: 'saved'; firstName: string } | { kind: 'invalid'; errors: FieldErrors } | { kind: 'failed' }

export type Send = (input: string, init: RequestInit) => Promise<Response>

/** The request body; the phone goes as its digits, as the store keeps it (AC-1). */
export function toRequest(values: FormValues): RegistrationRequest {
  return { firstName: values.firstName, lastName: values.lastName, email: values.email, phone: phoneDigits(values.phone) }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/** IF-2 ValidationProblem.fields → the first message per known field, verbatim; fields {} flags none. */
function fieldErrors(body: unknown): FieldErrors {
  const errors: FieldErrors = {}
  const fields = isRecord(body) ? body.fields : undefined
  if (!isRecord(fields)) return errors
  for (const field of fieldNames) {
    const list = fields[field]
    if (Array.isArray(list) && typeof list[0] === 'string') errors[field] = list[0]
  }
  return errors
}

export async function submitRegistration(values: FormValues, send: Send): Promise<SubmitResult> {
  let response: Response
  try {
    response = await send('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toRequest(values)),
    })
  } catch {
    return { kind: 'failed' }
  }
  if (response.status === 400) return { kind: 'invalid', errors: fieldErrors(await json(response)) }
  if (response.status !== 201) return { kind: 'failed' }
  const body = await json(response)
  return isRecord(body) && typeof body.firstName === 'string' ? { kind: 'saved', firstName: body.firstName } : { kind: 'failed' }
}
