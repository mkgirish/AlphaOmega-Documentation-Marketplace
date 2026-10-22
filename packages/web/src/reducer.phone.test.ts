import { describe, expect, it, vi } from 'vitest'
import { formErrors, initialState, reducer, type FormState } from './reducer.js'
import { submitForm } from './submit.js'

// ST-8 — the phone rule in the screen's reducer: flagged only on Submit (AC-2, AC-3), and
// cleared as soon as a flagged phone holds a valid number (AC-7).
const message = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const filled = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }

const changePhone = (state: FormState, value: string) => reducer(state, { type: 'change', field: 'phone', value })

describe('Feature: Enter a US phone number and be told exactly when it is wrong — the reducer', () => {
  it('opens with no Submit attempted', () => {
    expect(initialState.attempted).toBe(false)
  })

  describe('Scenario Outline: Common ways of writing a US number are accepted @AC-1', () => {
    it.each(['(415) 555-0132', '4155550132', '415.555.0132'])('a valid phone "%s" raises no phone error', (phone) => {
      expect(formErrors({ ...filled, phone })).toEqual({})
    })
  })

  describe('Scenario Outline: Numbers that are not a 10-digit US number are rejected @AC-2 @AC-3', () => {
    it.each(['(555) 013-2', '41555501329', '(015) 555-0132', '14155550132', '(415) 055-0132', '(415) 155-0132', '1155550132', ''])(
      'flags phone "%s" with the phone message only',
      (phone) => {
        expect(formErrors({ ...filled, phone })).toEqual({ phone: message })
      },
    )

    it('a failed Submit records the attempt and the phone error', () => {
      const failed = reducer(changePhone(initialState, '(555) 013-2'), { type: 'failed', errors: { phone: message } })
      expect(failed.attempted).toBe(true)
      expect(failed.errors).toEqual({ phone: message })
      expect(failed.values.phone).toBe('(555) 013-2')
    })
  })

  describe('Scenario: The phone message clears once the number is fixed @AC-7', () => {
    const flagged = reducer(changePhone(initialState, '(555) 013-2'), { type: 'failed', errors: { phone: message } })

    it('Given I pressed Submit with phone "5550132", When I change the phone to "4155550132", Then the phone message is gone without pressing Submit', () => {
      let state = flagged
      for (const value of ['(555) 013', '(555', '', '(4', '(415) 555-013']) {
        state = changePhone(state, value)
        expect(state.errors.phone, value).toBe(message)
      }
      state = changePhone(state, '(415) 555-0132')
      expect(state.errors.phone).toBeUndefined()
      expect(state.attempted).toBe(true)
    })

    it('a phone that was not flagged stays unflagged after a Submit, even while it is invalid', () => {
      const other = reducer(initialState, { type: 'failed', errors: { firstName: 'x' } })
      const next = changePhone(other, '(555')
      expect(next.attempted).toBe(true)
      expect(next.errors.phone).toBeUndefined()
      expect(next.errors.firstName).toBe('x')
    })
  })

  describe('Scenario: Nothing is flagged while I am still typing @AC-7', () => {
    it('Given I have not pressed Submit yet, When I type "555" in the phone field and move to another field, Then no phone message is shown', () => {
      let state = initialState
      for (const value of ['(5', '(55', '(555']) state = changePhone(state, value)
      state = reducer(state, { type: 'change', field: 'email', value: 'a' })
      expect(state.errors).toEqual({ phone: undefined, email: undefined })
      expect(state.attempted).toBe(false)
    })
  })

  describe('pressing Submit', () => {
    it('with an invalid phone dispatches the phone error and moves focus to the phone field', () => {
      const dispatch = vi.fn()
      const focus = vi.fn()
      submitForm({ ...filled, phone: '(555) 013-2' }, dispatch, focus)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch).toHaveBeenCalledWith({ type: 'failed', errors: { phone: message } })
      expect(focus).toHaveBeenCalledTimes(1)
      expect(focus).toHaveBeenCalledWith('phone')
    })

    it('with a valid phone flags nothing and leaves focus alone', () => {
      const dispatch = vi.fn()
      const focus = vi.fn()
      submitForm({ ...filled, phone: '(415) 555-0132' }, dispatch, focus)
      expect(dispatch).not.toHaveBeenCalled()
      expect(focus).not.toHaveBeenCalled()
    })
  })
})
