// AD-14 registration.rejected: one event per refused registration, naming only the field
// and the rule that refused it. Submitted values, attacker-chosen keys and free-text
// messages never reach the log; anything that is not a known form field or a short
// snake_case rule code is collapsed before it is written.
import { registrationInput } from '@app/shared'
import { Counter } from 'prom-client'
import { logger, metrics, type Logger } from './logger.js'

/** Why a registration was refused, one per gate the API applies. */
export type RejectionReason = 'validation' | 'malformed' | 'unsupported_media_type' | 'too_large' | 'cross_site'

const STATUS: Readonly<Record<RejectionReason, number>> = {
  validation: 400,
  malformed: 400,
  unsupported_media_type: 415,
  too_large: 413,
  cross_site: 403,
}

/** The parts of a Zod issue the log may draw on; everything else is ignored. */
export interface IssueLike {
  readonly code: string
  readonly path: readonly (string | number)[]
  readonly received?: unknown
  readonly validation?: unknown
}

export interface RejectedField {
  readonly field: string
  readonly rule: string
}

/** Stands in for any issue not tied to a form field: unexpected keys, a non-object body. */
export const BODY_FIELD = '(body)'
const RULE = /^[a-z_]{1,40}$/
const INVALID_RULE = 'invalid'

const formFields: ReadonlySet<string> = new Set(Object.keys(registrationInput.shape))

function fieldOf(issue: IssueLike): string {
  const head = issue.path[0]
  return typeof head === 'string' && formFields.has(head) ? head : BODY_FIELD
}

function ruleOf(issue: IssueLike): string {
  const rule =
    issue.code === 'invalid_type' && issue.received === 'undefined'
      ? 'required'
      : issue.code === 'invalid_string' && typeof issue.validation === 'string'
        ? issue.validation
        : issue.code
  return RULE.test(rule) ? rule : INVALID_RULE
}

/** The distinct field/rule pairs behind a refusal, safe to log as they are. */
export function rejectedFields(issues: readonly IssueLike[]): RejectedField[] {
  const seen = new Set<string>()
  const fields: RejectedField[] = []
  for (const issue of issues) {
    const entry = { field: fieldOf(issue), rule: ruleOf(issue) }
    const key = `${entry.field}\u0000${entry.rule}`
    if (seen.has(key)) continue
    seen.add(key)
    fields.push(entry)
  }
  return fields
}

const rejectedTotal = new Counter({
  name: 'registration_rejected_total',
  help: 'Registrations refused, by the gate that refused them.',
  labelNames: ['reason'] as const,
  registers: [metrics],
})

export interface Rejection {
  readonly reason: RejectionReason
  readonly issues?: readonly IssueLike[]
  readonly reqId?: string
}

/** Log one registration.rejected event and count it. */
export function recordRegistrationRejected(rejection: Rejection, log: Logger = logger): void {
  const event = {
    ...(rejection.reqId === undefined ? {} : { reqId: rejection.reqId }),
    reason: rejection.reason,
    status: STATUS[rejection.reason],
    fields: rejectedFields(rejection.issues ?? []),
  }
  log.info(event, 'registration.rejected')
  rejectedTotal.inc({ reason: rejection.reason })
}
