import { describe, expect, it } from 'vitest'
import { phoneChange, phoneMessage } from './phone.js'
import { initialState, reducer, validateForm, type FormState } from './reducer.js'

// ST-8 — how the reducer flags the phone field on Submit and clears it once fixed.
const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }

/** The phone value the field would hold after the visitor enters `raw`. */
const entered = (raw: string) => phoneChange(raw, raw.length).value

const flagged: FormState = { ...initialState, values: { ...valid, phone: '555-0132' }, errors: { phone: phoneMessage }, attempted: true }

describe('Feature: Enter a US phone number and be told exactly when it is wrong', () => {
  describe('Scenario Outline: Common ways of writing a US number are accepted @AC-1', () => {
    it.each(['4155550132', '(415) 555-0132', '415.555.0132'])(
      'Given valid name and email, When I enter "%s", Then nothing is flagged',
      (raw) => {
        expect(validateForm({ ...valid, phone: entered(raw) })).toEqual({})
      },
    )
  })

  describe('Scenario Outline: Numbers that are not a 10-digit US number are rejected @AC-2', () => {
    it.each(['abc123', '5550132', '41555501329', '0155550132', '+44 20 7946 0958', '+1 415 555 0132', '1-415-555-0132'])(
      'When I enter "%s" and press Submit, Then only the phone carries the message',
      (raw) => {
        expect(validateForm({ ...valid, phone: entered(raw) })).toEqual({ phone: phoneMessage })
        expect(validateForm({ ...valid, phone: raw })).toEqual({ phone: phoneMessage })
      },
    )

    it('a rejected Submit flags the phone and records that Submit was pressed, without submitting', () => {
      const next = reducer(initialState, { type: 'failed', errors: { phone: phoneMessage } })
      expect(next.errors).toEqual({ phone: phoneMessage })
      expect(next.attempted).toBe(true)
      expect(next.submitting).toBe(false)
      expect(next.saved).toBeNull()
    })
  })

  describe('Scenario Outline: An area code or exchange starting with 0 or 1 is rejected @AC-3', () => {
    it.each(['4150550132', '4151550132', '1155550132'])('When I enter "%s", Then the phone carries the message', (raw) => {
      expect(validateForm({ ...valid, phone: entered(raw) })).toEqual({ phone: phoneMessage })
    })
  })

  describe('Scenario: The phone message clears once the number is fixed @AC-7', () => {
    it('Given I pressed Submit with phone "5550132", When I change the phone to "4155550132", Then the message is gone without pressing Submit', () => {
      const next = reducer(flagged, { type: 'change', field: 'phone', value: entered('4155550132') })
      expect(next.errors.phone).toBeUndefined()
      expect(next.values.phone).toBe('(415) 555-0132')
      expect(next.submitting).toBe(false)
    })

    it('while the flagged number is still wrong, its message stays', () => {
      const next = reducer(flagged, { type: 'change', field: 'phone', value: entered('41555') })
      expect(next.errors.phone).toBe(phoneMessage)
      const server = reducer({ ...flagged, errors: { phone: 'Server says no.' } }, { type: 'change', field: 'phone', value: '41' })
      expect(server.errors.phone).toBe('Server says no.')
    })

    it('a phone that was not flagged is not flagged by typing after Submit either', () => {
      const attempted = { ...flagged, errors: {} }
      expect(reducer(attempted, { type: 'change', field: 'phone', value: '555' }).errors.phone).toBeUndefined()
    })
  })

  describe('Scenario: Nothing is flagged while I am still typing @AC-7', () => {
    it('Given I have not pressed Submit yet, When I type "555" and move on, Then no phone message is shown', () => {
      let state = initialState
      for (const raw of ['5', '55', '555']) state = reducer(state, { type: 'change', field: 'phone', value: entered(raw) })
      state = reducer(state, { type: 'change', field: 'email', value: 'j' })
      expect(state.errors).toEqual({ phone: undefined, email: undefined })
      expect(state.attempted).toBe(false)
    })
  })

  describe('the other fields on Submit', () => {
    it('flags each empty field and a malformed email with the shared messages', () => {
      expect(validateForm({ firstName: ' ', lastName: '', email: '', phone: '' })).toEqual({
        firstName: 'First name is required.',
        lastName: 'Last name is required.',
        email: 'Email is required.',
        phone: 'Phone number is required.',
      })
      expect(validateForm({ ...valid, email: 'not-an-email' })).toEqual({ email: 'Enter a valid email address.' })
    })
  })

  describe('submitting', () => {
    it('opens with Submit not yet pressed, nothing saved and no save failure', () => {
      expect(initialState.attempted).toBe(false)
      expect(initialState.saved).toBeNull()
      expect(initialState.saveFailed).toBe(false)
    })

    it('a second Submit while the first is in flight changes nothing', () => {
      const submitting = reducer({ ...initialState, values: valid }, { type: 'submit' })
      expect(submitting.attempted).toBe(true)
      expect(reducer(submitting, { type: 'submit' })).toBe(submitting)
    })

    it('a 201 shows the confirmation for the saved first name', () => {
      const submitting = reducer({ ...initialState, values: valid }, { type: 'submit' })
      const saved = reducer(submitting, { type: 'saved', firstName: 'Jane' })
      expect(saved.saved).toBe('Jane')
      expect(saved.submitting).toBe(false)
      expect(saved.saveFailed).toBe(false)
    })

    it('a failed save keeps the values and shows the failure until the next Submit', () => {
      const submitting = reducer({ ...initialState, values: valid }, { type: 'submit' })
      const failed = reducer(submitting, { type: 'saveFailed' })
      expect(failed.saveFailed).toBe(true)
      expect(failed.submitting).toBe(false)
      expect(failed.saved).toBeNull()
      expect(failed.values).toEqual(valid)
      expect(reducer(failed, { type: 'submit' }).saveFailed).toBe(false)
    })
  })
})
