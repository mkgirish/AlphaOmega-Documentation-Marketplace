import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialState, reducer, type FormAction } from './reducer.js'
import { attentionSummary, blankFieldErrors, focusField, requiredMessages, submitRegistration } from './required.js'

// ST-3 — the screen stops a Submit with an empty field before anything is sent, and says
// which field needs what. The rules are pure; the browser-only focus call is injected.
const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' } as const

const allMessages = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
} as const

/** Run one Submit through the handler and the reducer, as the screen does. */
function press(values: Record<keyof typeof valid, string>) {
  const actions: FormAction[] = []
  const focus = vi.fn()
  submitRegistration(values, (action) => actions.push(action), focus)
  const state = actions.reduce(reducer, { ...initialState, values })
  return { actions, focus, state }
}

describe('Feature: Be stopped when I leave a field empty', () => {
  describe('Scenario Outline: A missing field stops the registration @AC-1', () => {
    it.each([
      ['First name', 'firstName'],
      ['Last name', 'lastName'],
      ['Email', 'email'],
      ['Phone number', 'phone'],
    ] as const)('Given every field is valid except "%s", which is empty, When I press Submit, Then nothing is sent', (_label, field) => {
      const { actions, focus, state } = press({ ...valid, [field]: '' })
      expect(actions).toEqual([{ type: 'blocked', errors: { [field]: allMessages[field] } }])
      expect(actions.some((action) => action.type === 'submit')).toBe(false)
      expect(state.submitting).toBe(false)
      expect(Object.keys(state.errors)).toEqual([field])
      expect(focus.mock.calls).toEqual([[field]])
    })

    it('a fully filled form is not stopped by the required-field check', () => {
      expect(blankFieldErrors(valid)).toEqual({})
      const { actions, focus, state } = press(valid)
      expect(actions.some((action) => action.type === 'blocked')).toBe(false)
      expect(state.errors).toEqual({})
      expect(focus).not.toHaveBeenCalled()
    })
  })

  describe('Scenario: A field of only spaces counts as empty @AC-2', () => {
    it('Given "   " as the last name and valid values elsewhere, When I press Submit, Then it is flagged and nothing is sent', () => {
      const { actions, focus, state } = press({ ...valid, lastName: '   ' })
      expect(actions).toEqual([{ type: 'blocked', errors: { lastName: 'Enter your last name.' } }])
      expect(focus.mock.calls).toEqual([['lastName']])
      expect(state.submitting).toBe(false)
    })

    it('tabs, newlines and non-breaking spaces count as empty too; a value with spaces around it does not', () => {
      expect(blankFieldErrors({ ...valid, firstName: '\t \n', email: ' \u00a0 ' })).toEqual({
        firstName: allMessages.firstName,
        email: allMessages.email,
      })
      expect(blankFieldErrors({ ...valid, firstName: '  Jane  ' })).toEqual({})
    })
  })

  describe('Scenario: Each empty field says what it needs @AC-3', () => {
    it('Given the form is empty, When I press Submit, Then each field gets its own message, word for word', () => {
      expect(requiredMessages).toEqual(allMessages)
      const { actions, state } = press(initialState.values)
      expect(actions).toEqual([{ type: 'blocked', errors: allMessages }])
      expect(state.errors).toEqual(allMessages)
    })

    it('And focus moves to the first empty field in tab order', () => {
      expect(press(initialState.values).focus.mock.calls).toEqual([['firstName']])
      expect(press({ ...valid, email: '', lastName: ' ' }).focus.mock.calls).toEqual([['lastName']])
      expect(press({ ...valid, phone: '', email: '' }).focus.mock.calls).toEqual([['email']])
    })

    it('the error order follows the tab order whatever order the values arrive in', () => {
      const errors = blankFieldErrors({ phone: '', email: '', lastName: '', firstName: '' })
      expect(Object.keys(errors)).toEqual(['firstName', 'lastName', 'email', 'phone'])
    })

    it('And the summary reads how many fields need attention', () => {
      expect(attentionSummary(4)).toBe('4 fields need attention. Check the messages below.')
      expect(attentionSummary(2)).toBe('2 fields need attention. Check the messages below.')
      expect(attentionSummary(1)).toBe('1 field needs attention. Check the messages below.')
    })

    it('focusField puts the cursor in the input with that id, and is safe when it is missing', () => {
      const input = { focus: vi.fn() }
      const getElementById = vi.fn((id: string) => (id === 'email' ? input : null))
      vi.stubGlobal('document', { getElementById })
      focusField('email')
      expect(getElementById).toHaveBeenCalledWith('email')
      expect(input.focus).toHaveBeenCalledTimes(1)
      expect(() => focusField('phone')).not.toThrow()
    })
  })

  describe('Scenario: Nothing is flagged while I am still filling in the form @AC-4', () => {
    it('Given the form is empty, When I move through the fields without typing, Then no error is recorded', () => {
      let state = initialState
      for (const field of ['firstName', 'lastName', 'email', 'phone'] as const) {
        state = reducer(state, { type: 'change', field, value: '' })
      }
      expect(state.errors).toEqual({})
      expect(Object.values(state.errors).filter(Boolean)).toHaveLength(0)
    })

    it('typing into a flagged field clears only that field’s message until the next Submit', () => {
      const { state } = press(initialState.values)
      const next = reducer(state, { type: 'change', field: 'email', value: 'j' })
      expect(next.errors.email).toBeUndefined()
      expect(next.errors.firstName).toBe(allMessages.firstName)
    })
  })

  describe('Scenario: What I typed is kept when I missed a field @AC-5', () => {
    it('Given "Jane", "Doe" and "jane.doe@example.com" with the phone empty, When I press Submit, Then they are kept', () => {
      const values = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' }
      const { focus, state } = press(values)
      expect(state.values).toEqual(values)
      expect(state.errors).toEqual({ phone: allMessages.phone })
      expect(focus.mock.calls).toEqual([['phone']])
    })

    it('a value of only spaces is kept as typed, not trimmed away', () => {
      const values = { ...valid, lastName: '   ' }
      expect(press(values).state.values.lastName).toBe('   ')
    })
  })

  afterEach(() => vi.unstubAllGlobals())
})
