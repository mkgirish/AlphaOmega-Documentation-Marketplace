import { describe, expect, it, vi } from 'vitest'
import type { FormAction } from './reducer.js'
import { createSubmitter } from './submit.js'

// ST-10 — the one place the screen sends a registration: a double tap sends one request,
// and every outcome reaches the reducer as exactly one action after submit.
const values = { firstName: 'Anne-Marie', lastName: 'Dupont', email: 'anne@example.com', phone: '(415) 555-0132' }

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => (resolve = done))
  return { promise, resolve }
}

describe('Feature: Have my real name accepted, with a clear limit on length — submitting', () => {
  it('a double tap on Submit sends one request', async () => {
    const pending = deferred()
    const fetchFn = vi.fn(() => pending.promise)
    const actions: FormAction[] = []
    const submit = createSubmitter((action) => actions.push(action), fetchFn)

    const first = submit(values)
    const second = submit(values)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(actions).toEqual([{ type: 'submit' }])

    pending.resolve(new Response(JSON.stringify({ firstName: 'Anne-Marie', createdAt: '2026-10-22T09:15:00Z' }), { status: 201 }))
    await Promise.all([first, second])
    expect(actions).toEqual([{ type: 'submit' }, { type: 'submitted', firstName: 'Anne-Marie' }])
  })

  it('after a 400 the visitor can correct the name and submit again', async () => {
    const fetchFn = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'validation', fields: { lastName: ['Last name must be 100 characters or fewer.'] } }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ firstName: 'Anne-Marie', createdAt: '2026-10-22T09:15:00Z' }), { status: 201 }))
    const actions: FormAction[] = []
    const submit = createSubmitter((action) => actions.push(action), fetchFn)

    await submit({ ...values, lastName: 'a'.repeat(101) })
    await submit({ ...values, lastName: 'a'.repeat(100) })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(actions).toEqual([
      { type: 'submit' },
      { type: 'failed', errors: { lastName: 'Last name must be 100 characters or fewer.' } },
      { type: 'submit' },
      { type: 'submitted', firstName: 'Anne-Marie' },
    ])
  })
})
