import { describe, expect, it } from 'vitest'
import { initialState, reducer, statuses, type FormAction, type FormState } from './reducer.js'

// ST-2 — the five states of the registration screen (AD-7) and every transition between
// them, including the ones the reducer must refuse.
const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const editing: FormState = { ...initialState, values: jane }
const submitting = reducer(editing, { type: 'submit' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Jane' })
const invalid = reducer(submitting, { type: 'failed', errors: { phone: 'Server says phone.' } })
const saveFailed = reducer(submitting, { type: 'saveFailed' })

describe('registration reducer — submitting and confirming a visit (ST-2)', () => {
  it('has exactly five states, and opens in editing with no first name to thank', () => {
    expect(statuses).toEqual(['editing', 'submitting', 'invalid', 'saveFailed', 'confirmed'])
    expect(initialState.status).toBe('editing')
    expect(initialState.firstName).toBe('')
  })

  it('editing → submitting on SUBMIT, keeping every value and clearing old errors', () => {
    const next = reducer({ ...editing, errors: { email: 'old' } }, { type: 'submit' })
    expect(next.status).toBe('submitting')
    expect(next.submitting).toBe(true)
    expect(next.values).toEqual(jane)
    expect(next.errors).toEqual({})
  })

  it('submitting refuses a second SUBMIT — a double tap is one submission (AC-4)', () => {
    expect(reducer(submitting, { type: 'submit' })).toBe(submitting)
  })

  it('submitting refuses edits — the inputs are read-only and keep their values (AC-4)', () => {
    expect(reducer(submitting, { type: 'change', field: 'firstName', value: 'Joe' })).toBe(submitting)
    expect(submitting.values).toEqual(jane)
  })

  it('submitting → confirmed only on the 201, thanking the name the API sent back (AC-1, AC-5)', () => {
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.submitting).toBe(false)
    expect(confirmed.firstName).toBe('Jane')
    expect(confirmed.errors).toEqual({})
    // The visitor's details leave the screen's memory as soon as the visit is saved.
    expect(confirmed.values).toEqual(initialState.values)
  })

  it('submitting → invalid when the API names fields, keeping the values', () => {
    expect(invalid.status).toBe('invalid')
    expect(invalid.submitting).toBe(false)
    expect(invalid.errors).toEqual({ phone: 'Server says phone.' })
    expect(invalid.values).toEqual(jane)
  })

  it('submitting → saveFailed when the API rejects without naming a field (400 with fields {})', () => {
    const next = reducer(submitting, { type: 'failed', errors: {} })
    expect(next.status).toBe('saveFailed')
    expect(next.errors).toEqual({})
    expect(next.values).toEqual(jane)
  })

  it('submitting → saveFailed on 403, 413, 415, 429, 500 or no answer, keeping the values', () => {
    expect(saveFailed.status).toBe('saveFailed')
    expect(saveFailed.submitting).toBe(false)
    expect(saveFailed.values).toEqual(jane)
    expect(saveFailed.firstName).toBe('')
  })

  it('invalid: editing a field clears only its error; SUBMIT tries again', () => {
    const edited = reducer(invalid, { type: 'change', field: 'phone', value: '4155550133' })
    expect(edited.status).toBe('invalid')
    expect(edited.errors.phone).toBeUndefined()
    expect(reducer(edited, { type: 'submit' }).status).toBe('submitting')
  })

  it('saveFailed: the values can still be edited and SUBMIT tries again', () => {
    const edited = reducer(saveFailed, { type: 'change', field: 'lastName', value: 'Roe' })
    expect(edited.values.lastName).toBe('Roe')
    expect(edited.status).toBe('saveFailed')
    const retry = reducer(edited, { type: 'submit' })
    expect(retry.status).toBe('submitting')
    expect(retry.values.lastName).toBe('Roe')
  })

  it('confirmed → editing on RESET, leaving no value, error or first name behind', () => {
    const next = reducer(confirmed, { type: 'reset' })
    expect(next).toEqual(initialState)
    expect(next.firstName).toBe('')
    expect(next.values).toEqual({ firstName: '', lastName: '', email: '', phone: '' })
    expect(next.errors).toEqual({})
    expect(next.status).toBe('editing')
  })

  it('a confirmation without a name still thanks the visitor, never "Thank you, !"', () => {
    expect(reducer(submitting, { type: 'submitted' }).firstName).toBe('')
  })

  const refused: [string, FormState, FormAction][] = [
    ['confirmed refuses SUBMIT', confirmed, { type: 'submit' }],
    ['confirmed refuses CHANGE', confirmed, { type: 'change', field: 'email', value: 'x' }],
    ['confirmed refuses a second 201', confirmed, { type: 'submitted', firstName: 'Joe' }],
    ['confirmed refuses FAILED', confirmed, { type: 'failed', errors: { email: 'x' } }],
    ['confirmed refuses SAVE_FAILED', confirmed, { type: 'saveFailed' }],
    ['editing refuses a 201 it never asked for (AC-5)', editing, { type: 'submitted', firstName: 'Jane' }],
    ['editing refuses FAILED', editing, { type: 'failed', errors: { email: 'x' } }],
    ['editing refuses SAVE_FAILED', editing, { type: 'saveFailed' }],
    ['editing refuses RESET', editing, { type: 'reset' }],
    ['submitting refuses RESET', submitting, { type: 'reset' }],
    ['invalid refuses RESET', invalid, { type: 'reset' }],
    ['invalid refuses a 201 it never asked for', invalid, { type: 'submitted', firstName: 'Jane' }],
    ['saveFailed refuses RESET', saveFailed, { type: 'reset' }],
    ['saveFailed refuses a 201 it never asked for', saveFailed, { type: 'submitted', firstName: 'Jane' }],
    ['saveFailed refuses a second SAVE_FAILED', saveFailed, { type: 'saveFailed' }],
  ]

  it.each(refused)('%s', (_name, state, action) => {
    expect(reducer(state, action)).toBe(state)
  })
})
