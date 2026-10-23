import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { announcementFor, focusTargetFor, titleFor } from './effects.js'
import { initialState, reducer, statuses, type FormState } from './reducer.js'
import { RegistrationScreen } from './Screen.js'

// ST-5 / SCR-1 — clearing the kiosk for the next visitor: the RESET transition, the polite
// announcement that follows it and the screens on either side, rendered to static markup.
// Focus, network, history, storage and axe are checked in a real browser by Reset.browser.test.ts.
const noop = () => undefined
const render = (state: FormState, announcement: string | null) =>
  renderToStaticMarkup(<RegistrationScreen state={state} announcement={announcement} onChange={noop} onSubmit={noop} onReset={noop} />)

const cleared = 'Form cleared for the next visitor'
const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const submitting = reducer({ ...initialState, values: jane }, { type: 'submit' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Jane' })
const reset = reducer(confirmed, { type: 'reset' })

const count = (html: string, needle: string) => html.split(needle).length - 1

function tags(html: string, name: string): string[] {
  return html
    .split(`<${name} `)
    .slice(1)
    .map((rest) => `<${name} ${rest.slice(0, rest.indexOf('>') + 1)}`)
}

function attr(tag: string, name: string): string | undefined {
  const at = tag.indexOf(` ${name}="`)
  if (at === -1) return undefined
  const from = at + name.length + 3
  return tag.slice(from, tag.indexOf('"', from))
}

/** The opening tag of the one polite status region, or '' when there is none. */
const statusRegion = (html: string) => tags(html, 'p').find((p) => attr(p, 'role') === 'status') ?? ''

describe('Feature: Clear the kiosk for the next visitor', () => {
  describe('Scenario: The confirmation offers one way forward @story:ST-5 @criterion:AC-1', () => {
    const html = render(confirmed, '')

    it('Given I have just registered as "Jane", When the confirmation shows, Then the heading "Thank you, Jane!" is followed by the button "Register another visitor"', () => {
      expect(html).toContain('>Thank you, Jane!</h1>')
      expect(html).toContain('>Register another visitor</button>')
      expect(html.indexOf('</h1>')).toBeLessThan(html.indexOf('<button'))
    })

    it('Given I have just registered as "Jane", When I press Tab once from the heading, Then focus is on the button — nothing focusable sits between them', () => {
      const between = html.slice(html.indexOf('</h1>'), html.indexOf('<button'))
      for (const focusable of ['<input', '<a ', '<select', '<textarea', 'tabindex="0"', 'tabIndex="0"'])
        expect(between).not.toContain(focusable)
      expect(count(html, 'tabindex="0"')).toBe(0)
    })

    it('Given I have just registered as "Jane", When the confirmation shows, Then it is the only button on the screen, with an empty polite region ready to announce the reset', () => {
      expect(tags(html, 'button')).toHaveLength(1)
      expect(attr(tags(html, 'button')[0], 'type')).toBe('button')
      const region = statusRegion(html)
      expect(count(html, 'role="status"')).toBe(1)
      expect(html).toContain(`${region}</p>`)
      expect((attr(region, 'class') ?? '').split(' ')).toContain('sr-only')
      // The region sits outside the card, so the card still reads only the thanks, the sentence and the button.
      expect(html.indexOf(region)).toBeGreaterThan(html.indexOf('</section>'))
    })
  })

  describe('Scenario: The form comes back without a page reload @story:ST-5 @criterion:AC-2', () => {
    it('Given the confirmation is shown, When I activate "Register another visitor", Then the registration form is shown on the same screen', () => {
      expect(reset.status).toBe('editing')
      const html = render(reset, cleared)
      expect(html.startsWith('<main ')).toBe(true)
      expect(html).toContain('>Visitor registration</h1>')
      expect(count(html, '<form')).toBe(1)
      expect(tags(html, 'input')).toHaveLength(4)
      expect(html).toContain('>Submit</button>')
      expect(tags(html, 'form')[0]).not.toContain('action=')
    })
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    const html = render(reset, announcementFor('confirmed', reset.status, ''))

    it('Given Jane\'s confirmation is shown, When I activate "Register another visitor", Then all four inputs are blank', () => {
      expect(tags(html, 'input').map((input) => attr(input, 'value'))).toEqual(['', '', '', ''])
    })

    it('Given Jane\'s confirmation is shown, When I activate "Register another visitor", Then no field error, summary box, alert or "Thank you" heading is shown', () => {
      expect(count(html, 'aria-invalid')).toBe(0)
      expect(count(html, '-error"')).toBe(0)
      expect(count(html, 'role="alert"')).toBe(0)
      expect(html).not.toContain('Thank you')
      expect(count(html, '<h1')).toBe(1)
    })

    it('Given Jane\'s confirmation is shown, When I activate "Register another visitor", Then the cursor is in "First name"', () => {
      expect(focusTargetFor('confirmed', reset)).toBe('firstName')
      expect(tags(html, 'input')[0]).toContain(' id="firstName"')
    })

    it('Given Jane\'s confirmation is shown, When I activate "Register another visitor", Then a screen reader announces "Form cleared for the next visitor"', () => {
      expect(announcementFor('confirmed', 'editing', '')).toBe('Form cleared for the next visitor')
      const region = statusRegion(html)
      expect(count(html, 'role="status"')).toBe(1)
      expect(html).toContain(`${region}Form cleared for the next visitor</p>`)
      expect((attr(region, 'class') ?? '').split(' ')).toContain('sr-only')
      expect(count(html, 'aria-live="assertive"')).toBe(0)
    })
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane first saw a phone error and then registered, When she activates "Register another visitor", Then no field error and no summary box is shown', () => {
      const invalid = reducer(submitting, { type: 'failed', errors: { phone: 'Server says phone.' } })
      const fixed = reducer(invalid, { type: 'change', field: 'email', value: 'jane.doe@example.com' })
      expect(fixed.errors.phone).toBe('Server says phone.')
      const retried = reducer(reducer(fixed, { type: 'submit' }), { type: 'submitted', firstName: 'Jane' })
      const next = reducer(retried, { type: 'reset' })
      expect(next).toEqual(initialState)
      const html = render(next, cleared)
      expect(count(html, 'aria-invalid')).toBe(0)
      expect(html).not.toContain('Server says phone.')
      expect(count(html, 'role="alert"')).toBe(0)
    })

    it('Given Jane first saw the save fail and then registered, When she activates "Register another visitor", Then no alert is left behind either', () => {
      const failed = reducer(submitting, { type: 'saveFailed' })
      const next = reducer(reducer(reducer(failed, { type: 'submit' }), { type: 'submitted', firstName: 'Jane' }), { type: 'reset' })
      expect(next).toEqual(initialState)
      expect(count(render(next, cleared), 'role="alert"')).toBe(0)
    })
  })

  describe("Scenario: The previous visitor's details leave no trace on the kiosk @story:ST-5 @criterion:AC-4", () => {
    it('Given Jane has registered and pressed "Register another visitor", When the next visitor reads the screen and the tab title, Then neither the reset screen, its announcement nor the tab title contains "Jane", "jane.doe@example.com" or "4155550132"', () => {
      const html = render(reset, announcementFor('confirmed', reset.status, ''))
      for (const value of ['Jane', 'Doe', 'jane.doe@example.com', '4155550132']) {
        expect(html).not.toContain(value)
        expect(titleFor(reset.status)).not.toContain(value)
        expect(cleared).not.toContain(value)
      }
      expect(titleFor(reset.status)).toBe('Visitor registration')
      expect(reset.firstName).toBe('')
      expect(reset.values).toEqual({ firstName: '', lastName: '', email: '', phone: '' })
    })
  })

  describe('Scenario: The reset form is accessible @story:ST-5 @criterion:AC-5', () => {
    const html = render(reset, cleared)

    it('Given the form has just been reset, When its structure is checked, Then every input keeps its label, one heading names the screen and ids stay unique', () => {
      expect(count(html, '<h1')).toBe(1)
      for (const input of tags(html, 'input')) expect(html).toContain(`<label for="${attr(input, 'id')}"`)
      const ids = html
        .split(' id="')
        .slice(1)
        .map((rest) => rest.slice(0, rest.indexOf('"')))
      expect(ids).toContain('firstName')
      expect(new Set(ids).size).toBe(ids.length)
      expect(count(html, 'aria-invalid')).toBe(0)
    })

    it('Given the form has just been reset, When its live regions are checked, Then the announcement is one polite, visually hidden region inside the main landmark — never assertive, never a second alert', () => {
      expect(count(html, 'role="status"')).toBe(1)
      expect(count(html, 'role="alert"')).toBe(0)
      expect(count(html, 'aria-live="assertive"')).toBe(0)
      expect(html.indexOf(statusRegion(html))).toBeLessThan(html.indexOf('</main>'))
      expect((attr(statusRegion(html), 'class') ?? '').split(' ')).toContain('sr-only')
    })
  })

  describe('what the polite region says after each transition', () => {
    it('submitting → confirmed: an empty region is mounted, ready for the reset', () => {
      expect(announcementFor('submitting', 'confirmed', null)).toBe('')
      expect(announcementFor('submitting', 'confirmed', cleared)).toBe('')
    })

    it('confirmed → editing: "Form cleared for the next visitor"', () => {
      expect(announcementFor('confirmed', 'editing', '')).toBe(cleared)
    })

    it('any move into submitting removes the region, so the next visitor never hears the last reset and only "Submitting…" speaks', () => {
      for (const previous of ['editing', 'invalid', 'saveFailed'] as const) {
        expect(announcementFor(previous, 'submitting', cleared)).toBeNull()
        expect(announcementFor(previous, 'submitting', null)).toBeNull()
      }
    })

    it('every other move, and no move at all, leaves the region as it is', () => {
      for (const previous of statuses) {
        for (const next of statuses) {
          if (previous !== next && (next === 'submitting' || next === 'confirmed')) continue
          if (previous === 'confirmed' && next === 'editing') continue
          for (const current of [null, '', cleared]) expect(announcementFor(previous, next, current), `${previous} → ${next}`).toBe(current)
        }
      }
    })

    it('no region is rendered until there is one to keep', () => {
      expect(count(render(initialState, null), 'role="status"')).toBe(0)
      expect(count(render(confirmed, null), 'role="status"')).toBe(0)
    })
  })
})
