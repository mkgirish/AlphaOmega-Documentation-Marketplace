import { Writable } from 'node:stream'
import { registrationInput } from '@app/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createLogger, logger, metrics, recordRegistrationRejected, rejectedFields, type RejectionReason } from './index.js'

// ST-11 AC-5 and the observability-no-pii anchors: a refused registration leaves exactly one
// registration.rejected event naming only the field and the rule — never a submitted value,
// never an attacker-chosen key, never an IP — and advances the rejection counter.
const SENTINEL = 'leak-check@bad'
const FORM_FIELDS = Object.keys(registrationInput.shape)

interface Captured {
  readonly log: ReturnType<typeof createLogger>
  readonly lines: () => Record<string, unknown>[]
  readonly raw: () => string
}

function capture(): Captured {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString('utf8'))
      done()
    },
  })
  const log = createLogger(stream)
  const raw = () => chunks.join('')
  const lines = () =>
    raw()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  return { log, lines, raw }
}

function issuesFor(body: unknown) {
  const result = registrationInput.strict().safeParse(body)
  if (result.success) throw new Error('expected the body to be refused')
  return result.error.issues
}

async function rejectedCount(reason: RejectionReason): Promise<number> {
  const metric = await metrics.getSingleMetric('registration_rejected_total')?.get()
  return metric?.values.find((value) => value.labels.reason === reason)?.value ?? 0
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rejectedFields @story:ST-11 @criterion:AC-5', () => {
  it('names a missing form field with the rule "required"', () => {
    expect(rejectedFields([{ code: 'invalid_type', path: ['email'], received: 'undefined' }])).toEqual([
      { field: 'email', rule: 'required' },
    ])
  })

  it('names a string-format failure by its validation and other failures by their code', () => {
    expect(
      rejectedFields([
        { code: 'invalid_string', path: ['email'], validation: 'email' },
        { code: 'too_big', path: ['email'] },
        { code: 'invalid_type', path: ['email'], received: 'number' },
        { code: 'invalid_string', path: ['email'], validation: { includes: SENTINEL } },
      ]),
    ).toEqual([
      { field: 'email', rule: 'email' },
      { field: 'email', rule: 'too_big' },
      { field: 'email', rule: 'invalid_type' },
      { field: 'email', rule: 'invalid_string' },
    ])
  })

  it('reports one entry per field and rule, however many issues repeat it', () => {
    const issue = { code: 'too_small', path: ['email'] }
    expect(rejectedFields([issue, issue, { ...issue, path: ['email', 0] }])).toEqual([{ field: 'email', rule: 'too_small' }])
  })

  it('never names a key the form does not have: unexpected keys, root issues and odd paths collapse to "(body)"', () => {
    // As Zod reports it: the unexpected keys ride on the issue, never on its path.
    const unexpected = { code: 'unrecognized_keys', path: [], keys: ['id', SENTINEL] }
    const fields = rejectedFields([
      unexpected,
      { code: 'custom', path: [SENTINEL] },
      { code: 'custom', path: [0] },
      { code: 'invalid_type', path: [], received: 'array' },
    ])
    expect(fields).toEqual([
      { field: '(body)', rule: 'unrecognized_keys' },
      { field: '(body)', rule: 'custom' },
      { field: '(body)', rule: 'invalid_type' },
    ])
    expect(JSON.stringify(fields)).not.toContain(SENTINEL)
    expect(JSON.stringify(fields)).not.toContain('"id"')
  })

  it('never lets a rule carry free text: anything but a short snake_case code becomes "invalid"', () => {
    expect(
      rejectedFields([
        { code: `custom ${SENTINEL}`, path: ['email'] },
        { code: 'x'.repeat(41), path: ['email'] },
        { code: 'invalid_string', path: ['email'], validation: SENTINEL },
      ]),
    ).toEqual([{ field: 'email', rule: 'invalid' }])
  })

  it('accepts every field the shared registration rules define, straight from real Zod issues', () => {
    const fields = rejectedFields(issuesFor({}))
    expect(fields.map((entry) => entry.field).sort()).toEqual([...FORM_FIELDS].sort())
    expect(fields.every((entry) => entry.rule === 'required')).toBe(true)
  })
})

