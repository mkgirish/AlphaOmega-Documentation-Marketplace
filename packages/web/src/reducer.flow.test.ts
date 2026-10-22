import { describe, expect, it } from 'vitest'
import { initialState, reducer, type FormAction, type FormState, type Status } from './reducer.js'

// ST-2 / AD-7 — the five states of the registration screen (DG-5) and every transition
// between them. Anything not listed here is a forbidden transition: the reducer answers it
// with the very same state object.
const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

const editing: FormState = { ...initialState, values: jane }
const submitting = reducer(editing, { type: 'submit' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Jane' })
const invalid = reducer(submitting, { type: 'failed', errors: { phone: 'Phone message from the server.' } })
const saveFailed = reducer(submitting, { type: 'saveFailed' })

const states: Record<Status, FormState> = { editing, submitting, invalid, saveFailed, confirmed }

const actions: Record<FormAction['type'], FormAction> = {
  change: { type: 'change', field: 'lastName', value: 'Smith' },
  submit: { type: 'submit' },
  submitted: { type: 'submitted', firstName: 'Jane' },
  failed: { type: 'failed', errors: { email: 'x' } },
  saveFailed: { type: 'saveFailed' },
  reset: { type: 'reset' },
}

/** Every allowed transition: from state, on action, to status. */
const allowed: Record<Status, Partial<Record<FormAction['type'], Status>>> = {
  editing: { change: 'editing', submit: 'submitting' },
  invalid: { change: 'invalid', submit: 'submitting' },
  saveFailed: { change: 'saveFailed', submit: 'submitting' },
  submitting: { submitted: 'confirmed', failed: 'invalid', saveFailed: 'saveFailed' },
  confirmed: { reset: 'editing' },
}

describe('registration reducer — the five screen states (ST-2, DG-5)', () => {
  it('opens in editing, with no first name to thank', () => {
    expect(initialState.status).toBe('editing')
    expect(initialState.firstName).toBe('')
    expect(initialState.submitting).toBe(false)
  })

  it('reaches each of the five states', () => {
    expect(Object.values(states).map((state) => state.status)).toEqual(['editing', 'submitting', 'invalid', 'saveFailed', 'confirmed'])
  })

  for (const [from, table] of Object.entries(allowed) as [Status, Partial<Record<FormAction['type'], Status>>][]) {
    for (const [type, action] of Object.entries(actions) as [FormAction['type'], FormAction][]) {
      const to = table[type]
      if (to === undefined) {
        it(`forbids ${type} while ${from}: the state is returned untouched`, () => {
          expect(reducer(states[from], action)).toBe(states[from])
        })
      } else {
        it(`${from} --${type}--> ${to}`, () => {
          expect(reducer(states[from], action).status).toBe(to)
        })
      }
    }
  }

  describe('submitting', () => {
    it('keeps every value the visitor typed and clears the old errors', () => {
      const from: FormState = { ...invalid, values: jane }
      const next = reducer(from, { type: 'submit' })
      expect(next.values).toEqual(jane)
      expect(next.errors).toEqual({})
      expect(next.submitting).toBe(true)
    })

    it('ignores a second Submit — a double tap cannot start a second save', () => {
      expect(reducer(submitting, { type: 'submit' })).toBe(submitting)
    })

    it('ignores typing: the inputs are read-only and keep their values', () => {
      expect(reducer(submitting, { type: 'change', field: 'firstName', value: 'Janet' })).toBe(submitting)
      expect(submitting.values).toEqual(jane)
    })
  })

  describe('confirmed (after a 201)', () => {
    it('thanks the visitor by the first name the API returned', () => {
      expect(confirmed.firstName).toBe('Jane')
      expect(confirmed.submitting).toBe(false)
      expect(confirmed.errors).toEqual({})
    })

    it('uses the API’s normalised first name, not the raw input', () => {
      const raw = reducer(reducer({ ...initialState, values: { ...jane, firstName: ' Jane ' } }, { type: 'submit' }), {
        type: 'submitted',
        firstName: 'Jane',
      })
      expect(raw.firstName).toBe('Jane')
    })

    it('falls back to the trimmed first name when the 201 carried none', () => {
      const raw = reducer(reducer({ ...initialState, values: { ...jane, firstName: '  Jane  ' } }, { type: 'submit' }), {
        type: 'submitted',
      })
      expect(raw.status).toBe('confirmed')
      expect(raw.firstName).toBe('Jane')
    })

    it('drops the four values as soon as the visit is saved', () => {
      expect(confirmed.values).toEqual(initialState.values)
    })

    it('cannot be confirmed without a save in progress', () => {
      expect(reducer(editing, { type: 'submitted', firstName: 'Jane' })).toBe(editing)
      expect(reducer(saveFailed, { type: 'submitted', firstName: 'Jane' })).toBe(saveFailed)
      expect(reducer(invalid, { type: 'submitted', firstName: 'Jane' })).toBe(invalid)
    })
  })

  describe('a rejected or failed save', () => {
    it('a 400 with field messages flags exactly those fields and keeps the values', () => {
      expect(invalid.status).toBe('invalid')
      expect(invalid.errors).toEqual({ phone: 'Phone message from the server.' })
      expect(invalid.values).toEqual(jane)
      expect(invalid.submitting).toBe(false)
    })

    it('a 400 with no field messages flags no field and is a failed save', () => {
      const next = reducer(submitting, { type: 'failed', errors: {} })
      expect(next.status).toBe('saveFailed')
      expect(next.errors).toEqual({})
      expect(next.values).toEqual(jane)
    })

    it('a 403, 413, 415, 429, 500 or network failure keeps the values for another try', () => {
      expect(saveFailed.status).toBe('saveFailed')
      expect(saveFailed.values).toEqual(jane)
      expect(saveFailed.errors).toEqual({})
      expect(saveFailed.submitting).toBe(false)
      expect(saveFailed.firstName).toBe('')
    })

    it('editing after an invalid save clears only that field’s message and stays invalid', () => {
      const next = reducer(invalid, { type: 'change', field: 'phone', value: '4155550132' })
      expect(next.status).toBe('invalid')
      expect(next.errors.phone).toBeUndefined()
    })
  })

  describe('reset ("Register another visitor")', () => {
    it('leaves no value, error or first name behind', () => {
      const next = reducer(confirmed, { type: 'reset' })
      expect(next).toEqual(initialState)
      expect(JSON.stringify(next)).not.toContain('Jane')
      expect(JSON.stringify(next)).not.toContain('Doe')
      expect(JSON.stringify(next)).not.toContain('4155550132')
    })

    it('is only offered from the confirmation', () => {
      expect(reducer(editing, { type: 'reset' })).toBe(editing)
      expect(reducer(submitting, { type: 'reset' })).toBe(submitting)
    })
  })
})
