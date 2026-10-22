import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { initialState, reducer, type FormState } from './reducer.js'
import { focusTargetFor, titleFor } from './screen.js'

// SCR-1 side effects as pure decisions: which element takes focus after a transition and
// which fixed title the tab shows. App applies them; the browser suite proves them live.

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

function submitting(): FormState {
  let state = initialState
  for (const [field, value] of Object.entries(jane)) state = reducer(state, { type: 'change', field: field as keyof typeof jane, value })
  return reducer(state, { type: 'submit' })
}

const confirmed = () => reducer(submitting(), { type: 'submitted', firstName: 'Jane' })

describe('Feature: Clear the kiosk for the next visitor — focus', () => {
  describe('Scenario: The confirmation offers one way forward @story:ST-5 @criterion:AC-1', () => {
    it('Given a 201, When the confirmation shows, Then focus moves to its heading, one Tab from the button', () => {
      expect(focusTargetFor(submitting(), confirmed())).toBe('confirmation-title')
    })
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    it('Given the confirmation, When RESET, Then the cursor goes to First name', () => {
      expect(focusTargetFor(confirmed(), reducer(confirmed(), { type: 'reset' }))).toBe('firstName')
    })
  })

  it('a 400 moves focus to the summary box that lists the errors', () => {
    expect(focusTargetFor(submitting(), reducer(submitting(), { type: 'failed', errors: { phone: 'x' } }))).toBe('error-summary')
    expect(focusTargetFor(submitting(), reducer(submitting(), { type: 'failed', errors: {} }))).toBe('error-summary')
  })

  it('while submitting and after a failed save, focus stays where the visitor left it (on Submit)', () => {
    const before = reducer(initialState, { type: 'change', field: 'firstName', value: 'Jane' })
    expect(focusTargetFor(before, reducer(before, { type: 'submit' }))).toBeNull()
    expect(focusTargetFor(submitting(), reducer(submitting(), { type: 'saveFailed' }))).toBeNull()
  })

  it('typing or an unchanged status never moves focus', () => {
    const typed = reducer(initialState, { type: 'change', field: 'email', value: 'j' })
    expect(focusTargetFor(initialState, typed)).toBeNull()
    expect(focusTargetFor(confirmed(), confirmed())).toBeNull()
  })
})

describe('Scenario: The previous visitor’s details leave no trace on the kiosk @story:ST-5 @criterion:AC-4', () => {
  it('the tab shows one of two fixed titles, never a visitor’s detail', () => {
    expect(titleFor(initialState)).toBe('Visitor registration')
    expect(titleFor(submitting())).toBe('Visitor registration')
    expect(titleFor(confirmed())).toBe('Registration complete')
    expect(titleFor(reducer(confirmed(), { type: 'reset' }))).toBe('Visitor registration')
    for (const state of [submitting(), confirmed()]) {
      for (const detail of Object.values(jane)) expect(titleFor(state)).not.toContain(detail)
    }
  })

  it('the screen’s source never touches storage, cookies, history or the URL, and injects no HTML', () => {
    const dir = new URL('./', import.meta.url)
    const sources = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(
      (name) => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.'),
    )
    expect(sources).toContain('App.tsx')
    expect(sources).toContain('screen.ts')
    const forbidden = [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
      'history.pushState',
      'history.replaceState',
      'window.location',
      'location.href',
      'location.search',
      'location.hash',
      'dangerouslySetInnerHTML',
      'new RegExp',
      "from 'zod'",
      "fetch('http",
      'fetch(`http',
    ]
    for (const name of sources) {
      const source = readFileSync(new URL(name, dir), 'utf8')
      for (const needle of forbidden) expect(source.includes(needle), `${name} uses ${needle}`).toBe(false)
    }
  })
})
