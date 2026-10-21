import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialState, type FormAction, type FormState } from './reducer.js'
import { handleSubmit, type SubmitEventLike } from './submit.js'

// ST-3 — what pressing Submit does when a field is empty: the browser never validates,
// nothing is sent, the errors land in the reducer and focus moves to the first empty field.
function press(values: FormState['values']) {
  const focused: string[] = []
  const preventDefault = vi.fn()
  const event: SubmitEventLike = {
    preventDefault,
    currentTarget: { elements: { namedItem: (name: string) => ({ focus: () => focused.push(name) }) } },
  }
  const actions: FormAction[] = []
  handleSubmit(event, values, (action) => actions.push(action))
  return { focused, preventDefault, actions }
}

const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }

describe('Feature: Be stopped when I leave a field empty', () => {
  const fetchSpy = vi.fn()
  beforeEach(() => vi.stubGlobal('fetch', fetchSpy))
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchSpy.mockClear()
  })

  describe('Scenario Outline: A missing field stops the registration @AC-1', () => {
    it.each(['firstName', 'lastName', 'email', 'phone'] as const)('with %s empty, Submit sends nothing', (name) => {
      const { actions, preventDefault, focused } = press({ ...valid, [name]: '' })
      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(actions).toHaveLength(1)
      expect(actions[0]).toMatchObject({ type: 'invalid' })
      expect(Object.keys((actions[0] as { errors: object }).errors)).toEqual([name])
      expect(actions.some((action) => action.type === 'submit')).toBe(false)
      expect(focused).toEqual([name])
    })
  })

  describe('Scenario: A field of only spaces counts as empty @AC-2', () => {
    it('with "   " as the last name, Submit is stopped at the last name', () => {
      const { actions, focused } = press({ ...valid, lastName: '   ' })
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(actions).toEqual([{ type: 'invalid', errors: { lastName: 'Enter your last name.' } }])
      expect(focused).toEqual(['lastName'])
    })
  })

  describe('Scenario: Each empty field says what it needs @AC-3', () => {
    it('Given the form is empty, When I press Submit, Then all four are flagged And focus is in "First name"', () => {
      const { actions, focused } = press(initialState.values)
      expect(actions).toEqual([
        {
          type: 'invalid',
          errors: {
            firstName: 'Enter your first name.',
            lastName: 'Enter your last name.',
            email: 'Enter an email like name@example.com.',
            phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
          },
        },
      ])
      expect(focused).toEqual(['firstName'])
    })
  })

  describe('Scenario: What I typed is kept when I missed a field @AC-5', () => {
    it('only the phone is flagged and focus is in "Phone number"', () => {
      const { actions, focused } = press({ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' })
      expect(actions).toEqual([{ type: 'invalid', errors: { phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.' } }])
      expect(focused).toEqual(['phone'])
    })
  })

  it('a form with every field filled is not stopped and moves no focus', () => {
    const { actions, focused, preventDefault } = press(valid)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(actions.some((action) => action.type === 'invalid')).toBe(false)
    expect(focused).toEqual([])
  })

  it('a missing form control does not throw', () => {
    const actions: FormAction[] = []
    const event: SubmitEventLike = { preventDefault: () => undefined, currentTarget: { elements: { namedItem: () => null } } }
    expect(() => handleSubmit(event, initialState.values, (action) => actions.push(action))).not.toThrow()
    expect(actions).toHaveLength(1)
  })
})
