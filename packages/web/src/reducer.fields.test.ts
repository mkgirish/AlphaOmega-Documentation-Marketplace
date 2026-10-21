import { describe, expect, it } from 'vitest'
import { fieldNames, initialState, reducer } from './reducer.js'

describe('registration reducer — the four visitor fields (ST-1)', () => {
  it('names exactly the four visitor fields, in tab order', () => {
    expect(fieldNames).toEqual(['firstName', 'lastName', 'email', 'phone'])
  })

  it('opens with all four values blank, no errors and nothing submitting', () => {
    expect(initialState.values).toEqual({ firstName: '', lastName: '', email: '', phone: '' })
    expect(initialState.errors).toEqual({})
    expect(initialState.submitting).toBe(false)
  })

  it('changes only the field that was edited', () => {
    const next = reducer(initialState, { type: 'change', field: 'firstName', value: 'Ada' })
    expect(next.values).toEqual({ firstName: 'Ada', lastName: '', email: '', phone: '' })
    expect(initialState.values.firstName).toBe('')
  })

  it('clears the edited field’s error and keeps the others', () => {
    const next = reducer(
      { ...initialState, errors: { lastName: 'x', phone: 'y' } },
      { type: 'change', field: 'phone', value: '4155550132' },
    )
    expect(next.errors.phone).toBeUndefined()
    expect(next.errors.lastName).toBe('x')
    expect(next.values).toEqual({ firstName: '', lastName: '', email: '', phone: '4155550132' })
  })

  it('submit, submitted and failed move the submitting flag and errors', () => {
    const submitting = reducer({ ...initialState, errors: { email: 'x' } }, { type: 'submit' })
    expect(submitting.submitting).toBe(true)
    expect(submitting.errors).toEqual({})
    expect(reducer(submitting, { type: 'submitted' }).submitting).toBe(false)
    const failed = reducer(submitting, { type: 'failed', errors: { firstName: 'y' } })
    expect(failed.submitting).toBe(false)
    expect(failed.errors).toEqual({ firstName: 'y' })
    expect(failed.values).toEqual(initialState.values)
    expect(failed.values.firstName).toBe('')
  })

  it('ignores an unknown action', () => {
    const next = reducer(initialState, { type: 'nope' } as never)
    expect(next).toBe(initialState)
    expect(next.values.lastName).toBe('')
  })
})
