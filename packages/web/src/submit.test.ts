import { describe, expect, it, vi } from 'vitest'
import type { Outcome } from './client.js'
import { initialState, reducer, type FormAction, type FormState } from './reducer.js'
import { createSubmit } from './submit.js'

// ST-2 — the one path from Submit to the API: a double tap sends one request (AC-4), and
// the confirmation is dispatched only once the API has answered 201 (AC-5).
const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const filled: FormState = { ...initialState, values: jane }

function deferred() {
  let resolve!: (outcome: Outcome) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Outcome>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('Scenario: A double tap does not register me twice @AC-4', () => {
  it('two taps before the API answers send exactly one request', async () => {
    const reply = deferred()
    const post = vi.fn(() => reply.promise)
    const actions: FormAction[] = []
    const submit = createSubmit((action) => actions.push(action), post)
    const first = submit(filled)
    const second = submit(filled)
    reply.resolve({ kind: 'created', firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    await Promise.all([first, second])
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(jane)
    expect(actions).toEqual([{ type: 'submit' }, { type: 'submitted', firstName: 'Jane' }])
  })

  it('a tap while the screen is already submitting or confirmed sends nothing', async () => {
    const post = vi.fn()
    const dispatch = vi.fn()
    const submit = createSubmit(dispatch, post)
    const submitting = reducer(filled, { type: 'submit' })
    await submit(submitting)
    await submit(reducer(submitting, { type: 'submitted', firstName: 'Jane' }))
    expect(post).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('Scenario: The API confirms the save before the screen does @AC-5', () => {
  it('the confirmation is dispatched only after the 201 arrives', async () => {
    const reply = deferred()
    const actions: FormAction[] = []
    const pending = createSubmit(
      (action) => actions.push(action),
      () => reply.promise,
    )(filled)
    await Promise.resolve()
    expect(actions).toEqual([{ type: 'submit' }])
    reply.resolve({ kind: 'created', firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })
    await pending
    expect(actions.at(-1)).toEqual({ type: 'submitted', firstName: 'Jane' })
  })

  it('a 400 dispatches the field messages, and the screen can be submitted again', async () => {
    const actions: FormAction[] = []
    const post = vi.fn(async (): Promise<Outcome> => ({ kind: 'invalid', fieldErrors: { phone: 'Server text.' } }))
    const submit = createSubmit((action) => actions.push(action), post)
    await submit(filled)
    expect(actions).toEqual([{ type: 'submit' }, { type: 'failed', errors: { phone: 'Server text.' } }])
    await submit(filled)
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('any other answer dispatches saveFailed, never a confirmation', async () => {
    const actions: FormAction[] = []
    await createSubmit(
      (action) => actions.push(action),
      async (): Promise<Outcome> => ({ kind: 'failed' }),
    )(filled)
    expect(actions).toEqual([{ type: 'submit' }, { type: 'saveFailed' }])
  })

  it('an unexpected throw is a failed save, and frees Submit for another try', async () => {
    const actions: FormAction[] = []
    const reply = deferred()
    const post = vi.fn(() => reply.promise)
    const submit = createSubmit((action) => actions.push(action), post)
    const pending = submit(filled)
    reply.reject(new Error('boom'))
    await pending
    expect(actions).toEqual([{ type: 'submit' }, { type: 'saveFailed' }])
    post.mockResolvedValueOnce({ kind: 'failed' })
    await submit(filled)
    expect(post).toHaveBeenCalledTimes(2)
  })
})
