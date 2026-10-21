import { describe, expect, it } from 'vitest'
import { initialState, reducer, validate } from './reducer.js'

describe('registration reducer (scaffold baseline)', () => {
  it('records a field change and clears its error', () => {
    const next = reducer({ ...initialState, errors: { email: 'bad' } }, { type: 'change', field: 'email', value: 'a@b.com' })
    expect(next.values.email).toBe('a@b.com')
    expect(next.errors.email).toBeUndefined()
  })

  it('flags an empty required field via the shared rules', () => {
    const errors = validate({ fullName: '', email: 'a@b.com' })
    expect(errors.fullName).toBeDefined()
  })

  it('passes a valid form', () => {
    expect(validate({ fullName: 'Ada Lovelace', email: 'ada@example.com' })).toEqual({})
  })
})
