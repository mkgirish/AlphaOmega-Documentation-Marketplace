import { describe, expect, it } from 'vitest'
import { initialState, reducer, type FormState } from './reducer.js'

// ST-3 — the reducer's "invalid" transition: a Submit stopped by the required-field check.
const typed: FormState = {
  ...initialState,
  values: { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' },
}

describe('registration reducer — a Submit stopped by an empty field (ST-3)', () => {
  it('records the field errors without starting a submission @AC-1', () => {
    const next = reducer(typed, { type: 'invalid', errors: { phone: 'Enter a phone.' } })
    expect(next.errors).toEqual({ phone: 'Enter a phone.' })
    expect(next.submitting).toBe(false)
  })

  it('keeps every value already typed @AC-5', () => {
    const next = reducer(typed, { type: 'invalid', errors: { phone: 'Enter a phone.' } })
    expect(next.values).toEqual(typed.values)
    expect(next.values.firstName).toBe('Jane')
    expect(next.errors.phone).toBe('Enter a phone.')
  })

  it('replaces the errors of an earlier failed Submit rather than adding to them', () => {
    const earlier = reducer(typed, { type: 'invalid', errors: { firstName: 'a', lastName: 'b' } })
    const next = reducer(earlier, { type: 'invalid', errors: { phone: 'c' } })
    expect(next.errors).toEqual({ phone: 'c' })
  })

  it('is ignored while a submission is in flight', () => {
    const submitting = { ...typed, submitting: true }
    const next = reducer(submitting, { type: 'invalid', errors: { phone: 'c' } })
    expect(next).toBe(submitting)
    expect(next.errors).toEqual({})
    const settled = reducer(reducer(submitting, { type: 'submitted' }), { type: 'invalid', errors: { phone: 'c' } })
    expect(settled.errors).toEqual({ phone: 'c' })
  })

  it('typing into a flagged field clears only that field’s message', () => {
    const flagged = reducer(typed, { type: 'invalid', errors: { lastName: 'b', phone: 'c' } })
    const next = reducer(flagged, { type: 'change', field: 'phone', value: '4' })
    expect(next.errors.phone).toBeUndefined()
    expect(next.errors.lastName).toBe('b')
  })
})
