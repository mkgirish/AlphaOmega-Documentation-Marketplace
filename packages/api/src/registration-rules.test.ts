import { describe, expect, it } from 'vitest'
import { EMAIL_MAX_LENGTH, EMAIL_MESSAGE, fieldErrors, registrationBody } from './registration-rules.js'

// ST-9: the email rule the API applies to every POST /api/registrations body.
const NAME = 'Jane Doe'
const emailOf = (length: number): string => `${'a'.repeat(length - '@example.com'.length)}@example.com`

function emailErrors(email: unknown): { path: string; message: string }[] {
  const parsed = registrationBody.safeParse({ fullName: NAME, email })
  return parsed.success ? [] : fieldErrors(parsed.error).filter((f) => f.path === 'email')
}

describe('the email rule @story:ST-9', () => {
  it('uses the story message and the 254-character limit', () => {
    expect(EMAIL_MESSAGE).toBe('Enter an email like name@example.com.')
    expect(EMAIL_MAX_LENGTH).toBe(254)
  })

  it('accepts a complete address and keeps it as entered @criterion:AC-1', () => {
    const parsed = registrationBody.parse({ fullName: NAME, email: 'jane.doe@example.com' })
    expect(parsed).toEqual({ fullName: NAME, email: 'jane.doe@example.com' })
  })

  it.each(['jane', 'jane@', 'jane@example', '@example.com'])(
    'rejects the incomplete address %j with the email message @criterion:AC-2 @criterion:AC-5',
    (email) => {
      expect(emailErrors(email)).toEqual([{ path: 'email', message: EMAIL_MESSAGE }])
    },
  )

  it.each(['', '   ', 'jane doe@example.com', 'jane@@example.com', 'jane@example.', 'jane@.com', 42, null])(
    'rejects %j with the email message',
    (email) => {
      expect(emailErrors(email)).toEqual([{ path: 'email', message: EMAIL_MESSAGE }])
    },
  )

  it('rejects a missing email with the email message', () => {
    const parsed = registrationBody.safeParse({ fullName: NAME })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(fieldErrors(parsed.error)).toEqual([{ path: 'email', message: EMAIL_MESSAGE }])
  })

  it('accepts exactly 254 characters and rejects 255 @criterion:AC-3', () => {
    expect(emailOf(254)).toHaveLength(254)
    expect(emailErrors(emailOf(254))).toEqual([])
    expect(emailOf(255)).toHaveLength(255)
    expect(emailErrors(emailOf(255))).toEqual([{ path: 'email', message: EMAIL_MESSAGE }])
  })

  it('trims surrounding whitespace before checking and counting', () => {
    expect(registrationBody.parse({ fullName: ` ${NAME} `, email: ' jane.doe@example.com ' })).toEqual({
      fullName: NAME,
      email: 'jane.doe@example.com',
    })
    expect(emailErrors(`  ${emailOf(254)}  `)).toEqual([])
  })

  it('reports each field once, and nothing for a body that is not a registration object', () => {
    const parsed = registrationBody.safeParse({ fullName: '', email: 'jane@' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(fieldErrors(parsed.error).map((f) => f.path)).toEqual(['fullName', 'email'])
    }
    for (const body of [null, [], 'jane@example.com', { fullName: NAME, email: 'jane.doe@example.com', extra: 1 }]) {
      const result = registrationBody.safeParse(body)
      expect(result.success).toBe(false)
      if (!result.success) expect(fieldErrors(result.error)).toEqual([])
    }
  })
})
