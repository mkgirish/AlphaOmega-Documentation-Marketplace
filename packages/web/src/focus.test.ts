import { describe, expect, it, vi } from 'vitest'
import { applyFocus, focusTarget } from './focus.js'
import { initialState, reducer } from './reducer.js'

// ST-10 — where focus goes after each transition, so a flagged name is where the visitor
// lands and focus never falls back to <body>.
const submitting = reducer(initialState, { type: 'submit' })

describe('Feature: Have my real name accepted, with a clear limit on length', () => {
  describe('Scenario: An over-long first name is flagged @AC-3', () => {
    it('focus moves to the first flagged field in tab order', () => {
      const flagged = reducer(submitting, { type: 'failed', errors: { phone: 'p', lastName: 'l', firstName: 'f' } })
      expect(focusTarget(submitting, flagged)).toBe('firstName')
      const lastOnly = reducer(submitting, { type: 'failed', errors: { lastName: 'l' } })
      expect(focusTarget(submitting, lastOnly)).toBe('lastName')
    })
  })

  it('a failed save leaves focus where it is, on Submit', () => {
    expect(focusTarget(submitting, reducer(submitting, { type: 'saveFailed' }))).toBeNull()
  })

  it('the confirmation takes focus when it appears', () => {
    expect(focusTarget(submitting, reducer(submitting, { type: 'submitted', firstName: 'Ada' }))).toBe('confirmation')
  })

  it('reset returns focus to First name', () => {
    const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Ada' })
    expect(focusTarget(confirmed, reducer(confirmed, { type: 'reset' }))).toBe('firstName')
  })

  it('typing and submitting leave focus alone', () => {
    expect(focusTarget(initialState, submitting)).toBeNull()
    expect(focusTarget(initialState, reducer(initialState, { type: 'change', field: 'lastName', value: 'x' }))).toBeNull()
    expect(focusTarget(initialState, initialState)).toBeNull()
  })

  it('a 400 that flags no field moves focus nowhere', () => {
    expect(focusTarget(submitting, reducer(submitting, { type: 'failed', errors: {} }))).toBeNull()
  })

  it('each new flagged result moves focus again, after another submit', () => {
    const flagged = reducer(submitting, { type: 'failed', errors: { lastName: 'l' } })
    const again = reducer(flagged, { type: 'submit' })
    expect(focusTarget(flagged, again)).toBeNull()
    expect(focusTarget(again, reducer(again, { type: 'failed', errors: { lastName: 'l' } }))).toBe('lastName')
  })

  describe('applyFocus', () => {
    it('focuses the element the transition names', () => {
      const focus = vi.fn()
      const getElementById = vi.fn(() => ({ focus }) as unknown as HTMLElement)
      applyFocus(submitting, reducer(submitting, { type: 'failed', errors: { firstName: 'f' } }), { getElementById })
      expect(getElementById).toHaveBeenCalledWith('firstName')
      expect(focus).toHaveBeenCalledTimes(1)
    })

    it('touches nothing when focus should stay, and tolerates a missing element', () => {
      const getElementById = vi.fn(() => null)
      applyFocus(initialState, submitting, { getElementById })
      expect(getElementById).not.toHaveBeenCalled()
      applyFocus(submitting, reducer(submitting, { type: 'submitted', firstName: 'Ada' }), { getElementById })
      expect(getElementById).toHaveBeenCalledWith('confirmation')
    })
  })
})
