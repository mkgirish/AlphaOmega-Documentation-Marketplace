import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { announcementFor } from './effects.js'
import { initialState, reducer, statuses, type FormState } from './reducer.js'
import { RegistrationScreen } from './Screen.js'

// ST-5 — clearing the kiosk for the next visitor: what a screen reader hears after
// "Register another visitor", and the form that comes back. Static markup here; the real
// browser checks focus, network, storage and axe in App.reset.browser.test.ts.
const cleared = 'Form cleared for the next visitor'
const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const submitting = reducer({ ...initialState, values: jane }, { type: 'submit' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Jane' })
const reset = reducer(confirmed, { type: 'reset' })

const noop = () => undefined
const render = (state: FormState, announcement?: string) =>
  renderToStaticMarkup(<RegistrationScreen state={state} announcement={announcement} onChange={noop} onSubmit={noop} onReset={noop} />)

const count = (html: string, needle: string) => html.split(needle).length - 1

describe('Feature: Clear the kiosk for the next visitor — what a screen reader hears', () => {
  describe('Scenario: The next visitor gets a clean form @AC-3', () => {
    it('confirmed → editing on RESET announces exactly "Form cleared for the next visitor"', () => {
      expect(announcementFor('confirmed', reset)).toBe(cleared)
    })

    it('a keystroke in the cleared form keeps the announcement as it is', () => {
      const typed = reducer(reset, { type: 'change', field: 'firstName', value: 'J' })
      expect(announcementFor('editing', typed)).toBeNull()
      expect(announcementFor('confirmed', confirmed)).toBeNull()
    })

    it('every other change of state silences it, so it is never heard out of place', () => {
      const invalid = reducer(submitting, { type: 'failed', errors: { phone: 'p' } })
      const saveFailed = reducer(submitting, { type: 'saveFailed' })
      expect(announcementFor('editing', submitting)).toBe('')
      expect(announcementFor('submitting', confirmed)).toBe('')
      expect(announcementFor('submitting', invalid)).toBe('')
      expect(announcementFor('submitting', saveFailed)).toBe('')
      for (const status of statuses.filter((status) => status !== 'confirmed')) {
        expect(announcementFor(status, { ...initialState, status: 'confirmed' })).toBe('')
      }
    })

    it('the cleared form carries one polite, visually hidden status region with the words verbatim', () => {
      const html = render(reset, cleared)
      expect(count(html, 'role="status"')).toBe(1)
      expect(html).toContain(`<p role="status" class="sr-only">${cleared}</p>`)
      expect(count(html, 'role="alert"')).toBe(0)
      expect(count(html, 'aria-invalid')).toBe(0)
      expect(html).not.toContain('Thank you')
      for (const value of Object.values(jane)) expect(html).not.toContain(value)
      expect(count(html, ' value=""')).toBe(4)
      // Without an announcement the form has no status region at all.
      expect(render(reset)).not.toContain('role="status"')
      expect(render(reset, '')).not.toContain('role="status"')
    })

    it('the announcement is heard only in the cleared form: never beside "Submitting…", never on a confirmation', () => {
      const typed = render(reducer(reset, { type: 'change', field: 'firstName', value: 'S' }), cleared)
      expect(typed).toContain(`<p role="status" class="sr-only">${cleared}</p>`)
      const saving = render(reducer({ ...reset, values: jane }, { type: 'submit' }), cleared)
      expect(count(saving, 'role="status"')).toBe(1)
      expect(saving).not.toContain(cleared)
      expect(saving).toContain('Submitting…</p>')
      expect(render(confirmed, cleared)).not.toContain(cleared)
    })
  })
})
