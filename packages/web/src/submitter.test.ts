import { describe, expect, it, vi } from 'vitest'
import type { SubmitOutcome } from './api.js'
import { initialState, reducer, type FieldName, type FormAction, type FormState } from './reducer.js'
import { createSubmitter, toAction } from './submitter.js'

// ST-2 — the one path from Submit to the API: a single request per save, however often
// Submit is pressed, and the confirmation only once the API has answered 201.
const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

function deferred() {
  let resolve!: (outcome: SubmitOutcome) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<SubmitOutcome>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A tiny store: the reducer applied to every dispatched action, as useReducer would. */
function store(start: FormState = { ...initialState, values: jane }) {
  let state = start
  const dispatched: FormAction[] = []
  const dispatch = (action: FormAction) => {
    dispatched.push(action)
    state = reducer(state, action)
  }
  return {
    dispatch,
    dispatched,
    get state() {
      return state
    },
  }
}

describe('Feature: Submit my details and see a confirmation once my visit is saved — the submitter', () => {
  describe('Scenario: A double tap does not register me twice @AC-4', () => {
    it('When I tap Submit twice in quick succession, Then only one request is sent', async () => {
      const pending = deferred()
      const send = vi.fn(() => pending.promise)
      const { dispatch, dispatched } = store()
      const submit = createSubmitter(send, dispatch)
      const first = submit(jane)
      const second = submit(jane)
      expect(send).toHaveBeenCalledTimes(1)
      expect(dispatched).toEqual([{ type: 'submit' }])
      pending.resolve({ kind: 'saved', firstName: 'Jane' })
      await Promise.all([first, second])
      expect(send).toHaveBeenCalledTimes(1)
      expect(dispatched).toEqual([{ type: 'submit' }, { type: 'submitted', firstName: 'Jane' }])
    })

    it('once the save has answered, a new visitor’s Submit sends again', async () => {
      const send = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'saveFailed', status: 500 }))
      const submit = createSubmitter(send, store().dispatch)
      await submit(jane)
      await submit(jane)
      expect(send).toHaveBeenCalledTimes(2)
    })
  })

  describe('Scenario: The form waits while my visit is being saved @AC-4', () => {
    it('Given the API is slow to answer, When I press Submit, Then the form is submitting and keeps my values', () => {
      const pending = deferred()
      const s = store()
      createSubmitter(() => pending.promise, s.dispatch)(jane)
      expect(s.state.status).toBe('submitting')
      expect(s.state.values).toEqual(jane)
    })
  })

  describe('Scenario: The API confirms the save before the screen does @AC-5', () => {
    it('Then the confirmation appears only after that response', async () => {
      const pending = deferred()
      const s = store()
      const done = createSubmitter(() => pending.promise, s.dispatch)(jane)
      await Promise.resolve()
      expect(s.state.status).toBe('submitting')
      pending.resolve({ kind: 'saved', firstName: 'Jane' })
      await done
      expect(s.state.status).toBe('confirmed')
      expect(s.state.firstName).toBe('Jane')
    })

    it('the values sent are the ones the visitor typed', async () => {
      const send = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'saved', firstName: 'Jane' }))
      await createSubmitter(send, store().dispatch)(jane)
      expect(send).toHaveBeenCalledWith(jane)
    })

    it('a save that throws is a failed save and frees Submit for another try', async () => {
      const pending = deferred()
      const s = store()
      const send = vi.fn(() => pending.promise)
      const submit = createSubmitter(send, s.dispatch)
      const done = submit(jane)
      pending.reject(new Error('boom'))
      await done
      expect(s.state.status).toBe('saveFailed')
      expect(s.state.values).toEqual(jane)
      await submit(jane)
      expect(send).toHaveBeenCalledTimes(2)
    })
  })

  describe('outcome to action', () => {
    it('saved → submitted with the API’s first name', () => {
      expect(toAction({ kind: 'saved', firstName: 'Jane' })).toEqual({ type: 'submitted', firstName: 'Jane' })
      expect(toAction({ kind: 'saved' })).toEqual({ type: 'submitted' })
    })

    it('invalid → failed with the field errors', () => {
      const fieldErrors: Partial<Record<FieldName, string>> = { email: 'Bad.' }
      expect(toAction({ kind: 'invalid', fieldErrors })).toEqual({ type: 'failed', errors: { email: 'Bad.' } })
    })

    it('saveFailed → saveFailed', () => {
      expect(toAction({ kind: 'saveFailed', status: 429 })).toEqual({ type: 'saveFailed' })
      expect(toAction({ kind: 'saveFailed' })).toEqual({ type: 'saveFailed' })
    })
  })
})
