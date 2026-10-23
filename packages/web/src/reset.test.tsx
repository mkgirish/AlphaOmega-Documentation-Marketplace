import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { announcementAfter } from './announce.js'
import { initialState, reducer, type FormState } from './reducer.js'
import { RegistrationScreen } from './Screen.js'

// ST-5 / SCR-1 — clearing the kiosk for the next visitor, rendered to static markup (the web
// package has no DOM test environment). Focus, network, storage and axe are checked in a real
// browser by reset.browser.test.ts.
const noop = () => undefined
const render = (state: FormState, announcement?: string) =>
  renderToStaticMarkup(<RegistrationScreen state={state} announcement={announcement} onChange={noop} onSubmit={noop} onReset={noop} />)

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const editing: FormState = { ...initialState, values: jane }
const submitting = reducer(editing, { type: 'submit' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Jane' })
const invalid = reducer(submitting, { type: 'failed', errors: { phone: 'Server says phone.' } })
const saveFailed = reducer(submitting, { type: 'saveFailed' })
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

const statusRegions = (html: string) => tags(html, 'p').filter((p) => attr(p, 'role') === 'status')

describe('Feature: Clear the kiosk for the next visitor', () => {
  describe('Scenario: The confirmation offers one way forward @story:ST-5 @criterion:AC-1', () => {
    const html = render(confirmed)

    it('Then the only button on the screen is "Register another visitor", straight after the heading with nothing focusable between', () => {
      const buttons = tags(html, 'button')
      expect(buttons).toHaveLength(1)
      expect(attr(buttons[0], 'type')).toBe('button')
      expect(html).toContain(`${buttons[0]}Register another visitor</button>`)
      const between = html.slice(html.indexOf('</h1>'), html.indexOf(buttons[0]))
      for (const focusable of ['<a', '<input', '<select', '<textarea', '<button', 'tabindex="0"', 'tabIndex="0"']) {
        expect(between).not.toContain(focusable)
      }
      expect(count(html, '<a ')).toBe(0)
    })

    it('And an empty polite status region already waits outside the card, so the reset can be announced into it', () => {
      const regions = statusRegions(html)
      expect(regions).toHaveLength(1)
      expect(html).toContain(`${regions[0]}</p>`)
      expect((attr(regions[0], 'class') ?? '').split(' ')).toContain('sr-only')
      expect(html.indexOf(regions[0])).toBeGreaterThan(html.indexOf('</section>'))
      expect(count(html, 'aria-live')).toBe(0)
    })
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    const html = render(reset, 'Form cleared for the next visitor')

    it('Then all four inputs are blank', () => {
      const inputs = tags(html, 'input')
      expect(inputs).toHaveLength(4)
      for (const input of inputs) expect(attr(input, 'value')).toBe('')
    })

    it('And no field error, summary box, alert or "Thank you" heading is shown', () => {
      expect(count(html, 'aria-invalid')).toBe(0)
      expect(count(html, '-error"')).toBe(0)
      expect(count(html, 'role="alert"')).toBe(0)
      expect(count(html, 'summary')).toBe(0)
      expect(html).not.toContain('Thank you')
      expect(count(html, '<h1')).toBe(1)
      expect(html).toContain('>Visitor registration</h1>')
    })

    it('And the cursor is in "First name" — the only autofocused control', () => {
      const first = tags(html, 'input').find((input) => attr(input, 'id') === 'firstName') ?? ''
      expect(first).toContain(' autofocus=""')
      expect(count(html, 'autofocus')).toBe(1)
    })

    it('And a screen reader announces "Form cleared for the next visitor" from one polite, visually hidden status region', () => {
      const regions = statusRegions(html)
      expect(regions).toHaveLength(1)
      expect(html).toContain(`${regions[0]}Form cleared for the next visitor</p>`)
      expect((attr(regions[0], 'class') ?? '').split(' ')).toContain('sr-only')
      expect(html.indexOf(regions[0])).toBeGreaterThan(html.indexOf('</section>'))
    })

    it('the reset state itself holds nothing of the previous visitor', () => {
      expect(reset).toEqual(initialState)
      expect(JSON.stringify(reset)).not.toContain('Jane')
    })
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @story:ST-5 @criterion:AC-3', () => {
    it('Then no field error and no summary box is shown, even though the first attempt was flagged', () => {
      const retried = reducer(reducer(invalid, { type: 'submit' }), { type: 'submitted', firstName: 'Jane' })
      const html = render(reducer(retried, { type: 'reset' }), 'Form cleared for the next visitor')
      expect(count(html, 'aria-invalid')).toBe(0)
      expect(count(html, '-error"')).toBe(0)
      expect(count(html, 'role="alert"')).toBe(0)
      expect(html).not.toContain('Server says phone.')
    })
  })

  describe('the announcement follows the reset and nothing else', () => {
    it('RESET from the confirmation announces "Form cleared for the next visitor"', () => {
      expect(announcementAfter(confirmed, { type: 'reset' })).toBe('Form cleared for the next visitor')
    })

    it('a RESET the reducer refuses announces nothing', () => {
      for (const state of [editing, submitting, invalid, saveFailed]) expect(announcementAfter(state, { type: 'reset' })).toBe('')
    })

    it('the next keystroke or Submit silences it, so it never repeats or doubles the "Submitting…" status', () => {
      expect(announcementAfter(reset, { type: 'change', field: 'firstName', value: 'J' })).toBe('')
      expect(announcementAfter(reset, { type: 'submit' })).toBe('')
    })

    it('a form that was never confirmed has no status region at all, and no stale text shows outside editing', () => {
      expect(statusRegions(render(initialState))).toHaveLength(0)
      expect(statusRegions(render(editing, ''))).toHaveLength(0)
      const busy = render(submitting, 'Form cleared for the next visitor')
      expect(statusRegions(busy)).toHaveLength(1)
      expect(busy).not.toContain('Form cleared')
      expect(render(confirmed, 'Form cleared for the next visitor')).not.toContain('Form cleared')
    })
  })
})
