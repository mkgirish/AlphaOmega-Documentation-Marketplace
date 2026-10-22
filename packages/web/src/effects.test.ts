import { describe, expect, it } from 'vitest'
import { focusTargetFor, titleFor } from './effects.js'
import { initialState, reducer, statuses, type FormState } from './reducer.js'

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const submitting = reducer({ ...initialState, values: jane }, { type: 'submit' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Jane' })

describe('the tab title — two fixed titles, never the visitor’s name (AC-6)', () => {
  it('reads "Registration complete" once the visit is saved', () => {
    expect(titleFor('confirmed')).toBe('Registration complete')
  })

  it('reads "Visitor registration" in every other state', () => {
    for (const status of statuses.filter((status) => status !== 'confirmed')) expect(titleFor(status)).toBe('Visitor registration')
  })
})

describe('where focus goes after each transition', () => {
  it('submitting → confirmed: the "Thank you" heading (AC-1)', () => {
    expect(focusTargetFor('submitting', confirmed)).toBe('confirmation-title')
  })

  it('confirmed → editing on "Register another visitor": First name', () => {
    expect(focusTargetFor('confirmed', reducer(confirmed, { type: 'reset' }))).toBe('firstName')
  })

  it('submitting → invalid: the first field the API flagged, in tab order', () => {
    const invalid = reducer(submitting, { type: 'failed', errors: { phone: 'p', email: 'e' } })
    expect(focusTargetFor('submitting', invalid)).toBe('email')
  })

  it('editing → submitting and submitting → saveFailed: focus stays on Submit', () => {
    expect(focusTargetFor('editing', submitting)).toBeNull()
    expect(focusTargetFor('submitting', reducer(submitting, { type: 'saveFailed' }))).toBeNull()
  })

  it('a keystroke moves nothing', () => {
    const typed: FormState = reducer(initialState, { type: 'change', field: 'lastName', value: 'D' })
    expect(focusTargetFor('editing', typed)).toBeNull()
    const invalid = reducer(submitting, { type: 'failed', errors: { phone: 'p' } })
    expect(focusTargetFor('invalid', reducer(invalid, { type: 'change', field: 'phone', value: '1' }))).toBeNull()
    expect(focusTargetFor('confirmed', confirmed)).toBeNull()
  })
})
