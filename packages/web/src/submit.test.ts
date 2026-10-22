import { messages } from '@app/shared'
import { describe, expect, it, vi } from 'vitest'
import type { FormAction } from './reducer.js'
import { createSubmitter } from './submit.js'

// ST-9 — what pressing Submit does: the shared email check first, then at most one IF-2
// request at a time, each outcome dispatched to the reducer and focus moved to the field to fix.
const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status === 201 ? 'application/json' : 'application/problem+json' },
  })

function setup(response: () => Promise<Response>) {
  const actions: FormAction[] = []
  const dispatch = vi.fn((action: FormAction) => void actions.push(action))
  const focus = vi.fn()
  const fetchFn = vi.fn((_url: string, _init?: RequestInit) => response())
  const submit = createSubmitter({ dispatch, focus, fetchFn })
  return { actions, dispatch, focus, fetchFn, submit }
}

describe('Feature: Be told when my email address is not complete — Submit', () => {
  describe('Scenario: A complete email is accepted @AC-1', () => {
    it('When I press Submit, one request goes out and the saved first name reaches the reducer', async () => {
      const { actions, fetchFn, focus, submit } = setup(() =>
        Promise.resolve(json(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })),
      )
      await submit(valid)
      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(actions).toEqual([{ type: 'submit' }, { type: 'saved', firstName: 'Jane' }])
      expect(focus).not.toHaveBeenCalled()
    })
  })

  describe('Scenario Outline: An incomplete email is flagged @AC-2', () => {
    it.each(['jane', 'jane@', 'jane@example', '@example.com'])(
      'When I enter "%s" and press Submit, email is flagged, focus moves to it and nothing is sent',
      async (email) => {
        const { actions, fetchFn, focus, submit } = setup(() => Promise.reject(new Error('must not be called')))
        await submit({ ...valid, email })
        expect(fetchFn).not.toHaveBeenCalled()
        expect(actions).toEqual([{ type: 'failed', errors: { email: messages.invalidEmail } }])
        expect(focus).toHaveBeenCalledWith('email')
      },
    )
  })

  describe('Scenario: The API applies the same email rule @AC-5', () => {
    it('Then a 400 for email flags it with the server message verbatim and focuses it', async () => {
      const { actions, focus, submit } = setup(() =>
        Promise.resolve(json(400, { error: 'validation', fields: { email: ['From the server.'] } })),
      )
      await submit(valid)
      expect(actions).toEqual([{ type: 'submit' }, { type: 'failed', errors: { email: 'From the server.' } }])
      expect(focus).toHaveBeenCalledWith('email')
    })

    it('focus goes to the first flagged field in tab order', async () => {
      const { focus, submit } = setup(() => Promise.resolve(json(400, { error: 'validation', fields: { phone: ['p'], lastName: ['l'] } })))
      await submit(valid)
      expect(focus).toHaveBeenCalledTimes(1)
      expect(focus).toHaveBeenCalledWith('lastName')
    })

    it('a 400 with fields {} flags no field and is a failed save', async () => {
      const { actions, focus, submit } = setup(() => Promise.resolve(json(400, { error: 'validation', fields: {} })))
      await submit(valid)
      expect(actions).toEqual([{ type: 'submit' }, { type: 'saveFailed' }])
      expect(focus).not.toHaveBeenCalled()
    })
  })

  it.each([429, 413, 500])('a %i is a failed save', async (status) => {
    const { actions, submit } = setup(() => Promise.resolve(json(status, { error: 'internal' })))
    await submit(valid)
    expect(actions).toEqual([{ type: 'submit' }, { type: 'saveFailed' }])
  })

  it('a network failure is a failed save', async () => {
    const { actions, submit } = setup(() => Promise.reject(new TypeError('Failed to fetch')))
    await submit(valid)
    expect(actions).toEqual([{ type: 'submit' }, { type: 'saveFailed' }])
  })

  it('a double tap while the request is in flight sends one request; Submit works again afterwards', async () => {
    let release: (response: Response) => void = () => undefined
    const { actions, fetchFn, submit } = setup(() => new Promise<Response>((resolve) => (release = resolve)))
    const first = submit(valid)
    await submit(valid)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(actions).toEqual([{ type: 'submit' }])
    release(json(201, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }))
    await first
    expect(actions).toEqual([{ type: 'submit' }, { type: 'saved', firstName: 'Jane' }])

    const again = submit(valid)
    release(json(500, { error: 'internal' }))
    await again
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
