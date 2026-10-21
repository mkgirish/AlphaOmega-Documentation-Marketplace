import { describe, expect, it } from 'vitest'
import { fieldNames, initialState, reducer, type FormAction, type FormState } from './reducer.js'

const filled: FormState = {
  ...initialState,
  values: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '(415) 555-0132' },
}

const submitting: FormState = reducer(filled, { type: 'SUBMIT' })
const saved: FormState = reducer(submitting, { type: 'SAVED' })

describe('AD-7 registration reducer', () => {
  it('starts editing with four blank fields, no errors and no saved first name', () => {
    expect(fieldNames).toEqual(['firstName', 'lastName', 'email', 'phone'])
    expect(initialState).toEqual({
      status: 'editing',
      values: { firstName: '', lastName: '', email: '', phone: '' },
      fieldErrors: {},
      formError: '',
      savedFirstName: '',
    })
  })

  it('CHANGE records the value and clears only that field’s error', () => {
    const invalid = reducer(filled, { type: 'INVALID', fieldErrors: { email: 'bad email', phone: 'bad phone' } })
    const next = reducer(invalid, { type: 'CHANGE', field: 'email', value: 'a@b.co' })
    expect(next.values.email).toBe('a@b.co')
    expect(next.fieldErrors).toEqual({ phone: 'bad phone' })
    expect(next.status).toBe('invalid')
  })

  it('INVALID moves editing to invalid with the given field errors', () => {
    const next = reducer(filled, { type: 'INVALID', fieldErrors: { firstName: 'server text' } })
    expect(next.status).toBe('invalid')
    expect(next.fieldErrors).toEqual({ firstName: 'server text' })
    expect(next.values).toEqual(filled.values)
  })

  it('SUBMIT moves editing, invalid and saveFailed to submitting and clears errors', () => {
    expect(submitting.status).toBe('submitting')
    const invalid = reducer(filled, { type: 'INVALID', fieldErrors: { phone: 'x' } })
    expect(reducer(invalid, { type: 'SUBMIT' })).toMatchObject({ status: 'submitting', fieldErrors: {} })
    const failed = reducer(submitting, { type: 'SAVE_FAILED', message: 'Try again.' })
    expect(reducer(failed, { type: 'SUBMIT' })).toMatchObject({ status: 'submitting', formError: '' })
  })

  it('a second SUBMIT while submitting is ignored, so a double tap sends one request', () => {
    expect(reducer(submitting, { type: 'SUBMIT' })).toBe(submitting)
  })

  it('SAVED moves submitting to saved, keeps the first name and drops every value', () => {
    expect(saved.status).toBe('saved')
    expect(saved.savedFirstName).toBe('Ada')
    expect(saved.values).toEqual(initialState.values)
  })

  it('SAVE_FAILED without field errors moves submitting to saveFailed with the message verbatim', () => {
    const next = reducer(submitting, { type: 'SAVE_FAILED', message: 'Too many requests — try again shortly.' })
    expect(next.status).toBe('saveFailed')
    expect(next.formError).toBe('Too many requests — try again shortly.')
    expect(next.values).toEqual(filled.values)
  })

  it('SAVE_FAILED with field errors moves submitting to invalid', () => {
    const next = reducer(submitting, { type: 'SAVE_FAILED', message: 'Check the form.', fieldErrors: { email: 'server email text' } })
    expect(next.status).toBe('invalid')
    expect(next.fieldErrors).toEqual({ email: 'server email text' })
    expect(next.formError).toBe('Check the form.')
  })

  it('SAVE_FAILED with an empty fields object is a saveFailed and flags no field', () => {
    const next = reducer(submitting, { type: 'SAVE_FAILED', message: 'Request rejected.', fieldErrors: {} })
    expect(next.status).toBe('saveFailed')
    expect(next.fieldErrors).toEqual({})
  })

  it('RESET from every state leaves no value, error or first name behind', () => {
    const states: FormState[] = [
      filled,
      reducer(filled, { type: 'INVALID', fieldErrors: { email: 'x' } }),
      submitting,
      saved,
      reducer(submitting, { type: 'SAVE_FAILED', message: 'x' }),
    ]
    for (const state of states) expect(reducer(state, { type: 'RESET' })).toEqual(initialState)
  })

  describe('forbidden transitions return the state unchanged', () => {
    const forbidden: [string, FormState, FormAction][] = [
      ['CHANGE while submitting', submitting, { type: 'CHANGE', field: 'firstName', value: 'Eve' }],
      ['CHANGE while saved', saved, { type: 'CHANGE', field: 'firstName', value: 'Eve' }],
      ['INVALID while submitting', submitting, { type: 'INVALID', fieldErrors: { email: 'x' } }],
      ['INVALID while saved', saved, { type: 'INVALID', fieldErrors: { email: 'x' } }],
      ['SUBMIT while saved', saved, { type: 'SUBMIT' }],
      ['SAVED while editing', filled, { type: 'SAVED' }],
      ['SAVED while saved', saved, { type: 'SAVED' }],
      ['SAVE_FAILED while editing', filled, { type: 'SAVE_FAILED', message: 'x' }],
      ['SAVE_FAILED while saved', saved, { type: 'SAVE_FAILED', message: 'x' }],
    ]
    it.each(forbidden)('%s', (_name, state, action) => {
      expect(reducer(state, action)).toBe(state)
    })

    it('an unknown action', () => {
      expect(reducer(filled, { type: 'NOPE' } as unknown as FormAction)).toBe(filled)
    })
  })
})
