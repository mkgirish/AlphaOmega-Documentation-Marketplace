import { describe, expect, it, vi } from 'vitest'
import type { SubmitOutcome } from './api.js'
import { initialState, reducer, type FormAction, type FormState } from './reducer.js'
import { createSubmit, outcomeAction } from './submit.js'

// ST-10 — Submit drives the reducer from the IF-2 outcome: one request per press, the
// confirmation only on a 201, field messages only for the fields the server named.
const values = { firstName: 'José', lastName: 'Anne-Marie', email: 'jose@example.com', phone: '(415) 555-0132' }

function harness(send: (v: typeof values) => Promise<SubmitOutcome>) {
  let state: FormState = { ...initialState, values }
  const actions: FormAction[] = []
  const dispatch = (action: FormAction) => {
    actions.push(action)
    state = reducer(state, action)
  }
  return { submit: createSubmit(dispatch, send), actions, state: () => state }
}

describe('Feature: Have my real name accepted, with a clear limit on length', () => {
  describe('outcome to action', () => {
    it('a created outcome confirms with the server’s first name', () => {
      expect(outcomeAction({ kind: 'created', firstName: 'José' })).toEqual({ type: 'submitted', firstName: 'José' })
    })

    it('an invalid outcome naming fields flags exactly those fields', () => {
      expect(outcomeAction({ kind: 'invalid', fieldErrors: { lastName: 'm' } })).toEqual({ type: 'failed', errors: { lastName: 'm' } })
    })

    it('an invalid outcome naming no field (fields {}) is a failed save, not a flagged field', () => {
      expect(outcomeAction({ kind: 'invalid', fieldErrors: {} })).toEqual({ type: 'saveFailed' })
    })

    it('a failed outcome is a failed save', () => {
      expect(outcomeAction({ kind: 'failed' })).toEqual({ type: 'saveFailed' })
    })
  })

  describe('Scenario Outline: Real-world names are accepted as written @AC-1', () => {
    it('Then I see the confirmation', async () => {
      const send = vi.fn(async () => ({ kind: 'created', firstName: 'José' }) as const)
      const { submit, state } = harness(send)
      await submit(values)
      expect(send).toHaveBeenCalledWith(values)
      expect(state().phase).toBe('confirmed')
      expect(state().confirmedName).toBe('José')
    })
  })

  describe('Scenario: An over-long last name is flagged @AC-3', () => {
    it('And no confirmation is shown', async () => {
      const { submit, state } = harness(async () => ({ kind: 'invalid', fieldErrors: { lastName: 'server message' } }))
      await submit(values)
      expect(state().phase).toBe('invalid')
      expect(state().errors).toEqual({ lastName: 'server message' })
      expect(state().confirmedName).toBe('')
    })
  })

  describe('double submit', () => {
    it('a double tap sends one request', async () => {
      let release: (outcome: SubmitOutcome) => void = () => {}
      const send = vi.fn(() => new Promise<SubmitOutcome>((resolve) => (release = resolve)))
      const { submit, actions, state } = harness(send)
      const first = submit(values)
      const second = submit(values)
      expect(state().phase).toBe('submitting')
      release({ kind: 'created', firstName: 'José' })
      await Promise.all([first, second])
      expect(send).toHaveBeenCalledTimes(1)
      expect(actions.map((action) => action.type)).toEqual(['submit', 'submitted'])
    })

    it('after a failed save the next press sends again', async () => {
      const send = vi.fn(async (): Promise<SubmitOutcome> => ({ kind: 'failed' }))
      const { submit, state } = harness(send)
      await submit(values)
      expect(state().phase).toBe('saveFailed')
      expect(state().values).toEqual(values)
      await submit(values)
      expect(send).toHaveBeenCalledTimes(2)
    })

    it('a send that throws is a failed save and frees the next press', async () => {
      const send = vi.fn(async (): Promise<SubmitOutcome> => {
        throw new Error('boom')
      })
      const { submit, state } = harness(send)
      await submit(values)
      expect(state().phase).toBe('saveFailed')
      await submit(values)
      expect(send).toHaveBeenCalledTimes(2)
    })
  })
})
