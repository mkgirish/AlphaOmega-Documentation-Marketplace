import { describe, expect, it } from 'vitest'
import { copy } from './copy.js'
import { canSubmit, initialState, reducer, type FormAction, type FormState, type Status } from './reducer.js'

// AD-7 / DG-5 — the registration screen's one state machine: five states, every allowed
// transition and every forbidden one (ST-5 adds the confirmation's RESET).

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const janeTraces = ['Jane', 'Doe', 'jane.doe@example.com', '4155550132']

function filled(): FormState {
  let state = initialState
  for (const [field, value] of Object.entries(jane)) {
    state = reducer(state, { type: 'change', field: field as keyof typeof jane, value })
  }
  return state
}

const submitting = (): FormState => reducer(filled(), { type: 'submit' })
const confirmed = (): FormState => reducer(submitting(), { type: 'submitted', firstName: 'Jane' })
const invalid = (): FormState => reducer(submitting(), { type: 'failed', errors: { phone: 'Enter a 10-digit US number.' } })
const saveFailed = (): FormState => reducer(submitting(), { type: 'saveFailed' })

const states: Record<Status, () => FormState> = {
  editing: filled,
  submitting,
  invalid,
  saveFailed,
  confirmed,
}

describe('registration reducer — five states (DG-5)', () => {
  it('opens in editing, with nothing confirmed and nothing announced', () => {
    expect(initialState.status).toBe('editing')
    expect(initialState.confirmedName).toBe('')
    expect(initialState.announcement).toBe('')
  })

  it('reaches each of the five states, keeping the submitting flag in step with the status', () => {
    for (const [status, make] of Object.entries(states)) {
      const state = make()
      expect(state.status).toBe(status)
      expect(state.submitting).toBe(status === 'submitting')
    }
  })

  it('SUBMIT from editing, invalid or saveFailed moves to submitting and clears the errors', () => {
    for (const make of [filled, invalid, saveFailed]) {
      const next = reducer(make(), { type: 'submit' })
      expect(next.status).toBe('submitting')
      expect(next.errors).toEqual({})
      expect(next.values).toEqual(jane)
    }
  })

  it('SUBMIT while submitting or confirmed is forbidden: the state is returned untouched', () => {
    for (const make of [submitting, confirmed]) {
      const state = make()
      expect(reducer(state, { type: 'submit' })).toBe(state)
    }
    expect(canSubmit(submitting())).toBe(false)
    expect(canSubmit(confirmed())).toBe(false)
    expect(canSubmit(filled())).toBe(true)
    expect(canSubmit(invalid())).toBe(true)
    expect(canSubmit(saveFailed())).toBe(true)
  })

  it('a 201 confirms with the saved first name and keeps none of the submitted values', () => {
    const next = confirmed()
    expect(next.status).toBe('confirmed')
    expect(next.confirmedName).toBe('Jane')
    expect(next.values).toEqual(initialState.values)
    expect(next.errors).toEqual({})
  })

  it('a 400 moves to invalid with the field errors and keeps the values for correction', () => {
    const next = invalid()
    expect(next.status).toBe('invalid')
    expect(next.errors).toEqual({ phone: 'Enter a 10-digit US number.' })
    expect(next.values).toEqual(jane)
  })

  it('any other failure moves to saveFailed and keeps the values', () => {
    const next = saveFailed()
    expect(next.status).toBe('saveFailed')
    expect(next.errors).toEqual({})
    expect(next.values).toEqual(jane)
  })

  it('a response arriving outside submitting is ignored, so a late reply cannot show a confirmation', () => {
    const outcomes: FormAction[] = [
      { type: 'submitted', firstName: 'Jane' },
      { type: 'failed', errors: { email: 'x' } },
      { type: 'saveFailed' },
    ]
    for (const make of [filled, invalid, saveFailed, confirmed]) {
      const state = make()
      for (const action of outcomes) expect(reducer(state, action)).toBe(state)
    }
  })

  it('CHANGE is forbidden while submitting and on the confirmation', () => {
    for (const make of [submitting, confirmed]) {
      const state = make()
      expect(reducer(state, { type: 'change', field: 'firstName', value: 'Mallory' })).toBe(state)
    }
  })

  it('CHANGE while invalid clears that field’s error and the last announcement', () => {
    const next = reducer(invalid(), { type: 'change', field: 'phone', value: '4155550133' })
    expect(next.status).toBe('invalid')
    expect(next.errors.phone).toBeUndefined()
    expect(next.announcement).toBe('')
  })
})

