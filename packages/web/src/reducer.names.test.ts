import { describe, expect, it } from 'vitest'
import { initialState, reducer, type FormState } from './reducer.js'

// ST-10 / AD-7 — the five phases of the registration screen and the transitions the name
// rules need: a flagged name clears on edit, a double submit is ignored, reset forgets all.
const values = { firstName: 'a'.repeat(101), lastName: "O'Brien", email: 'x@example.com', phone: '4155550132' }
const editing: FormState = { ...initialState, values }
const submitting = reducer(editing, { type: 'submit' })
const invalid = reducer(submitting, { type: 'failed', errors: { firstName: 'server first-name message' } })
const saveFailed = reducer(submitting, { type: 'saveFailed' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Siobhan' })

describe('Feature: Have my real name accepted, with a clear limit on length', () => {
  describe('the five phases', () => {
    it('opens editing, with no confirmation name', () => {
      expect(initialState.phase).toBe('editing')
      expect(initialState.confirmedName).toBe('')
    })

    it('editing → submitting on submit', () => {
      expect(submitting.phase).toBe('submitting')
      expect(submitting.submitting).toBe(true)
      expect(submitting.values).toEqual(values)
    })

    it('submitting → invalid on failed, keeping every character typed (AC-4)', () => {
      expect(invalid.phase).toBe('invalid')
      expect(invalid.submitting).toBe(false)
      expect(invalid.values.firstName).toHaveLength(101)
      expect(invalid.errors).toEqual({ firstName: 'server first-name message' })
    })

    it('submitting → saveFailed keeps the values and flags no field', () => {
      expect(saveFailed.phase).toBe('saveFailed')
      expect(saveFailed.submitting).toBe(false)
      expect(saveFailed.values).toEqual(values)
      expect(saveFailed.errors).toEqual({})
    })

    it('submitting → confirmed on submitted, forgetting every value but the greeting name', () => {
      expect(confirmed.phase).toBe('confirmed')
      expect(confirmed.submitting).toBe(false)
      expect(confirmed.confirmedName).toBe('Siobhan')
      expect(confirmed.values).toEqual(initialState.values)
    })

    it('submitted without a name greets by the first name typed', () => {
      const named = reducer({ ...submitting, values: { ...values, firstName: 'José' } }, { type: 'submitted' })
      expect(named.confirmedName).toBe('José')
    })

    it('saveFailed and invalid → submitting on the next submit', () => {
      expect(reducer(saveFailed, { type: 'submit' }).phase).toBe('submitting')
      const again = reducer(invalid, { type: 'submit' })
      expect(again.phase).toBe('submitting')
      expect(again.errors).toEqual({})
    })
  })

  describe('Scenario: The name message clears once the name is short enough @AC-5', () => {
    it('When I delete one character, Then the first name message is gone without pressing Submit', () => {
      const shortened = reducer(invalid, { type: 'change', field: 'firstName', value: 'a'.repeat(100) })
      expect(shortened.errors.firstName).toBeUndefined()
      expect(shortened.values.firstName).toHaveLength(100)
      expect(shortened.phase).toBe('editing')
    })

    it('editing one flagged name leaves the other flagged name’s message in place', () => {
      const both = reducer(submitting, { type: 'failed', errors: { firstName: 'f', lastName: 'l' } })
      const next = reducer(both, { type: 'change', field: 'firstName', value: 'Ada' })
      expect(next.errors).toEqual({ lastName: 'l' })
      expect(next.phase).toBe('invalid')
    })

    it('editing after a failed save keeps the save-failed phase until the next submit', () => {
      const next = reducer(saveFailed, { type: 'change', field: 'lastName', value: 'Dupont' })
      expect(next.phase).toBe('saveFailed')
      expect(next.values.lastName).toBe('Dupont')
    })
  })

  describe('forbidden transitions are ignored', () => {
    it('a second submit while submitting changes nothing', () => {
      expect(reducer(submitting, { type: 'submit' })).toBe(submitting)
    })

    it('typing while submitting or confirmed changes nothing', () => {
      expect(reducer(submitting, { type: 'change', field: 'firstName', value: 'x' })).toBe(submitting)
      expect(reducer(confirmed, { type: 'change', field: 'firstName', value: 'x' })).toBe(confirmed)
    })

    it('submit while confirmed changes nothing', () => {
      expect(reducer(confirmed, { type: 'submit' })).toBe(confirmed)
    })

    it.each([
      ['editing', editing],
      ['invalid', invalid],
      ['saveFailed', saveFailed],
      ['confirmed', confirmed],
    ])('a late outcome while %s changes nothing', (_name, state) => {
      expect(reducer(state, { type: 'submitted', firstName: 'x' })).toBe(state)
      expect(reducer(state, { type: 'failed', errors: { lastName: 'x' } })).toBe(state)
      expect(reducer(state, { type: 'saveFailed' })).toBe(state)
    })
  })

  describe('reset', () => {
    it.each([
      ['confirmed', confirmed],
      ['invalid', invalid],
      ['saveFailed', saveFailed],
    ])('from %s leaves no value, error or first name behind', (_name, state) => {
      const next = reducer(state, { type: 'reset' })
      expect(next).toEqual(initialState)
      expect(next.values.firstName).toBe('')
      expect(next.confirmedName).toBe('')
      expect(next.errors).toEqual({})
    })
  })
})
