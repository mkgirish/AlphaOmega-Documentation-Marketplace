import { describe, expect, it, vi } from 'vitest'
import { firstInvalidField, focusFirstError, initialState, reducer, type FormState } from './reducer.js'

// AD-7 — the screen's one state machine: editing, submitting, invalid, saveFailed, saved.
const typed: FormState = {
  ...initialState,
  values: { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' },
}
const submitting = reducer(typed, { type: 'submit' })
const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

describe('Feature: Keep bad data out even when the screen is bypassed', () => {
  describe('Scenario: The screen shows the API’s field errors next to my fields @AC-6', () => {
    it('opens in the editing state', () => {
      expect(initialState.status).toBe('editing')
      expect(initialState.confirmedName).toBe('')
    })

    it('Given valid values, When I press Submit, the screen is submitting with no errors shown', () => {
      expect(submitting.status).toBe('submitting')
      expect(submitting.submitting).toBe(true)
      expect(submitting.errors).toEqual({})
      expect(submitting.values).toEqual(typed.values)
    })

    it('a second Submit while submitting changes nothing (one request per visit)', () => {
      expect(reducer(submitting, { type: 'submit' })).toBe(submitting)
    })

    it('Then the API’s phone message is a field error, the values are kept and the state is invalid — not saveFailed or saved', () => {
      const invalid = reducer(submitting, { type: 'failed', errors: { phone: phoneMessage } })
      expect(invalid.status).toBe('invalid')
      expect(invalid.submitting).toBe(false)
      expect(invalid.errors).toEqual({ phone: phoneMessage })
      expect(invalid.values).toEqual(typed.values)
      expect(invalid.confirmedName).toBe('')
    })

    it('a 400 with fields {} is invalid with no field flagged', () => {
      const invalid = reducer(submitting, { type: 'failed', errors: {} })
      expect(invalid.status).toBe('invalid')
      expect(invalid.errors).toEqual({})
      expect(invalid.values).toEqual(typed.values)
    })

    it('a failed save keeps the values and shows no field error', () => {
      const failed = reducer(submitting, { type: 'saveFailed' })
      expect(failed.status).toBe('saveFailed')
      expect(failed.submitting).toBe(false)
      expect(failed.errors).toEqual({})
      expect(failed.values).toEqual(typed.values)
    })

    it('only a 201 reaches saved, carrying the saved first name', () => {
      const saved = reducer(submitting, { type: 'submitted', firstName: 'Jane' })
      expect(saved.status).toBe('saved')
      expect(saved.submitting).toBe(false)
      expect(saved.confirmedName).toBe('Jane')
    })

    it('an outcome that arrives when nothing is submitting changes nothing', () => {
      for (const state of [initialState, typed]) {
        expect(reducer(state, { type: 'failed', errors: { phone: phoneMessage } })).toBe(state)
        expect(reducer(state, { type: 'saveFailed' })).toBe(state)
        expect(reducer(state, { type: 'submitted', firstName: 'Jane' })).toBe(state)
      }
    })

    it('editing a flagged field clears only its error and returns to editing; Submit can be pressed again', () => {
      const invalid = reducer(submitting, { type: 'failed', errors: { email: 'x', phone: phoneMessage } })
      const edited = reducer(invalid, { type: 'change', field: 'phone', value: '4155550133' })
      expect(edited.status).toBe('editing')
      expect(edited.errors.phone).toBeUndefined()
      expect(edited.errors.email).toBe('x')
      expect(reducer(edited, { type: 'submit' }).status).toBe('submitting')
      expect(reducer(invalid, { type: 'submit' }).status).toBe('submitting')
      expect(reducer(reducer(submitting, { type: 'saveFailed' }), { type: 'submit' }).status).toBe('submitting')
    })

    it('typing while submitting keeps the submitting state', () => {
      const next = reducer(submitting, { type: 'change', field: 'firstName', value: 'Janet' })
      expect(next.status).toBe('submitting')
      expect(next.submitting).toBe(true)
    })

    it('the first flagged field, in tab order, is the one focus goes to', () => {
      expect(firstInvalidField({ phone: phoneMessage })).toBe('phone')
      expect(firstInvalidField({ phone: 'p', lastName: 'l', email: 'e' })).toBe('lastName')
      expect(firstInvalidField({ firstName: undefined, email: 'e' })).toBe('email')
      expect(firstInvalidField({})).toBeUndefined()
    })

    it('And focus moves to the first flagged input once the invalid state is shown', () => {
      const focus = vi.fn()
      const getElement = vi.fn(() => ({ focus }))
      focusFirstError(reducer(submitting, { type: 'failed', errors: { phone: phoneMessage } }), getElement)
      expect(getElement).toHaveBeenCalledWith('phone')
      expect(focus).toHaveBeenCalledTimes(1)
    })

    it('focus is left alone in every other state, when nothing is flagged, or when the input is missing', () => {
      const focus = vi.fn()
      const getElement = vi.fn(() => ({ focus }))
      for (const state of [
        initialState,
        submitting,
        reducer(submitting, { type: 'saveFailed' }),
        reducer(submitting, { type: 'failed', errors: {} }),
      ]) {
        focusFirstError(state, getElement)
      }
      focusFirstError({ ...typed, errors: { phone: phoneMessage } }, getElement)
      expect(getElement).not.toHaveBeenCalled()
      expect(focus).not.toHaveBeenCalled()
      expect(() => focusFirstError(reducer(submitting, { type: 'failed', errors: { phone: phoneMessage } }), () => null)).not.toThrow()
    })
  })
})