describe('recordRegistrationRejected @story:ST-11 @criterion:AC-5', () => {
  it('logs exactly one registration.rejected naming the field and rule, never the submitted value', () => {
    const { log, lines, raw } = capture()
    const body = Object.fromEntries(FORM_FIELDS.map((field) => [field, field === 'email' ? SENTINEL : 'Jane']))

    recordRegistrationRejected({ reason: 'validation', issues: issuesFor(body), reqId: 'req-1' }, log)

    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toMatchObject({
      level: 30,
      msg: 'registration.rejected',
      reason: 'validation',
      status: 400,
      reqId: 'req-1',
      fields: [{ field: 'email', rule: 'email' }],
    })
    expect(raw()).not.toContain(SENTINEL)
  })

  it('keeps every per-field sentinel and the unexpected key out of the log', () => {
    const { log, raw, lines } = capture()
    const body: Record<string, unknown> = Object.fromEntries(FORM_FIELDS.map((field) => [field, `${SENTINEL}-${field}-${'z'.repeat(400)}`]))
    body[`${SENTINEL}-key`] = `${SENTINEL}-extra`

    recordRegistrationRejected({ reason: 'validation', issues: issuesFor(body) }, log)

    expect(lines()).toHaveLength(1)
    expect(raw()).not.toContain(SENTINEL)
    expect(raw()).not.toMatch(/z{20}/)
    const fields = lines()[0]?.fields as { field: string; rule: string }[]
    expect(fields).toContainEqual({ field: '(body)', rule: 'unrecognized_keys' })
    expect(fields.every((entry) => entry.field === '(body)' || FORM_FIELDS.includes(entry.field))).toBe(true)
  })

  it('records no IP, no headers and no body — only the fixed event keys', () => {
    const { log, lines } = capture()

    recordRegistrationRejected({ reason: 'validation', issues: [{ code: 'invalid_type', path: ['email'], received: 'undefined' }] }, log)

    const line = lines()[0] ?? {}
    expect(Object.keys(line).sort()).toEqual(['fields', 'hostname', 'level', 'msg', 'pid', 'reason', 'status', 'time'])
    expect(JSON.stringify(line)).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b|remoteAddress|"ip"/)
  })

  it.each<[RejectionReason, number]>([
    ['malformed', 400],
    ['unsupported_media_type', 415],
    ['too_large', 413],
    ['cross_site', 403],
  ])('logs a %s refusal once with status %i and an empty field list', (reason, status) => {
    const { log, lines } = capture()

    recordRegistrationRejected({ reason, reqId: 'req-2' }, log)

    expect(lines()).toEqual([expect.objectContaining({ msg: 'registration.rejected', reason, status, reqId: 'req-2', fields: [] })])
  })

  it('advances registration_rejected_total for the refusal reason only', async () => {
    const { log } = capture()
    const before = { validation: await rejectedCount('validation'), too_large: await rejectedCount('too_large') }

    recordRegistrationRejected({ reason: 'validation', issues: [{ code: 'too_small', path: ['email'] }] }, log)
    recordRegistrationRejected({ reason: 'validation', issues: [{ code: 'too_small', path: ['email'] }] }, log)

    expect(await rejectedCount('validation')).toBe(before.validation + 2)
    expect(await rejectedCount('too_large')).toBe(before.too_large)
    const exposition = await metrics.metrics()
    expect(exposition).toContain('# TYPE registration_rejected_total counter')
    expect(exposition).not.toContain(SENTINEL)
  })

  it('keeps reqIds apart when refusals interleave', async () => {
    const { log, lines } = capture()

    await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        Promise.resolve().then(() => recordRegistrationRejected({ reason: 'cross_site', reqId: `req-${n}` }, log)),
      ),
    )

    const reqIds = lines().map((line) => line.reqId)
    expect(reqIds).toHaveLength(20)
    expect(new Set(reqIds).size).toBe(20)
  })

  it('writes to the process logger when no logger is given', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)

    recordRegistrationRejected({ reason: 'too_large' })

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith({ reason: 'too_large', status: 413, fields: [] }, 'registration.rejected')
  })

  it('a real refusal of the shared rules never puts the value in the log, whatever the field', () => {
    for (const field of FORM_FIELDS) {
      const { log, raw } = capture()
      const schema = z.object({ [field]: z.string().max(0) })
      const result = schema.safeParse({ [field]: `${SENTINEL}-${field}` })
      if (result.success) throw new Error('expected a refusal')

      recordRegistrationRejected({ reason: 'validation', issues: result.error.issues }, log)

      expect(raw()).toContain(`"field":"${field}"`)
      expect(raw()).not.toContain(SENTINEL)
    }
  })
})
