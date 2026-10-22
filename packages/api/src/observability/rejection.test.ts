import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLogger, metrics } from './index.js'
import { REJECTION_STATUS, fieldRejections, recordRegistrationRejected, type FieldRejection, type RejectionReason } from './rejection.js'

// ST-11 AC-5 and the observability-no-pii anchors: a refused registration is logged as
// exactly one registration.rejected event naming only the field and rule, never a value.
const FORM_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const

// A stand-in for the CMP-2 rules with the same shape: four strict string fields.
const form = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    phone: z.string().regex(/^\d{10}$/),
  })
  .strict()

const SENTINEL = 'leak-check@bad'
const VALID = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

function issuesOf(body: unknown): z.ZodIssue[] {
  const result = form.safeParse(body)
  if (result.success) throw new Error('expected the body to be refused')
  return result.error.issues
}

function capture(): { lines: () => Record<string, unknown>[]; raw: () => string; stream: Writable } {
  let raw = ''
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      raw += chunk.toString()
      callback()
    },
  })
  return {
    stream,
    raw: () => raw,
    lines: () =>
      raw
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

async function rejectedCount(reason: RejectionReason): Promise<number> {
  const metric = await metrics.getSingleMetric('registration_rejected_total')?.get()
  return metric?.values.find((v) => v.labels.reason === reason)?.value ?? 0
}

describe('fieldRejections', () => {
  it('names a missing email as required (AC-1)', () => {
    const { email: _email, ...body } = VALID
    expect(fieldRejections(issuesOf(body), FORM_FIELDS)).toEqual([{ field: 'email', rule: 'required' }])
  })

  it('lists every invalid field and none of the valid ones (AC-2)', () => {
    const rejections = fieldRejections(issuesOf({ ...VALID, email: 'jane@', phone: '5550132' }), FORM_FIELDS)
    expect(rejections).toEqual([
      { field: 'email', rule: 'format' },
      { field: 'phone', rule: 'format' },
    ])
    const fields = rejections.map((r) => r.field)
    expect(fields).not.toContain('firstName')
    expect(fields).not.toContain('lastName')
  })

  it('maps lengths and wrong types to their rules', () => {
    const rejections = fieldRejections(
      issuesOf({ firstName: '   ', lastName: 'x'.repeat(101), email: 42, phone: '4155550132' }),
      FORM_FIELDS,
    )
    expect(rejections).toEqual([
      { field: 'firstName', rule: 'too_short' },
      { field: 'lastName', rule: 'too_long' },
      { field: 'email', rule: 'type' },
    ])
  })

  it('refuses a field not in the form without naming the submitted key (AC-3)', () => {
    expect(fieldRejections(issuesOf({ ...VALID, id: 5 }), FORM_FIELDS)).toEqual([{ field: '(unknown)', rule: 'unrecognized_key' }])
    // A key is submitted text too: one that carries a value is never logged.
    expect(fieldRejections(issuesOf({ ...VALID, [SENTINEL]: 1, id: 5 }), FORM_FIELDS)).toEqual([
      { field: '(unknown)', rule: 'unrecognized_key' },
    ])
  })

  it('reports a body that is not an object against no form field', () => {
    expect(fieldRejections(issuesOf([SENTINEL]), FORM_FIELDS)).toEqual([{ field: '(unknown)', rule: 'type' }])
  })

  it('takes a custom rule name only when it is a plain identifier', () => {
    const named = z.string().superRefine((_v, ctx) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, params: { rule: 'nanp' } })
    })
    const unnamed = z.string().superRefine((value, ctx) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, params: { rule: value } })
    })
    const schema = z.object({ phone: named, email: unnamed })
    const result = schema.safeParse({ phone: '4155550132', email: SENTINEL })
    if (result.success) throw new Error('expected the body to be refused')
    expect(fieldRejections(result.error.issues, FORM_FIELDS)).toEqual([
      { field: 'phone', rule: 'nanp' },
      { field: 'email', rule: 'custom' },
    ])
  })

  it('never carries an issue message, which can quote the submitted value', () => {
    const schema = z.object({ phone: z.enum(['a', 'b']), email: z.literal('x') })
    const result = schema.safeParse({ phone: SENTINEL, email: SENTINEL })
    if (result.success) throw new Error('expected the body to be refused')
    expect(result.error.issues.some((issue) => issue.message.includes(SENTINEL))).toBe(true)
    const rejections = fieldRejections(result.error.issues, FORM_FIELDS)
    expect(rejections).toEqual([
      { field: 'phone', rule: 'invalid' },
      { field: 'email', rule: 'invalid' },
    ])
    expect(JSON.stringify(rejections)).not.toContain(SENTINEL)
  })

  it('reports each field and rule once', () => {
    const schema = z.object({ email: z.string().email().regex(/^a/) })
    const result = schema.safeParse({ email: 'nope' })
    if (result.success) throw new Error('expected the body to be refused')
    expect(result.error.issues).toHaveLength(2)
    expect(fieldRejections(result.error.issues, FORM_FIELDS)).toEqual([{ field: 'email', rule: 'format' }])
  })
})

