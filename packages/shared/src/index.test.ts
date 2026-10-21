import { describe, expect, it } from 'vitest'
import { envelope, errorEnvelope, formatUtcSeconds, messages, normalise, registrationInput } from './index.js'

describe('shared registration rules (scaffold baseline)', () => {
  it('accepts a valid registration', () => {
    const parsed = registrationInput.safeParse({ fullName: 'Ada Lovelace', email: 'ada@example.com' })
    expect(parsed.success).toBe(true)
  })

  it('rejects a bad email', () => {
    const parsed = registrationInput.safeParse({ fullName: 'Ada', email: 'not-an-email' })
    expect(parsed.success).toBe(false)
  })

  it('normalises whitespace', () => {
    expect(normalise('  Ada   Lovelace  ')).toBe('Ada Lovelace')
  })

  it('formats whole UTC seconds', () => {
    expect(formatUtcSeconds(Date.UTC(2026, 0, 2, 3, 4, 5, 678))).toBe('2026-01-02T03:04:05Z')
  })

  it('wraps data and errors in the AD-5 envelopes', () => {
    expect(envelope({ ok: true })).toEqual({ data: { ok: true } })
    expect(errorEnvelope(messages.invalidEmail)).toEqual({ error: { message: 'Enter an email like name@example.com.' } })
  })
})
