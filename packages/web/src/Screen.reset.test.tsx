import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { initialState, reducer, type FormState } from './reducer.js'
import { RegistrationScreen } from './Screen.js'

// ST-5 / SCR-1 — the confirmation and the form it gives back, rendered to static markup
// (the web package has no DOM test environment). Focus, network, history and axe are
// checked in a real browser by Reset.browser.test.ts.
const noop = () => undefined
const render = (state: FormState, announcement?: string) =>
  renderToStaticMarkup(<RegistrationScreen state={state} announcement={announcement} onChange={noop} onSubmit={noop} onReset={noop} />)

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const submitting = reducer({ ...initialState, values: jane }, { type: 'submit' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Jane' })
const cleared = 'Form cleared for the next visitor'

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

const statusTag = (html: string) => tags(html, 'p').find((p) => attr(p, 'role') === 'status') ?? ''

describe('Feature: Clear the kiosk for the next visitor', () => {
  describe('Scenario: The confirmation offers one way forward @AC-1', () => {
    const html = render(confirmed)

    it('Then "Register another visitor" is the only button, straight after the heading in tab order, with the reset announcer waiting', () => {
      const buttons = tags(html, 'button')
      expect(buttons).toHaveLength(1)
      expect(html).toContain('>Register another visitor</button>')
      expect(html.indexOf('<button')).toBeGreaterThan(html.indexOf('</h1>'))
      expect(count(html, 'tabindex="0"')).toBe(0)
      expect(count(html, '<a ')).toBe(0)
      expect(count(html, '<input')).toBe(0)
      // An empty polite status region already waits, outside the card, to announce the reset.
      const status = statusTag(html)
      expect(count(html, 'role="status"')).toBe(1)
      expect(html).toContain(`${status}</p>`)
      expect((attr(status, 'class') ?? '').split(' ')).toContain('sr-only')
      expect(html.indexOf(status)).toBeGreaterThan(html.indexOf('</section>'))
    })
  })

  describe('Scenario: The next visitor gets a clean form @AC-3', () => {
    const html = render(reducer(confirmed, { type: 'reset' }), cleared)

    it('Then all four inputs are blank And no field error, summary box, alert or "Thank you" heading is shown And the cursor is in "First name" And a screen reader announces "Form cleared for the next visitor"', () => {
      const inputs = tags(html, 'input')
      expect(inputs).toHaveLength(4)
      for (const input of inputs) expect(attr(input, 'value')).toBe('')
      expect(count(html, 'aria-invalid')).toBe(0)
      expect(count(html, '-error"')).toBe(0)
      expect(count(html, 'role="alert"')).toBe(0)
      expect(html).not.toContain('Thank you')
      expect(html).toContain('>Visitor registration</h1>')
      expect(attr(inputs[0], 'id')).toBe('firstName')
      expect(inputs[0]).toContain(' autofocus=""')
      expect(count(html, 'autofocus')).toBe(1)
      const status = statusTag(html)
      expect(count(html, 'role="status"')).toBe(1)
      expect(html).toContain(`${status}${cleared}</p>`)
      expect((attr(status, 'class') ?? '').split(' ')).toContain('sr-only')
      expect(status).not.toContain('aria-hidden')
      expect(attr(status, 'aria-live')).not.toBe('off')
    })
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @AC-3', () => {
    it('Then no field error and no summary box is shown', () => {
      const invalid = reducer(submitting, { type: 'failed', errors: { phone: 'Server says phone.' } })
      const retried = reducer(reducer(invalid, { type: 'change', field: 'phone', value: '4155550132' }), { type: 'submit' })
      const html = render(reducer(reducer(retried, { type: 'submitted', firstName: 'Jane' }), { type: 'reset' }), cleared)
      expect(count(html, 'aria-invalid')).toBe(0)
      expect(html).not.toContain('Server says phone.')
      expect(count(html, 'role="alert"')).toBe(0)
      expect(html).toContain(`${statusTag(html)}${cleared}</p>`)
    })
  })

  describe("Scenario: The previous visitor's details leave no trace on the kiosk @AC-4", () => {
    it("Then the reset form and its announcement carry none of Jane's details", () => {
      const html = render(reducer(confirmed, { type: 'reset' }), cleared)
      expect(html).toContain(`${statusTag(html)}${cleared}</p>`)
      for (const value of Object.values(jane)) expect(html).not.toContain(value)
    })
  })
})
