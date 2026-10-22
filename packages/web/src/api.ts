// IF-2 — the screen's only request: POST /api/registrations, same-origin and relative
// (single-screen-only). Each response becomes exactly one reducer action; the messages
// a 400 carries are CMP-2's, rendered verbatim, so the screen owns no copy of a rule.
import { normalise } from '@app/shared'
import { fieldNames, type FieldErrors, type FieldName, type FormAction } from './reducer.js'

/** A request that has not answered by then is a failed save, so the kiosk never hangs. */
const timeoutMs = 15_000

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export type ResponseAction = Extract<FormAction, { type: 'submitted' | 'failed' | 'saveFailed' }>

/** The first message the server sent for each visitor field; anything else is ignored. */
function fieldErrors(body: unknown): FieldErrors {
  const fields = (body as { fields?: unknown } | null)?.fields
  const errors: FieldErrors = {}
  if (typeof fields !== 'object' || fields === null) return errors
  for (const name of fieldNames) {
    const messages = (fields as Partial<Record<FieldName, unknown>>)[name]
    if (Array.isArray(messages) && typeof messages[0] === 'string' && messages[0] !== '') errors[name] = messages[0]
  }
  return errors
}

const readJson = (response: Response): Promise<unknown> => response.json().catch(() => null)

export async function submitRegistration(values: Readonly<Record<FieldName, string>>, fetchFn: Fetch = fetch): Promise<ResponseAction> {
  let response: Response
  try {
    response = await fetchFn('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
      // Anonymous by contract (AD-13): no cookie rides along.
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { type: 'saveFailed' }
  }
  if (response.status === 201) {
    const body = (await readJson(response)) as { firstName?: unknown } | null
    const firstName = typeof body?.firstName === 'string' ? body.firstName : normalise(values.firstName)
    return { type: 'submitted', firstName }
  }
  if (response.status === 400) return { type: 'failed', errors: fieldErrors(await readJson(response)) }
  return { type: 'saveFailed' }
}
