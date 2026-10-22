import { messages, registrationInput } from '@app/shared'
import { describe, expect, it, vi } from 'vitest'
import { fieldErrors, initialState, reducer, type FormAction, type FormState } from './reducer.js'
import { submit } from './submit.js'

// ST-9 — the email rule and its message come only from the shared rules (CMP-2); the screen
// decides when to show and clear them.
const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }
const withEmail = (email: string) => ({ ...valid, email })

/** An email of the given length in local@domain.tld form, ending in "@example.com". */
const emailOfLength = (length: number) => `${'a'.repeat(length - '@example.com'.length)}@example.com`

const incomplete = ['jane', 'jane@', 'jane@example', '@example.com']

/** A form event whose controls record which one received focus. */
function fakeEvent() {
  const focused: string[] = []
  const event = {
    preventDefault: vi.fn(),
    currentTarget: {
      elements: {
        namedItem: (name: string) => ({ focus: () => focused.push(name) }),
      },
    },
  }
  return { event: event as unknown as Parameters<typeof submit>[0], focused, preventDefault: event.preventDefault }
}

function submitWith(values: FormState['values']) {
  const actions: FormAction[] = []
  const { event, focused, preventDefault } = fakeEvent()
  submit(event, values, (action) => actions.push(action))
  return { actions, focused, preventDefault }
}

describe('Feature: Be told when my email address is not complete', () => {
  describe('Scenario: A complete email is accepted @AC-1', () => {
    it('Given valid name and phone values, When "jane.doe@example.com" is the email, Then no field is flagged', () => {
      expect(fieldErrors(valid)).toEqual({})
    })

    it('And pressing Submit flags nothing, moves no focus and never lets the browser navigate', () => {
      const { actions, focused, preventDefault } = submitWith(valid)
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(actions).toEqual([])
      expect(focused).toEqual([])
    })
  })

  describe('Scenario Outline: An incomplete email is flagged @AC-2', () => {
    it.each(incomplete)('When "%s" is the email, Then the shared email message is the email error', (email) => {
      expect(fieldErrors(withEmail(email))).toEqual({ email: messages.invalidEmail })
    })

    it.each(incomplete)('When "%s" is entered and Submit pressed, Then the email is flagged and focused, nothing is sent', (email) => {
      const { actions, focused, preventDefault } = submitWith(withEmail(email))
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(actions).toEqual([{ type: 'failed', errors: { email: messages.invalidEmail } }])
      expect(actions.some((action) => action.type === 'submit')).toBe(false)
      expect(focused).toEqual(['email'])
    })

    it.each(incomplete)('And the reducer holds the message for "%s" and is not submitting', (email) => {
      const typed = reducer(initialState, { type: 'change', field: 'email', value: email })
      const { actions } = submitWith(typed.values)
      const flagged = actions.reduce(reducer, typed)
      expect(flagged.errors.email).toBe(messages.invalidEmail)
      expect(flagged.submitting).toBe(false)
      expect(flagged.values.email).toBe(email)
    })
  })

  describe('Scenario: An email of exactly 254 characters is accepted @AC-3', () => {
    it('When a 254-character address ending in "@example.com" is the email, Then it is not flagged', () => {
      const email = emailOfLength(254)
      expect(email).toHaveLength(254)
      expect(email.endsWith('@example.com')).toBe(true)
      expect(fieldErrors(withEmail(email))).toEqual({})
      expect(submitWith(withEmail(email)).actions).toEqual([])
    })
  })

  describe('Scenario: An over-long email is flagged @AC-3', () => {
    it.each([255, 321, 400])('a %i-character address is flagged exactly when the shared rule rejects it', (length) => {
      const email = emailOfLength(length)
      expect(email).toHaveLength(length)
      const sharedAccepts = registrationInput.shape.email.safeParse(email).success
      expect(fieldErrors(withEmail(email))).toEqual(sharedAccepts ? {} : { email: messages.invalidEmail })
    })

    it('an address the shared rule rejects for length alone carries the same message as an incomplete one', () => {
      const email = emailOfLength(400)
      expect(registrationInput.shape.email.safeParse(email).success).toBe(false)
      expect(fieldErrors(withEmail(email))).toEqual(fieldErrors(withEmail('jane@')))
    })
  })

  describe('the screen accepts and rejects exactly what the shared rule does', () => {
    it.each([
      'jane.doe@example.com',
      'jane@example.co.uk',
      'jane',
      'jane@',
      'jane@example',
      '@example.com',
      'jane doe@example.com',
      'jane@@example.com',
      '',
    ])('"%s"', (email) => {
      const sharedAccepts = registrationInput.shape.email.safeParse(email).success
      expect(fieldErrors(withEmail(email)).email === undefined).toBe(sharedAccepts)
    })

    it('judges the address after the shared normalise(), so stray outer spaces are not a fault', () => {
      expect(fieldErrors(withEmail('  jane.doe@example.com '))).toEqual({})
    })

    it('flags only the email: the other fields are never judged by the email rule', () => {
      expect(fieldErrors({ firstName: '', lastName: '', email: 'jane@', phone: '' })).toEqual({ email: messages.invalidEmail })
    })
  })

  describe('Scenario: The email message clears once the address is fixed @AC-4', () => {
    const flagged: FormState = {
      ...initialState,
      values: withEmail('jane@'),
      errors: { email: messages.invalidEmail },
    }

    it('Given "jane@" was flagged, When the email becomes "jane@example.com", Then the message is gone without Submit', () => {
      const fixed = reducer(flagged, { type: 'change', field: 'email', value: 'jane@example.com' })
      expect(fixed.errors.email).toBeUndefined()
      expect(fixed.values.email).toBe('jane@example.com')
      expect(fixed.submitting).toBe(false)
    })

    it('typing the fix one key at a time keeps the message until the address is complete, then drops it', () => {
      let state = flagged
      const seen: (string | undefined)[] = []
      for (const value of ['jane@e', 'jane@example', 'jane@example.', 'jane@example.c', 'jane@example.co', 'jane@example.com']) {
        state = reducer(state, { type: 'change', field: 'email', value })
        seen.push(state.errors.email)
      }
      expect(seen.slice(0, 4)).toEqual(Array(4).fill(messages.invalidEmail))
      expect(seen.slice(4)).toEqual([undefined, undefined])
    })

    it('an email that was never flagged is not flagged while it is being typed', () => {
      const typing = reducer(initialState, { type: 'change', field: 'email', value: 'j' })
      expect(typing.errors.email).toBeUndefined()
    })

    it('editing another field leaves the email message in place', () => {
      const next = reducer(flagged, { type: 'change', field: 'phone', value: '4155550132' })
      expect(next.errors.email).toBe(messages.invalidEmail)
    })

    it('a fixed email is not flagged again on the next Submit', () => {
      const fixed = reducer(flagged, { type: 'change', field: 'email', value: 'jane@example.com' })
      expect(submitWith(fixed.values).actions).toEqual([])
    })
  })
})
