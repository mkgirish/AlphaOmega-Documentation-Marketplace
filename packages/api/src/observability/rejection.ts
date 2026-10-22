// ST-11 AC-5 — a refused registration is logged as exactly one registration.rejected event
// naming only the field and the rule it broke (AD-14). Issue messages are never logged: Zod
// quotes the received value in some of them, and an unknown key is submitted text too.
import type { ZodIssue } from 'zod'
import { Counter } from 'prom-client'
import { logger, metrics } from './index.js'

/** Why a registration was refused, and the status the API answers it with. */
export const REJECTION_STATUS = {
  validation: 400,
  malformed_json: 400,
  unsupported_media_type: 415,
  too_large: 413,
  cross_site: 403,
} as const

export type RejectionReason = keyof typeof REJECTION_STATUS

export interface FieldRejection {
  readonly field: string
  readonly rule: string
}

/** The one logger method this module needs; pino loggers and their children satisfy it. */
export interface EventLogger {
  info(obj: object, msg: string): void
}

/** Stands in for any path that is not a form field, including every unknown key. */
export const UNKNOWN_FIELD = '(unknown)'

/** Every rule name an event may carry; a custom refinement names one with params.rule. */
const RULES: ReadonlySet<string> = new Set([
  'required',
  'type',
  'too_short',
  'too_long',
  'format',
  'unrecognized_key',
  'nanp',
  'control_characters',
  'custom',
  'invalid',
])

// Field names are logged only if they look like a form field's identifier.
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/

const rejected = new Counter({
  name: 'registration_rejected_total',
  help: 'Registrations refused before anything was stored, by reason.',
  labelNames: ['reason'],
  registers: [metrics],
})

function ruleOf(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' ? 'required' : 'type'
    case 'too_small':
      return 'too_short'
    case 'too_big':
      return 'too_long'
    case 'invalid_string':
      return 'format'
    case 'unrecognized_keys':
      return 'unrecognized_key'
    case 'custom': {
      const rule: unknown = issue.params?.rule
      return typeof rule === 'string' && RULES.has(rule) ? rule : 'custom'
    }
    default:
      return 'invalid'
  }
}

/** Reduce Zod issues to field and rule pairs, once each, in issue order. */
export function fieldRejections(issues: readonly ZodIssue[], knownFields: readonly string[]): FieldRejection[] {
  const seen = new Set<string>()
  const out: FieldRejection[] = []
  for (const issue of issues) {
    const head = issue.code === 'unrecognized_keys' ? undefined : issue.path[0]
    const field = typeof head === 'string' && knownFields.includes(head) ? head : UNKNOWN_FIELD
    const rule = ruleOf(issue)
    const key = `${field}\u0000${rule}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ field, rule })
  }
  return out
}

/** Log the one registration.rejected event for a refused request and count it. */
export function recordRegistrationRejected(
  reason: RejectionReason,
  fields: readonly FieldRejection[] = [],
  log: EventLogger = logger,
): void {
  rejected.inc({ reason })
  log.info(
    {
      reason,
      status: REJECTION_STATUS[reason],
      // Rebuilt rather than passed through, so a caller cannot widen what is logged.
      fields: fields.map(({ field, rule }) => ({
        field: typeof field === 'string' && FIELD_NAME.test(field) ? field : UNKNOWN_FIELD,
        rule: typeof rule === 'string' && RULES.has(rule) ? rule : 'invalid',
      })),
    },
    'registration.rejected',
  )
}