describe('recordRegistrationRejected', () => {
  it('maps each reason to the status the API answers with', () => {
    expect(REJECTION_STATUS).toEqual({
      validation: 400,
      malformed_json: 400,
      unsupported_media_type: 415,
      too_large: 413,
      cross_site: 403,
    })
  })

  it('writes exactly one registration.rejected event naming field and rule (AC-5)', () => {
    const out = capture()
    const log = createLogger(out.stream)
    const body = { ...VALID, email: SENTINEL }
    recordRegistrationRejected('validation', fieldRejections(issuesOf(body), FORM_FIELDS), log)

    const lines = out.lines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 30,
      msg: 'registration.rejected',
      reason: 'validation',
      status: 400,
      fields: [{ field: 'email', rule: 'format' }],
    })
    expect(out.raw()).not.toContain(SENTINEL)
  })

  it.each(FORM_FIELDS)('never logs the value submitted in %s', (field) => {
    const out = capture()
    // Long enough to break the name limits, no domain dot for email, no digits for phone.
    const sentinel = `SENTINEL-${field}-\u202e@x${'x'.repeat(100)}`
    const body = { ...VALID, [field]: sentinel }
    recordRegistrationRejected('validation', fieldRejections(issuesOf(body), FORM_FIELDS), createLogger(out.stream))
    expect(out.lines()).toHaveLength(1)
    expect(out.lines()[0]?.fields).toEqual([{ field, rule: expect.any(String) }])
    expect(out.raw()).not.toContain(sentinel)
    expect(out.raw()).not.toContain(`SENTINEL-${field}`)
  })

  it.each([
    ['malformed_json', 400],
    ['unsupported_media_type', 415],
    ['too_large', 413],
    ['cross_site', 403],
  ] as const)('logs a %s refusal with status %i and no fields (AC-3, AC-4)', (reason, status) => {
    const out = capture()
    recordRegistrationRejected(reason, undefined, createLogger(out.stream))
    expect(out.lines()).toEqual([expect.objectContaining({ msg: 'registration.rejected', reason, status, fields: [] })])
  })

  it('advances the rejection counter for its reason only', async () => {
    const out = capture()
    const log = createLogger(out.stream)
    const before = { validation: await rejectedCount('validation'), tooLarge: await rejectedCount('too_large') }
    recordRegistrationRejected('validation', [{ field: 'email', rule: 'required' }], log)
    recordRegistrationRejected('validation', [{ field: 'phone', rule: 'format' }], log)
    expect(await rejectedCount('validation')).toBe(before.validation + 2)
    expect(await rejectedCount('too_large')).toBe(before.tooLarge)
    const snapshot = await metrics.metrics()
    expect(snapshot).toContain('# TYPE registration_rejected_total counter')
    expect(snapshot).not.toContain('field=')
  })

  it('keeps each concurrent request on its own reqId', async () => {
    const out = capture()
    const log = createLogger(out.stream)
    const reqIds = Array.from({ length: 20 }, (_, i) => `req-${i}`)
    await Promise.all(
      reqIds.map(async (reqId, i) => {
        await new Promise((resolve) => setTimeout(resolve, (i * 7) % 5))
        recordRegistrationRejected('validation', [{ field: 'email', rule: 'required' }], log.child({ reqId }))
      }),
    )
    const seen = out.lines().map((line) => line.reqId)
    expect(seen).toHaveLength(reqIds.length)
    expect(new Set(seen)).toEqual(new Set(reqIds))
  })

  it('does not let a caller smuggle extra keys into the event', () => {
    const out = capture()
    const smuggled = { field: 'email', rule: 'required', value: SENTINEL } as FieldRejection
    recordRegistrationRejected('validation', [smuggled], createLogger(out.stream))
    expect(out.lines()[0]?.fields).toEqual([{ field: 'email', rule: 'required' }])
    expect(out.raw()).not.toContain(SENTINEL)
  })

  it('writes to the shared stdout logger when none is given', () => {
    expect(() => recordRegistrationRejected('cross_site')).not.toThrow()
  })
})

describe('createLogger', () => {
  it('writes JSON lines with no host address to the given destination', () => {
    const out = capture()
    createLogger(out.stream).info({ port: 3000 }, 'registration-api listening')
    const [line] = out.lines()
    expect(line).toMatchObject({ level: 30, msg: 'registration-api listening', port: 3000 })
    expect(line).not.toHaveProperty('hostname')
  })
})
