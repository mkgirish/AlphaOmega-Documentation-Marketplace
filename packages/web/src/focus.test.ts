import { describe, expect, it, vi } from 'vitest'
import { applyFocus, focusTarget } from './focus.js'

describe('Feature: Have my real name accepted, with a clear limit on length — focus', () => {
  it('Scenario: An over-long first name is flagged @AC-3 — focus moves to First name', () => {
    expect(focusTarget({ status: 'invalid', errors: { firstName: 'First name must be 100 characters or fewer.' } })).toBe('firstName')
  })

  it('Scenario: An over-long last name is flagged @AC-3 — focus moves to Last name', () => {
    expect(focusTarget({ status: 'invalid', errors: { lastName: 'Last name must be 100 characters or fewer.' } })).toBe('lastName')
  })

  it('with both names flagged, focus moves to the first in tab order', () => {
    expect(focusTarget({ status: 'invalid', errors: { lastName: 'b', firstName: 'a' } })).toBe('firstName')
  })

  it('an invalid state with no flagged field moves focus nowhere', () => {
    expect(focusTarget({ status: 'invalid', errors: { firstName: undefined } })).toBeNull()
  })

  it('Scenario Outline: Real-world names are accepted as written @AC-1 — focus moves to the confirmation', () => {
    expect(focusTarget({ status: 'confirmed', errors: {} })).toBe('confirmation')
  })

  it('a failed save keeps focus on Submit for the retry', () => {
    expect(focusTarget({ status: 'saveFailed', errors: {} })).toBe('submit')
  })

  it('editing and submitting leave focus where it is', () => {
    expect(focusTarget({ status: 'editing', errors: {} })).toBeNull()
    expect(focusTarget({ status: 'submitting', errors: {} })).toBeNull()
  })

  describe('applyFocus', () => {
    const page = (ids: string[]) => {
      const focus = vi.fn()
      const getElementById = vi.fn((id: string) => (ids.includes(id) ? ({ focus } as unknown as HTMLElement) : null))
      return { doc: { getElementById }, focus, getElementById }
    }

    it('focuses the flagged field after a 400', () => {
      const { doc, focus, getElementById } = page(['firstName'])
      applyFocus({ status: 'invalid', errors: { firstName: 'm' } }, doc)
      expect(getElementById).toHaveBeenCalledWith('firstName')
      expect(focus).toHaveBeenCalledTimes(1)
    })

    it('focuses the confirmation after a 201', () => {
      const { doc, focus, getElementById } = page(['confirmation'])
      applyFocus({ status: 'confirmed', errors: {} }, doc)
      expect(getElementById).toHaveBeenCalledWith('confirmation')
      expect(focus).toHaveBeenCalledTimes(1)
    })

    it('does nothing while editing, and tolerates a missing target', () => {
      const { doc, focus, getElementById } = page([])
      applyFocus({ status: 'editing', errors: {} }, doc)
      expect(getElementById).not.toHaveBeenCalled()
      applyFocus({ status: 'saveFailed', errors: {} }, doc)
      expect(getElementById).toHaveBeenCalledWith('submit')
      expect(focus).not.toHaveBeenCalled()
    })
  })
})
