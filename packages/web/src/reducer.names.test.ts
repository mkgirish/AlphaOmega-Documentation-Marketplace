import { describe, expect, it } from 'vitest'
import { initialState, reducer, statuses, type FormState } from './reducer.js'

// ST-10 / AD-7 — the five screen states and the transitions a name check walks through.
const long = (length: number) => 'a'.repeat(length)
const firstNameMessage = 'First name must be 100 characters or fewer.'
const filled: FormState = {
  ...initialState,
  values: { firstName: long(101), lastName: 'Dupont', email: 'anne@example.com', phone: '(415) 555-0132' },
}

describe('Feature: Have my real name accepted, with a clear limit on length — the reducer', () => {
  it('has exactly the five screen states', () => {
    expect(statuses).toEqual(['editing', 'submitting', 'invalid', 'saveFailed', 'confirmed'])
  })

  it('opens in editing with nobody confirmed', () => {
    expect(initialState.status).toBe('editing')
    expect(initialState.confirmedName).toBe('')
  })

  describe('Scenario: An over-long first name is flagged @AC-3', () => {
    it('submit moves editing to submitting and keeps every character typed', () => {
      const submitting = reducer(filled, { type: 'submit' })
      expect(submitting.status).toBe('submitting')
      expect(submitting.submitting).toBe(true)
      expect(submitting.values.firstName).toHaveLength(101)
    })

    it('a second submit while submitting is ignored — one request per tap', () => {
      const submitting = reducer(filled, { type: 'submit' })
      expect(reducer(submitting, { type: 'submit' })).toBe(submitting)
    })

    it('failed with field messages moves submitting to invalid, keeps all 101 characters and shows no confirmation', () => {
      const invalid = reducer(reducer(filled, { type: 'submit' }), { type: 'failed', errors: { firstName: firstNameMessage } })
      expect(invalid.status).toBe('invalid')
      expect(invalid.submitting).toBe(false)
      expect(invalid.errors).toEqual({ firstName: firstNameMessage })
      expect(invalid.values.firstName).toHaveLength(101)
      expect(invalid.confirmedName).toBe('')
    })

    it('failed with no field flagged (fields {}) is a failed save, not a form with no visible error', () => {
      const failed = reducer(reducer(filled, { type: 'submit' }), { type: 'failed', errors: {} })
      expect(failed.status).toBe('saveFailed')
      expect(failed.errors).toEqual({})
    })
  })

  describe('Scenario: The field keeps everything I typed @AC-4', () => {
    it('a change keeps all 101 characters — the reducer never truncates', () => {
      const typed = reducer(initialState, { type: 'change', field: 'firstName', value: long(101) })
      expect(typed.values.firstName).toBe(long(101))
      expect(typed.status).toBe('editing')
    })

    it('all 101 characters survive submit and a 400 so the message can be acted on', () => {
      const invalid = reducer(reducer(filled, { type: 'submit' }), { type: 'failed', errors: { firstName: firstNameMessage } })
      expect(invalid.values.firstName).toBe(long(101))
      expect(invalid.status).toBe('invalid')
    })
  })

  describe('Scenario: The name message clears once the name is short enough @AC-5', () => {
    const invalid = reducer(reducer(filled, { type: 'submit' }), { type: 'failed', errors: { firstName: firstNameMessage, lastName: 'x' } })

    it('deleting one character clears the first name message without pressing Submit', () => {
      const edited = reducer(invalid, { type: 'change', field: 'firstName', value: long(100) })
      expect(edited.errors.firstName).toBeUndefined()
      expect(edited.errors.lastName).toBe('x')
      expect(edited.status).toBe('invalid')
    })

    it('once no field is flagged the screen is back to editing', () => {
      const one = reducer(invalid, { type: 'change', field: 'firstName', value: long(100) })
      const both = reducer(one, { type: 'change', field: 'lastName', value: 'Dupont' })
      expect(both.errors).toEqual({})
      expect(both.status).toBe('editing')
    })
  })

  describe('Scenario Outline: Real-world names are accepted as written @AC-1', () => {
    it('submitted moves submitting to confirmed, greeting the name the server stored', () => {
      const confirmed = reducer(reducer(filled, { type: 'submit' }), { type: 'submitted', firstName: 'José' })
      expect(confirmed.status).toBe('confirmed')
      expect(confirmed.submitting).toBe(false)
      expect(confirmed.confirmedName).toBe('José')
    })

    it('submit after confirmation is ignored', () => {
      const confirmed = reducer(reducer(filled, { type: 'submit' }), { type: 'submitted', firstName: 'José' })
      expect(reducer(confirmed, { type: 'submit' })).toBe(confirmed)
    })
  })

  describe('failed saves', () => {
    it('saveFailed moves submitting to saveFailed and keeps the values for a retry', () => {
      const failed = reducer(reducer(filled, { type: 'submit' }), { type: 'saveFailed' })
      expect(failed.status).toBe('saveFailed')
      expect(failed.submitting).toBe(false)
      expect(failed.values).toEqual(filled.values)
    })

    it('editing after a failed save dismisses the alert and keeps the values', () => {
      const failed = reducer(reducer(filled, { type: 'submit' }), { type: 'saveFailed' })
      const edited = reducer(failed, { type: 'change', field: 'lastName', value: 'Dupond' })
      expect(edited.status).toBe('editing')
      expect(edited.values.firstName).toBe(long(101))
    })

    it('a retry from saveFailed submits again', () => {
      const failed = reducer(reducer(filled, { type: 'submit' }), { type: 'saveFailed' })
      expect(reducer(failed, { type: 'submit' }).status).toBe('submitting')
    })

    it('a response arriving when nothing is in flight is ignored', () => {
      expect(reducer(filled, { type: 'saveFailed' })).toBe(filled)
      expect(reducer(filled, { type: 'submitted', firstName: 'x' })).toBe(filled)
      expect(reducer(filled, { type: 'failed', errors: { firstName: 'y' } })).toBe(filled)
    })
  })

  it('reset leaves no value, error or first name behind', () => {
    const confirmed = reducer(reducer(filled, { type: 'submit' }), { type: 'submitted', firstName: 'José' })
    const reset = reducer(confirmed, { type: 'reset' })
    expect(reset).toEqual(initialState)
    expect(reset.confirmedName).toBe('')
    expect(reset.values.firstName).toBe('')
    expect(reset.errors).toEqual({})
  })
})
