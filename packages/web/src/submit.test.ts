import { describe, expect, it, vi } from 'vitest'
import type { SubmitResult } from './client.js'
import { phoneMessage } from './phone.js'
import type { FormAction } from './reducer.js'
import { createSubmitter, outcomeAction } from './submit.js'

// ST-8 — what pressing Submit does: the phone rule runs first, and only a valid form is sent.
const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }

function harness(status = 201, body: unknown = { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' }) {
  const actions: FormAction[] = []
  const focused: string[] = []
  const send = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify(body), { status }))
  const submit = createSubmitter({ send, dispatch: (action) => actions.push(action), focus: (field) => focused.push(field) })
  return { actions, focused, send, submit }
}

describe('Feature: Enter a US phone number and be told exactly when it is wrong', () => {
  describe('Scenario Outline: Common ways of writing a US number are accepted @AC-1', () => {
    it('When I press Submit with a valid number, Then it is sent once and I see the confirmation', async () => {
      const { actions, send, submit } = harness()
      await submit(valid)
      expect(send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(send.mock.calls[0][1]?.body)).phone).toBe('4155550132')
      expect(actions).toEqual([{ type: 'submit' }, { type: 'saved', firstName: 'Jane' }])
    })
  })

  describe('Scenario Outline: Numbers that are not a 10-digit US number are rejected @AC-2', () => {
    it('When I press Submit with "5550132", Then the phone is flagged and focused, nothing is sent and no confirmation follows', async () => {
      const { actions, focused, send, submit } = harness()
      await submit({ ...valid, phone: '555-0132' })
      expect(send).not.toHaveBeenCalled()
      expect(actions).toEqual([{ type: 'failed', errors: { phone: phoneMessage } }])
      expect(focused).toEqual(['phone'])
    })

    it('focus goes to the first flagged field in tab order', async () => {
      const { focused, submit } = harness()
      await submit({ ...valid, email: 'x', phone: '' })
      expect(focused).toEqual(['email'])
    })
  })

  describe('Scenario: The API applies the same phone rule @AC-8', () => {
    it('a 400 from the API flags and focuses the field it names, with its message verbatim', async () => {
      const { actions, focused, submit } = harness(400, { error: 'validation', fields: { phone: ['From the server.'] } })
      await submit(valid)
      expect(actions).toEqual([{ type: 'submit' }, { type: 'failed', errors: { phone: 'From the server.' } }])
      expect(focused).toEqual(['phone'])
    })
  })

  describe('double submit', () => {
    it('a second Submit while the first is in flight sends nothing more', async () => {
      const { send, submit } = harness()
      await Promise.all([submit(valid), submit(valid)])
      expect(send).toHaveBeenCalledTimes(1)
      await submit(valid)
      expect(send).toHaveBeenCalledTimes(2)
    })
  })

  describe('outcomes', () => {
    it.each<[SubmitResult, FormAction]>([
      [
        { kind: 'saved', firstName: 'Jane' },
        { type: 'saved', firstName: 'Jane' },
      ],
      [
        { kind: 'invalid', errors: { email: 'Bad.' } },
        { type: 'failed', errors: { email: 'Bad.' } },
      ],
      [{ kind: 'invalid', errors: {} }, { type: 'saveFailed' }],
      [{ kind: 'failed' }, { type: 'saveFailed' }],
    ])('%j becomes %j', (result, action) => {
      expect(outcomeAction(result)).toEqual(action)
    })

    it('a failed save moves focus nowhere, so it stays on Submit', async () => {
      const { actions, focused, submit } = harness(500, { error: 'internal' })
      await submit(valid)
      expect(actions).toEqual([{ type: 'submit' }, { type: 'saveFailed' }])
      expect(focused).toEqual([])
    })
  })
})
