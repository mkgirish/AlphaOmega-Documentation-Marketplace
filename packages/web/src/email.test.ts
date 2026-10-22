import { messages, registrationInput } from '@app/shared'
import { describe, expect, it } from 'vitest'
import { emailError } from './email.js'

// ST-9 — the screen's email check is CMP-2's rule and CMP-2's message, nothing of its own.
const sharedVerdict = (value: string) => (registrationInput.shape.email.safeParse(value).success ? undefined : messages.invalidEmail)

/** local@example.com padded to exactly `length` characters. */
const emailOfLength = (length: number) => `${'a'.repeat(length - '@example.com'.length)}@example.com`

describe('Feature: Be told when my email address is not complete', () => {
  describe('Scenario: A complete email is accepted @AC-1', () => {
    it('Then "jane.doe@example.com" is not flagged', () => {
      expect(emailError('jane.doe@example.com')).toBeUndefined()
    })
  })

  describe('Scenario Outline: An incomplete email is flagged @AC-2', () => {
    it.each(['jane', 'jane@', 'jane@example', '@example.com'])('Then "%s" is flagged with the shared email message', (email) => {
      expect(emailError(email)).toBe(messages.invalidEmail)
      expect(emailError(email)).toBe(sharedVerdict(email))
    })
  })

  describe('Scenario: An email of exactly 254 characters is accepted @AC-3', () => {
    it('Then the 254-character address is not flagged', () => {
      const email = emailOfLength(254)
      expect(email).toHaveLength(254)
      expect(email.endsWith('@example.com')).toBe(true)
      expect(emailError(email)).toBeUndefined()
    })
  })

  describe('Scenario: An over-long email is flagged @AC-3', () => {
    it('Then the 255-character address gets exactly the verdict and message the shared rule gives', () => {
      const email = emailOfLength(255)
      expect(email).toHaveLength(255)
      expect(emailError(email)).toBe(sharedVerdict(email))
    })
  })

  describe('the screen agrees with the shared rule on every case', () => {
    it.each(['', ' ', 'jane.doe@example.com', 'jane', 'jane@', 'jane@example', '@example.com', emailOfLength(254), emailOfLength(255)])(
      '"%s"',
      (email) => {
        expect(emailError(email)).toBe(sharedVerdict(email))
      },
    )
  })
})
