import { describe, expect, it, vi } from 'vitest'
import type { Outcome } from './api.js'
import { focusFirstError, initialState, reducer, type FormAction, type FormState } from './reducer.js'
import { createSubmit, focusTargetIn, onSubmitWith } from './submit.js'

const values = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

/** The reducer driven the way useReducer drives it, with the dispatched actions recorded. */
function screen(start: FormState = { ...initialState, values }) {
  let state = start
  const actions: FormAction[] = []
  const dispatch = (action: FormAction) => {
    actions.push(action)
    state = reducer(state, action)
  }
  return { getState: () => state, dispatch, actions }
}

function deferred() {
  let resolve: (outcome: Outcome) => void = () => {}
  const promise = new Promise<Outcome>((done) => (resolve = done))
  return { promise, resolve }
}

describe('Feature: Keep bad data out even when the screen is bypassed', () => {
  describe('Scenario: The screen shows the API’s field errors next to my fields @AC-6', () => {
    it('When I press Submit and the API answers 400 for phone, Then the phone error is shown, the values are kept, and neither saveFailed nor saved is reached', async () => {
      const s = screen()
      const send = vi.fn(async (): Promise<Outcome> => ({ kind: 'invalid', errors: { phone: phoneMessage } }))
      await createSubmit({ getState: s.getState, dispatch: s.dispatch, send })()
      expect(send).toHaveBeenCalledWith(values)
      expect(s.actions.map((action) => action.type)).toEqual(['submit', 'failed'])
      expect(s.getState().status).toBe('invalid')
      expect(s.getState().errors).toEqual({ phone: phoneMessage })
      expect(s.getState().values).toEqual(values)
      expect(s.getState().confirmedName).toBe('')
    })

    it('a double tap sends one request while the first is in flight', async () => {
      const s = screen()
      const pending = deferred()
      const send = vi.fn(() => pending.promise)
      const submit = createSubmit({ getState: s.getState, dispatch: s.dispatch, send })
      const first = submit()
      const second = submit()
      expect(s.getState().status).toBe('submitting')
      pending.resolve({ kind: 'invalid', errors: { phone: phoneMessage } })
      await Promise.all([first, second])
      expect(send).toHaveBeenCalledTimes(1)
      expect(s.actions.map((action) => action.type)).toEqual(['submit', 'failed'])
    })

    it('a second tap before the state has re-rendered still sends one request', async () => {
      const s = screen()
      const pending = deferred()
      const send = vi.fn(() => pending.promise)
      // getState lags behind dispatch, as a stale render closure would.
      const stale = { ...initialState, values }
      const submit = createSubmit({ getState: () => stale, dispatch: s.dispatch, send })
      const first = submit()
      const second = submit()
      pending.resolve({ kind: 'saved', firstName: 'Jane' })
      await Promise.all([first, second])
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('Submit pressed while already submitting sends nothing', async () => {
      const s = screen(reducer({ ...initialState, values }, { type: 'submit' }))
      const send = vi.fn()
      await createSubmit({ getState: s.getState, dispatch: s.dispatch, send })()
      expect(send).not.toHaveBeenCalled()
      expect(s.actions).toEqual([])
    })

    it('after an outcome, Submit can send again', async () => {
      const s = screen()
      const send = vi.fn(async (): Promise<Outcome> => ({ kind: 'failed' }))
      const submit = createSubmit({ getState: s.getState, dispatch: s.dispatch, send })
      await submit()
      expect(s.getState().status).toBe('saveFailed')
      await submit()
      expect(send).toHaveBeenCalledTimes(2)
    })

    it('a 201 confirms with the saved first name', async () => {
      const s = screen()
      await createSubmit({ getState: s.getState, dispatch: s.dispatch, send: async () => ({ kind: 'saved', firstName: 'Jane' }) })()
      expect(s.getState().status).toBe('saved')
      expect(s.getState().confirmedName).toBe('Jane')
    })

    it('a failed save keeps the values and flags no field', async () => {
      const s = screen()
      await createSubmit({ getState: s.getState, dispatch: s.dispatch, send: async () => ({ kind: 'failed' }) })()
      expect(s.getState().status).toBe('saveFailed')
      expect(s.getState().errors).toEqual({})
      expect(s.getState().values).toEqual(values)
    })

    it('sends through the IF-2 client by default', async () => {
      const s = screen()
      const fetch = vi.fn(
        async () => new Response(JSON.stringify({ error: 'validation', fields: { phone: [phoneMessage] } }), { status: 400 }),
      )
      vi.stubGlobal('fetch', fetch)
      try {
        await createSubmit({ getState: s.getState, dispatch: s.dispatch })()
      } finally {
        vi.unstubAllGlobals()
      }
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(s.getState().errors).toEqual({ phone: phoneMessage })
    })
    it('pressing Submit never posts the form natively and sends once through IF-2', async () => {
      const s = screen()
      const send = vi.fn(async (): Promise<Outcome> => ({ kind: 'invalid', errors: { phone: phoneMessage } }))
      const onSubmit = onSubmitWith(createSubmit({ getState: s.getState, dispatch: s.dispatch, send }))
      const event = { preventDefault: vi.fn() }
      onSubmit(event)
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(s.getState().status).toBe('submitting')
      await vi.waitFor(() => expect(s.getState().status).toBe('invalid'))
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('Then focus is on the phone input — blurred first when Enter was pressed in it, so its error is read', () => {
      const s = screen()
      s.dispatch({ type: 'submit' })
      s.dispatch({ type: 'failed', errors: { phone: phoneMessage } })
      const calls: string[] = []
      const phone = { focus: () => calls.push('focus'), blur: () => calls.push('blur') }
      const getElementById = vi.fn((id: string) => (id === 'phone' ? phone : null))
      focusFirstError(s.getState(), focusTargetIn({ activeElement: phone, getElementById }))
      expect(getElementById).toHaveBeenCalledWith('phone')
      expect(calls).toEqual(['blur', 'focus'])
      calls.length = 0
      focusFirstError(s.getState(), focusTargetIn({ activeElement: { id: 'submit' }, getElementById }))
      expect(calls).toEqual(['focus'])
    })

    it('a missing input is looked up without throwing', () => {
      expect(focusTargetIn({ activeElement: null, getElementById: () => null })('phone')).toBeNull()
    })
  })
})
