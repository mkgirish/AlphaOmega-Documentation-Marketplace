import { messages } from '@app/shared'
import { describe, expect, it } from 'vitest'
import { initialState, reducer, type FormState } from './reducer.js'

// ST-9 — the email flag's life in the reducer: set on Submit, kept while the address is
// still incomplete, gone the moment it is valid (AC-4); and the save outcomes around it.
const flagged: FormState = {
  ...initialState,
  values: { firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '(415) 555-0132' },
  errors: { email: messages.invalidEmail },
}

describe('Feature: Be told when my email address is not complete — reducer', () => {
  describe('Scenario: The email message clears once the address is fixed @AC-4', () => {
    it('Given I pressed Submit with email "jane@", When I change it to "jane@example.com", Then the flag is gone', () => {
      const next = reducer(flagged, { type: 'change', field: 'email', value: 'jane@example.com' })
      expect(next.values.email).toBe('jane@example.com')
      expect(next.errors.email).toBeUndefined()
    })

    it('while the address is still incomplete the message stays, word for word, even one the server sent', () => {
      let state = reducer(flagged, { type: 'change', field: 'email', value: 'jane@e' })
      expect(state.errors.email).toBe(messages.invalidEmail)
      state = reducer({ ...flagged, errors: { email: 'From the server.' } }, { type: 'change', field: 'email', value: 'jane@example' })
      expect(state.errors.email).toBe('From the server.')
    })

    it('an incomplete email is not flagged while typing before Submit', () => {
      const next = reducer(initialState, { type: 'change', field: 'email', value: 'jane@' })
      expect(next.errors.email).toBeUndefined()
    })

    it('editing another field leaves the email flag alone', () => {
      const next = reducer(flagged, { type: 'change', field: 'phone', value: '4155550132' })
      expect(next.errors.email).toBe(messages.invalidEmail)
    })
  })

  describe('Scenario Outline: An incomplete email is flagged @AC-2', () => {
    it('Then the flag is recorded, nothing is submitting and no confirmation is shown', () => {
      const next = reducer({ ...initialState, values: flagged.values }, { type: 'failed', errors: { email: messages.invalidEmail } })
      expect(next.errors).toEqual({ email: messages.invalidEmail })
      expect(next.submitting).toBe(false)
      expect(next.saved).toBeNull()
      expect(next.values).toEqual(flagged.values)
    })
  })

  describe('Scenario: A complete email is accepted @AC-1', () => {
    it('Then the saved first name is kept for the confirmation and the form is emptied for the next visitor', () => {
      const submitting = reducer(
        { ...flagged, errors: {}, values: { ...flagged.values, email: 'jane.doe@example.com' } },
        { type: 'submit' },
      )
      const saved = reducer(submitting, { type: 'saved', firstName: 'Jane' })
      expect(saved.saved).toBe('Jane')
      expect(saved.submitting).toBe(false)
      expect(saved.saveFailed).toBe(false)
      expect(saved.errors).toEqual({})
      expect(saved.values).toEqual(initialState.values)
    })

    it('the confirmation goes as soon as the next visitor starts typing', () => {
      const saved = reducer(reducer(initialState, { type: 'submit' }), { type: 'saved', firstName: 'Jane' })
      expect(reducer(saved, { type: 'change', field: 'firstName', value: 'A' }).saved).toBeNull()
    })
  })

  it('opens with no confirmation and no failed save', () => {
    expect(initialState.saved).toBeNull()
    expect(initialState.saveFailed).toBe(false)
  })

  it('a second Submit while one is in flight changes nothing', () => {
    const submitting = reducer(initialState, { type: 'submit' })
    expect(reducer(submitting, { type: 'submit' })).toBe(submitting)
  })

  it('a failed save keeps the values and shows the failure until the next Submit', () => {
    const submitting = reducer(flagged, { type: 'submit' })
    const failed = reducer(submitting, { type: 'saveFailed' })
    expect(failed.saveFailed).toBe(true)
    expect(failed.submitting).toBe(false)
    expect(failed.values).toEqual(flagged.values)
    expect(failed.saved).toBeNull()
    const retry = reducer(failed, { type: 'submit' })
    expect(retry.saveFailed).toBe(false)
    expect(retry.submitting).toBe(true)
  })
})