describe('Feature: Clear the kiosk for the next visitor — the RESET transition', () => {
  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane’s confirmation, When RESET, Then the state is the opening form plus the cleared announcement', () => {
      const next = reducer(confirmed(), { type: 'reset' })
      expect(next).toEqual({ ...initialState, announcement: 'Form cleared for the next visitor' })
      expect(copy.formCleared).toBe('Form cleared for the next visitor')
      expect(next.status).toBe('editing')
      expect(next.submitting).toBe(false)
    })

    it('RESET leaves no value, error or first name behind', () => {
      const next = reducer(confirmed(), { type: 'reset' })
      const serialised = JSON.stringify(next)
      for (const trace of janeTraces) expect(serialised).not.toContain(trace)
      expect(next.confirmedName).toBe('')
      expect(next.errors).toEqual({})
      expect(Object.values(next.values).every((value) => value === '')).toBe(true)
    })
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @story:ST-5 @criterion:AC-3', () => {
    it('Given a phone error and then a successful save, When RESET, Then no field error remains', () => {
      const corrected = reducer(invalid(), { type: 'change', field: 'phone', value: '4155550132' })
      const resubmitted = reducer(corrected, { type: 'submit' })
      const saved = reducer(resubmitted, { type: 'submitted', firstName: 'Jane' })
      const next = reducer(saved, { type: 'reset' })
      expect(next.errors).toEqual({})
      expect(next.status).toBe('editing')
    })
  })

  it('RESET is forbidden anywhere but the confirmation', () => {
    for (const make of [filled, submitting, invalid, saveFailed]) {
      const state = make()
      expect(reducer(state, { type: 'reset' })).toBe(state)
    }
  })

  it('a confirmation without a first name still confirms, with nothing to greet', () => {
    const next = reducer(submitting(), { type: 'submitted' })
    expect(next.status).toBe('confirmed')
    expect(next.confirmedName).toBe('')
  })

  it('SUBMIT after a reset clears the announcement, so the next reset is heard again', () => {
    const reset = reducer(confirmed(), { type: 'reset' })
    const next = reducer(reset, { type: 'submit' })
    expect(next.announcement).toBe('')
  })
})

describe('every state × every action (DG-5 table)', () => {
  const actions: Record<string, FormAction> = {
    change: { type: 'change', field: 'lastName', value: 'Roe' },
    submit: { type: 'submit' },
    submitted: { type: 'submitted', firstName: 'Jane' },
    failed: { type: 'failed', errors: { email: 'x' } },
    saveFailed: { type: 'saveFailed' },
    reset: { type: 'reset' },
  }
  const table: Record<Status, Status[]> = {
    // change, submit, submitted, failed, saveFailed, reset
    editing: ['editing', 'submitting', 'editing', 'editing', 'editing', 'editing'],
    submitting: ['submitting', 'submitting', 'confirmed', 'invalid', 'saveFailed', 'submitting'],
    invalid: ['invalid', 'submitting', 'invalid', 'invalid', 'invalid', 'invalid'],
    saveFailed: ['saveFailed', 'submitting', 'saveFailed', 'saveFailed', 'saveFailed', 'saveFailed'],
    confirmed: ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'editing'],
  }

  for (const [from, expected] of Object.entries(table) as [Status, Status[]][]) {
    Object.entries(actions).forEach(([name, action], index) => {
      it(`${from} + ${name} → ${expected[index]}`, () => {
        const state = states[from]()
        const next = reducer(state, action)
        expect(next.status).toBe(expected[index])
        if (next.status === from && name !== 'change') expect(next).toBe(state)
      })
    })
  }

  it('CHANGE while saveFailed edits the value and keeps the state', () => {
    const next = reducer(saveFailed(), { type: 'change', field: 'lastName', value: 'Roe' })
    expect(next.status).toBe('saveFailed')
    expect(next.values.lastName).toBe('Roe')
  })
})
